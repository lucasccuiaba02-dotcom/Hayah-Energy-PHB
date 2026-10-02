import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { X, Lock, CalendarRange } from 'lucide-react';
import { formatCurrency } from '../../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/** Fecha a medição em aberto: nº automático, período (de/até) e observações → vai para o histórico da obra. */
export const FecharMedicaoModal = ({ open, detail, onClose, onClosed }) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open || !detail) return null;
  const p = detail.project;
  const n = detail.next_number || 1;
  const total = detail.totals?.em_aberto || 0;

  const fechar = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/projects/${p.id}/medicao/fechar`, { period_from: from, period_to: to, notes });
      toast.success(`Medição nº ${data.fechada.number} fechada · ${formatCurrency(data.fechada.total)} · acumulado ${formatCurrency(data.totals.fechado)}`);
      onClosed?.(data); onClose();
      setFrom(''); setTo(''); setNotes('');
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao fechar medição'); } finally { setBusy(false); }
  };

  return (
    <div data-testid="mo-fechar-modal" className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-md rounded-2xl border border-[#E0FF00]/40 overflow-hidden" style={{ backgroundColor: '#0b0b0d' }}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-[#E0FF00]/15 border border-[#E0FF00]/40 flex items-center justify-center"><Lock className="w-5 h-5 text-[#E0FF00]" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Fechar medição nº {n}</p>
            <h3 className="font-heading font-black text-lg text-white leading-tight truncate">{p.project_code ? `${p.project_code} · ` : ''}{p.name}</h3>
            <p className="text-[11px] text-zinc-400">{detail.totals?.realizado_count || 0} item(ns) · <span className="font-mono text-[#39FF14] font-bold" data-testid="mo-fechar-total">{formatCurrency(total)}</span></p>
          </div>
          <button data-testid="mo-fechar-close" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-zinc-400 leading-relaxed">Os itens em aberto viram a <b className="text-white">Medição nº {n}</b> no histórico da obra (com PDF e envio próprios) e o rascunho é limpo para a próxima. A Produção Realizada continua = medições fechadas + em aberto.</p>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 inline-flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Período · de</label><input data-testid="mo-fechar-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white focus:border-[#E0FF00] focus:outline-none" /></div>
            <div><label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">até</label><input data-testid="mo-fechar-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white focus:border-[#E0FF00] focus:outline-none" /></div>
          </div>
          <div><label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">Observações (saem no PDF)</label><textarea data-testid="mo-fechar-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ex.: trecho km 0 a km 0,76; postes fornecidos pela concessionária" className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#E0FF00] focus:outline-none resize-none" /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10">
          <button type="button" data-testid="mo-fechar-cancel" onClick={onClose} className="text-xs font-bold text-zinc-300 px-4 py-2 rounded-full hover:bg-white/5">Cancelar</button>
          <button type="button" data-testid="mo-fechar-confirm" disabled={busy || !total} onClick={fechar} className="inline-flex items-center gap-1.5 text-xs font-black text-black bg-[#E0FF00] hover:bg-[#C8E600] px-5 py-2 rounded-full disabled:opacity-40"><Lock className="w-3.5 h-3.5" /> {busy ? 'Fechando…' : `Fechar medição nº ${n}`}</button>
        </div>
      </motion.div>
    </div>
  );
};
