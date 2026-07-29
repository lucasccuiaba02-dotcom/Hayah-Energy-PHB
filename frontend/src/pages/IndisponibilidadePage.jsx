import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Users, Plus, X, CalendarX } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { UNAVAILABILITY_REASONS, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const IndisponibilidadePage = () => {
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('chuva');
  const [notes, setNotes] = useState('');

  const fetch = async () => {
    const [t, u] = await Promise.all([
      axios.get(`${API}/teams`),
      axios.get(`${API}/team-unavailability`),
    ]);
    setTeams(t.data);
    setItems(u.data);
  };
  useEffect(() => { fetch(); }, []);

  const add = async () => {
    if (!teamId || !date) { toast.error('Escolha equipe e data'); return; }
    try {
      await axios.post(`${API}/team-unavailability`, { team_id: teamId, date, reason, notes });
      toast.success('Indisponibilidade registrada');
      setNotes('');
      fetch();
    } catch { toast.error('Erro'); }
  };

  const remove = async (id) => {
    await axios.delete(`${API}/team-unavailability/${id}`);
    toast.info('Removido');
    fetch();
  };

  return (
    <AppLayout title="Indisponibilidade" subtitle="Bloqueie datas em que uma equipe não vai produzir">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Equipe</label>
            <select data-testid="unav-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[200px]">
              <option value="">— Selecione —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Data</label>
            <input data-testid="unav-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Motivo</label>
            <select data-testid="unav-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
              {UNAVAILABILITY_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Observações</label>
            <input data-testid="unav-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <button data-testid="unav-add" onClick={add} className="flex items-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-xs font-bold px-4 py-2 rounded-full">
            <Plus className="w-3 h-3" /> Registrar
          </button>
        </div>
      </motion.div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="glass-panel rounded-xl p-6 text-center text-zinc-500 text-sm">Nenhuma indisponibilidade registrada.</div>
        ) : items.map((it) => (
          <div key={it.id} data-testid={`unav-item-${it.id}`} className="glass-panel rounded-xl p-3 flex items-center gap-3 flex-wrap">
            <CalendarX className="w-4 h-4 text-[#FF5E00]" />
            <span className="font-mono text-xs text-white">{it.date}</span>
            <span className="text-xs text-white font-bold">{it.team_name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF5E00]/15 border border-[#FF5E00]/40 text-[#FF5E00] uppercase">{it.reason}</span>
            {it.notes && <span className="text-[11px] text-zinc-500 italic">{it.notes}</span>}
            <button data-testid={`unav-del-${it.id}`} onClick={() => remove(it.id)} className="ml-auto w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-[#FF003C] flex items-center justify-center">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </AppLayout>
  );
};
