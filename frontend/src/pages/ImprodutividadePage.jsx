import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Plus, X, TrendingDown, Filter } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { IMPRODUTIVIDADE_REASONS, IMPRODUTIVIDADE_REASON_LABEL, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const ImprodutividadePage = () => {
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('chuva');
  const [hoursLost, setHoursLost] = useState('');
  const [notes, setNotes] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterReason, setFilterReason] = useState('');

  const load = async () => {
    const params = new URLSearchParams();
    if (filterStart) params.append('start', filterStart);
    if (filterEnd) params.append('end', filterEnd);
    const [t, u] = await Promise.all([
      axios.get(`${API}/teams`),
      axios.get(`${API}/team-unproductivity?${params.toString()}`),
    ]);
    setTeams(t.data);
    setItems(u.data);
  };

  useEffect(() => { load(); }, [filterStart, filterEnd]);

  const add = async () => {
    if (!teamId || !date) { toast.error('Escolha equipe e data'); return; }
    try {
      await axios.post(`${API}/team-unproductivity`, {
        team_id: teamId, date, reason, notes,
        hours_lost: parseFloat(hoursLost) || 0,
      });
      toast.success('Improdutividade registrada');
      setNotes(''); setHoursLost('');
      load();
    } catch { toast.error('Erro ao registrar'); }
  };

  const remove = async (id) => {
    if (!window.confirm('Remover este registro?')) return;
    await axios.delete(`${API}/team-unproductivity/${id}`);
    toast.info('Removido');
    load();
  };

  const filtered = items.filter((it) => !filterReason || it.reason === filterReason);
  const totalHours = filtered.reduce((s, i) => s + (i.hours_lost || 0), 0);

  return (
    <AppLayout
      title="Improdutividade"
      subtitle="Registre e visualize horas perdidas por motivos operacionais"
    >
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Equipe</label>
            <select data-testid="improd-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[200px]">
              <option value="">— Selecione —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Data</label>
            <input data-testid="improd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Motivo</label>
            <select data-testid="improd-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[220px]">
              {IMPRODUTIVIDADE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Horas perdidas</label>
            <input data-testid="improd-hours" type="number" step="0.5" min="0" value={hoursLost} onChange={(e) => setHoursLost(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono w-28" placeholder="0" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Observação</label>
            <input data-testid="improd-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Detalhes do imprevisto..." />
          </div>
          <button data-testid="improd-add" onClick={add} className="bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold px-5 py-2 rounded-full transition-all inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Registrar
          </button>
        </div>
      </motion.div>

      <div className="glass-panel rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-[#E0FF00]" />
        <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Filtros</span>
        <input data-testid="improd-filter-start" type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono" />
        <span className="text-zinc-500 text-xs">→</span>
        <input data-testid="improd-filter-end" type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono" />
        <select data-testid="improd-filter-reason" value={filterReason} onChange={(e) => setFilterReason(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
          <option value="">Todos os motivos</option>
          {IMPRODUTIVIDADE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <div className="ml-auto text-[11px] text-zinc-400">
          <span className="text-[#FF5E00] font-bold">{filtered.length}</span> registros ·
          <span className="text-white font-bold ml-2">{totalHours.toFixed(1)}h</span> perdidas
        </div>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden" data-testid="improd-list">
        {filtered.length === 0 ? (
          <p className="text-center text-zinc-500 py-10 text-sm">Nenhum registro no período selecionado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[10px] tracking-[0.15em] uppercase text-zinc-500">
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Equipe</th>
                <th className="text-left px-4 py-2">Motivo</th>
                <th className="text-right px-4 py-2">Horas</th>
                <th className="text-left px-4 py-2">Observação</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} data-testid={`improd-item-${it.id}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2 font-mono text-xs text-white">{it.date}</td>
                  <td className="px-4 py-2 text-white">{it.team_name || '—'}</td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF5E00]/15 text-[#FF5E00] border border-[#FF5E00]/30">
                      {IMPRODUTIVIDADE_REASON_LABEL[it.reason] || it.reason}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sm text-white">{(it.hours_lost || 0).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-zinc-400 text-xs">{it.notes || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button data-testid={`improd-delete-${it.id}`} onClick={() => remove(it.id)} className="w-7 h-7 rounded-md bg-white/5 hover:bg-[#FF003C]/20 flex items-center justify-center text-zinc-500 hover:text-[#FF003C]">
                      <X className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
};
