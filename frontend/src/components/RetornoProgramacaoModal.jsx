import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, ClipboardCheck, Calendar as CalendarIcon } from 'lucide-react';
import { RESCHEDULE_REASONS, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const formatBR = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export const RetornoProgramacaoModal = ({ isOpen, onClose, onDone }) => {
  const [mode, setMode] = useState('all'); // 'all' = todos dias anteriores, 'date' = data específica
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reasonById, setReasonById] = useState({});
  const [hoursById, setHoursById] = useState({});
  const [notesById, setNotesById] = useState({});
  const [submittingId, setSubmittingId] = useState(null);

  const fetchList = async () => {
    setLoading(true);
    try {
      const url = mode === 'date' ? `${API}/programacao/pending-returns?date=${date}` : `${API}/programacao/pending-returns`;
      const { data } = await axios.get(url);
      setItems(data || []);
    } catch (err) {
      console.error('pending-returns fetch error', err);
      toast.error('Erro ao carregar pendências');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, date]);

  // Agrupar por data (mais antigo primeiro)
  const grouped = useMemo(() => {
    const g = {};
    items.forEach((it) => {
      const d = it.target_date || '—';
      if (!g[d]) g[d] = [];
      g[d].push(it);
    });
    return Object.keys(g).sort().map((d) => ({ date: d, items: g[d] }));
  }, [items]);

  const submit = async (project, executed) => {
    const key = `${project.id}:${project.target_date}`;
    const reason = reasonById[key];
    if (!executed && !reason) { toast.error('Selecione o motivo do não-executado'); return; }
    setSubmittingId(key + (executed ? ':ok' : ':nok'));
    try {
      await axios.post(`${API}/programacao/return`, {
        project_id: project.id,
        date: project.target_date,
        executed,
        reason: executed ? null : reason,
        notes: notesById[key] || '',
        hours_lost: executed ? null : (Number(hoursById[key]) || null),
      });
      toast.success(executed ? `Marcada como executada em ${formatBR(project.target_date)}` : `Movida para reprogramar (${formatBR(project.target_date)})${reason === 'almoxarifado' ? ' · impacto lançado no Almoxarifado' : ''}`);
      setItems((s) => s.filter((x) => !(x.id === project.id && x.target_date === project.target_date)));
      onDone && onDone();
    } catch (err) {
      console.error('retorno submit error', err);
      toast.error('Erro ao registrar');
    } finally {
      setSubmittingId(null);
    }
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
          <div className="flex-1 min-w-[180px]">
            <h3 className="text-white font-bold text-lg">Retorno de Programação</h3>
            <p className="text-xs text-zinc-500">Confirme se as obras programadas foram executadas</p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-1">
            <button
              data-testid="retorno-mode-all"
              onClick={() => setMode('all')}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition ${mode === 'all' ? 'bg-[#E0FF00] text-black' : 'text-zinc-400 hover:text-white'}`}
            >
              Todos pendentes
            </button>
            <button
              data-testid="retorno-mode-date"
              onClick={() => setMode('date')}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition ${mode === 'date' ? 'bg-[#E0FF00] text-black' : 'text-zinc-400 hover:text-white'}`}
            >
              Data específica
            </button>
          </div>
          {mode === 'date' && (
            <input
              data-testid="retorno-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayISO()}
              className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          )}
          <button data-testid="retorno-close" onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white">✕</button>
        </div>

        {loading ? (
          <p className="text-center text-zinc-500 py-6 text-sm">Carregando…</p>
        ) : items.length === 0 ? (
          <div className="glass-panel rounded-xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-[#39FF14] mx-auto mb-2" />
            <p className="text-white font-bold text-sm">Nenhuma pendência{mode === 'date' ? ` para ${formatBR(date)}` : ''}</p>
            <p className="text-[11px] text-zinc-500 mt-1">Todas as obras programadas já tiveram retorno registrado.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[11px] text-zinc-500">
              <span className="font-mono font-bold text-[#E0FF00]">{items.length}</span> pendência(s) — do mais antigo para o mais recente
            </p>
            {grouped.map((g) => (
              <div key={g.date} data-testid={`retorno-group-${g.date}`}>
                <div className="flex items-center gap-2 mb-2 sticky top-0 z-10 bg-zinc-950/70 backdrop-blur-sm py-1 -mx-2 px-2 rounded">
                  <CalendarIcon className="w-3.5 h-3.5 text-[#E0FF00]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-white">{formatBR(g.date)}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">· {g.items.length} obra(s)</span>
                </div>
                <div className="space-y-2">
                  {g.items.map((p) => {
                    const key = `${p.id}:${p.target_date}`;
                    return (
                      <div key={key} data-testid={`retorno-item-${p.id}-${p.target_date}`} className="rounded-xl p-3 bg-white/[0.02] border border-white/10">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-white font-bold text-sm truncate">{p.name}</p>
                            <p className="text-[11px] text-zinc-500 font-mono">{p.project_code || '—'} · {p.team_name || 'sem equipe'}{p.additional_team_name ? ` + ${p.additional_team_name}` : ''}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                          <select
                            data-testid={`retorno-reason-${p.id}-${p.target_date}`}
                            value={reasonById[key] || ''}
                            onChange={(e) => setReasonById({ ...reasonById, [key]: e.target.value })}
                            className="bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1 text-xs text-white min-w-[130px]"
                          >
                            <option value="">Motivo (se não executada)</option>
                            {RESCHEDULE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                          {reasonById[key] === 'almoxarifado' && (
                            <input
                              data-testid={`retorno-hours-${p.id}-${p.target_date}`}
                              type="number" min="0" step="0.5"
                              placeholder="Horas perdidas"
                              title="Horas da equipe perdidas por falta/erro de material (vazio = 8h)"
                              value={hoursById[key] || ''}
                              onChange={(e) => setHoursById({ ...hoursById, [key]: e.target.value })}
                              className="w-28 bg-zinc-950/90 border border-[#FF5E00]/50 rounded-lg px-2 py-1 text-xs text-white"
                            />
                          )}
                          <input
                            data-testid={`retorno-notes-${p.id}-${p.target_date}`}
                            type="text"
                            placeholder="Observações"
                            value={notesById[key] || ''}
                            onChange={(e) => setNotesById({ ...notesById, [key]: e.target.value })}
                            className="flex-1 min-w-[140px] bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                          />
                          <button
                            data-testid={`retorno-ok-${p.id}-${p.target_date}`}
                            disabled={submittingId?.startsWith(key)}
                            onClick={() => submit(p, true)}
                            className="flex items-center gap-1 bg-[#39FF14]/15 border border-[#39FF14]/40 text-[#39FF14] text-xs font-bold px-3 py-1.5 rounded-full hover:bg-[#39FF14]/25 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Executada
                          </button>
                          <button
                            data-testid={`retorno-nok-${p.id}-${p.target_date}`}
                            disabled={submittingId?.startsWith(key)}
                            onClick={() => submit(p, false)}
                            className="flex items-center gap-1 bg-[#FF5E00]/15 border border-[#FF5E00]/40 text-[#FF5E00] text-xs font-bold px-3 py-1.5 rounded-full hover:bg-[#FF5E00]/25 disabled:opacity-50"
                          >
                            <XCircle className="w-3 h-3" /> Reprogramar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};
