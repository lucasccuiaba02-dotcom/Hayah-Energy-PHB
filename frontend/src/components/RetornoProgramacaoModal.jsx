import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
import { RESCHEDULE_REASONS, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const yesterdayISO = () => {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
};

export const RetornoProgramacaoModal = ({ isOpen, onClose, onDone }) => {
  const [date, setDate] = useState(yesterdayISO());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reasonById, setReasonById] = useState({});
  const [notesById, setNotesById] = useState({});
  const [submittingId, setSubmittingId] = useState(null);

  const fetch = async (d) => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/programacao/pending-returns?date=${d}`);
      setItems(data || []);
    } catch { toast.error('Erro ao carregar pendências'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (isOpen) fetch(date);
  }, [isOpen, date]);

  const submit = async (project, executed) => {
    const reason = reasonById[project.id];
    if (!executed && !reason) { toast.error('Selecione o motivo do não-executado'); return; }
    setSubmittingId(project.id + (executed ? ':ok' : ':nok'));
    try {
      await axios.post(`${API}/programacao/return`, {
        project_id: project.id,
        date,
        executed,
        reason: executed ? null : reason,
        notes: notesById[project.id] || '',
      });
      toast.success(executed ? 'Marcada como executada' : 'Movida para a reprogramar');
      setItems((s) => s.filter((x) => x.id !== project.id));
      onDone && onDone();
    } catch { toast.error('Erro ao registrar'); }
    finally { setSubmittingId(null); }
  };

  if (!isOpen) return null;

  return (
    <div data-testid="retorno-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel rounded-2xl border border-[#E0FF00]/40 max-w-3xl w-full p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="w-10 h-10 rounded-full bg-[#E0FF00]/20 flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5 text-[#E0FF00]" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-bold text-lg">Retorno de Programação</h3>
            <p className="text-xs text-zinc-500">Confirme se as obras programadas foram executadas</p>
          </div>
          <input
            data-testid="retorno-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={todayISO()}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
          <button data-testid="retorno-close" onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white">✕</button>
        </div>

        {loading ? (
          <p className="text-center text-zinc-500 py-6 text-sm">Carregando…</p>
        ) : items.length === 0 ? (
          <div className="glass-panel rounded-xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-[#39FF14] mx-auto mb-2" />
            <p className="text-white font-bold text-sm">Nenhuma pendência para {date}</p>
            <p className="text-[11px] text-zinc-500 mt-1">Todas as obras já tiveram retorno registrado.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((p) => (
              <div key={p.id} data-testid={`retorno-item-${p.id}`} className="rounded-xl p-3 bg-white/[0.02] border border-white/10">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-bold text-sm truncate">{p.name}</p>
                    <p className="text-[11px] text-zinc-500 font-mono">{p.project_code || '—'} · {p.team_name || 'sem equipe'}{p.additional_team_name ? ` + ${p.additional_team_name}` : ''}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    data-testid={`retorno-reason-${p.id}`}
                    value={reasonById[p.id] || ''}
                    onChange={(e) => setReasonById({ ...reasonById, [p.id]: e.target.value })}
                    className="bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1 text-xs text-white min-w-[130px]"
                  >
                    <option value="">Motivo (se não executada)</option>
                    {RESCHEDULE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <input
                    data-testid={`retorno-notes-${p.id}`}
                    type="text"
                    placeholder="Observações"
                    value={notesById[p.id] || ''}
                    onChange={(e) => setNotesById({ ...notesById, [p.id]: e.target.value })}
                    className="flex-1 min-w-[140px] bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                  />
                  <button
                    data-testid={`retorno-ok-${p.id}`}
                    disabled={submittingId?.startsWith(p.id)}
                    onClick={() => submit(p, true)}
                    className="flex items-center gap-1 bg-[#39FF14]/15 border border-[#39FF14]/40 text-[#39FF14] text-xs font-bold px-3 py-1.5 rounded-full hover:bg-[#39FF14]/25 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Executada
                  </button>
                  <button
                    data-testid={`retorno-nok-${p.id}`}
                    disabled={submittingId?.startsWith(p.id)}
                    onClick={() => submit(p, false)}
                    className="flex items-center gap-1 bg-[#FF5E00]/15 border border-[#FF5E00]/40 text-[#FF5E00] text-xs font-bold px-3 py-1.5 rounded-full hover:bg-[#FF5E00]/25 disabled:opacity-50"
                  >
                    <XCircle className="w-3 h-3" /> Reprogramar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};
