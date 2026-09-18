import React from 'react';
import { motion } from 'framer-motion';
import { X, AlertTriangle, ExternalLink, MapPin, Users, CalendarClock, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, EXECUTION_STATUS_LABEL, PROJECT_TYPE_LABEL } from '../lib/constants';
import { openWhatsApp, vencidasText } from '../lib/whatsapp';

const fmtDate = (d) => {
  const s = (d || '').slice(0, 10);
  if (!s) return '—';
  const [y, m, day] = s.split('-');
  return `${day}/${m}/${y}`;
};

export const VencidasModal = ({ open, onClose, items = [] }) => {
  const navigate = useNavigate();
  if (!open) return null;
  const totalValue = items.reduce((s, p) => s + (p.programmed_value || 0), 0);

  return (
    <div data-testid="vencidas-modal" className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-[#FF003C]/40 shadow-2xl overflow-hidden"
        style={{ backgroundColor: '#0b0b0d' }}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10" style={{ background: 'linear-gradient(135deg, rgba(255,0,60,0.18), rgba(255,0,60,0.04))' }}>
          <div className="w-10 h-10 rounded-xl bg-[#FF003C]/20 border border-[#FF003C]/50 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-[#FF003C]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#FF003C]">Obras Vencidas</p>
            <h3 className="font-heading font-black text-lg text-white leading-tight">
              {items.length} obra{items.length !== 1 ? 's' : ''} · {formatCurrency(totalValue)} programado
            </h3>
            <p className="text-[11px] text-zinc-400">Baseado na Data Vencimento do cadastro · exclui concluídas, executadas, suspensas e canceladas</p>
          </div>
          {items.length > 0 && (
            <button data-testid="vencidas-whatsapp" onClick={() => openWhatsApp(vencidasText(items))} title="Enviar lista pelo WhatsApp" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border border-[#25D366]/50 text-[#25D366] hover:bg-[#25D366]/10">
              <MessageCircle className="w-3.5 h-3.5" /> <span className="hidden sm:inline">WhatsApp</span>
            </button>
          )}
          <button data-testid="vencidas-modal-close" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-2">
          {items.length === 0 && <p className="text-center text-zinc-500 text-sm py-10">Nenhuma obra vencida 🎉</p>}
          {items.map((p) => {
            const st = EXECUTION_STATUS_LABEL[p.execution_status || 'aguardando_programacao'];
            return (
              <div key={p.id} data-testid={`vencida-row-${p.id}`} className="rounded-xl border border-[#FF003C]/25 bg-[#FF003C]/[0.04] p-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#FF003C]">{p.project_code || '—'}</span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider" style={{ background: `${st?.color || '#94A3B8'}22`, color: st?.color || '#94A3B8' }}>
                        {st?.label || p.execution_status}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-white/5 text-zinc-400">{PROJECT_TYPE_LABEL[p.project_type] || p.project_type}</span>
                    </div>
                    <p className="text-sm font-bold text-white mt-1 truncate">{p.name}</p>
                    <div className="flex items-center gap-4 flex-wrap mt-1 text-[11px] text-zinc-400">
                      {p.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.location}</span>}
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{p.team_name || 'Sem equipe'}</span>
                      <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" />Programada: {fmtDate(p.start_date)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Venceu em</p>
                    <p className="font-mono text-sm font-bold text-[#FF003C]">{fmtDate(p.expiry_date)}</p>
                    <p className="text-[11px] font-bold text-[#FF5E00]">há {p.dias_vencida} dia{p.dias_vencida !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Valor</p>
                    <p className="font-mono text-sm font-bold text-white">{formatCurrency(p.programmed_value)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button data-testid={`vencida-open-${p.id}`} onClick={() => navigate(`/projeto/${p.id}`)} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#FF003C] text-white hover:scale-105 transition-transform flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> Abrir obra
                  </button>
                  <button onClick={() => navigate(`/carteira?filter=vencidas`)} className="text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15 text-zinc-300 hover:bg-white/10">
                    Ver na Carteira
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};
