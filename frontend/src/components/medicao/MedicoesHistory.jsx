import React from 'react';
import { History, FileDown, Mail, RotateCcw, Lock } from 'lucide-react';
import { formatCurrency } from '../../lib/constants';
import { downloadMedicaoPdf } from './MedicaoEnvioModal';

const dateBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

/** Histórico de medições fechadas da obra (nº, período, itens, total, fechada em/por) com PDF, envio e reabertura da última. */
export const MedicoesHistory = ({ detail, onEnviar, onReabrir }) => {
  const list = [...(detail?.medicoes || [])].reverse();
  const fechado = detail?.totals?.fechado || 0;
  const draftEmpty = !(detail?.measured || []).length;
  return (
    <div className="glass-panel rounded-2xl p-4" data-testid="mo-medicoes">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <History className="w-4 h-4 text-[#E0FF00]" />
        <p className="text-[10px] tracking-[0.22em] uppercase font-bold text-zinc-400">Histórico de medições</p>
        <span className="ml-auto text-[11px] text-zinc-400">{list.length} fechada(s) · acumulado <span className="font-mono font-bold text-[#E0FF00]" data-testid="mo-medicoes-total">{formatCurrency(fechado)}</span></span>
      </div>
      {list.length === 0 ? (
        <p data-testid="mo-medicoes-empty" className="text-xs text-zinc-500 italic py-4 text-center">Nenhuma medição fechada ainda. Lance os serviços em "Realizado", salve e use <b className="text-zinc-300 not-italic">Fechar medição nº 1</b>.</p>
      ) : (
        <div className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
          {list.map((m, idx) => (
            <div key={m.id} data-testid={`mo-medicao-${m.id}`} className="px-3 py-2.5 flex items-center gap-3 flex-wrap">
              <div className="w-9 h-9 rounded-lg bg-[#E0FF00]/10 border border-[#E0FF00]/30 flex items-center justify-center shrink-0"><span className="font-mono font-black text-[#E0FF00] text-sm">{m.number}ª</span></div>
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm font-bold text-white">Medição nº {m.number}{m.period ? <span className="text-zinc-400 font-normal"> · {m.period}</span> : ''}</p>
                <p className="text-[10px] text-zinc-500">{m.items_count} item(ns) · qtd {Number(m.qty_total || 0).toLocaleString('pt-BR')} · fechada {dateBR(m.closed_at)}{m.closed_by ? ` por ${m.closed_by}` : ''}{m.envios ? ` · ${m.envios} envio(s)` : ''}</p>
              </div>
              <p className="font-mono text-sm font-black text-[#39FF14]" data-testid={`mo-medicao-total-${m.id}`}>{formatCurrency(m.total)}</p>
              <div className="flex items-center gap-1">
                <button type="button" data-testid={`mo-medicao-pdf-${m.id}`} onClick={() => downloadMedicaoPdf(detail.project.id, { medicao_id: m.id })} title="Baixar PDF desta medição" className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 border border-white/10"><FileDown className="w-3.5 h-3.5" /></button>
                <button type="button" data-testid={`mo-medicao-enviar-${m.id}`} onClick={() => onEnviar(m)} title="Enviar aos fiscais" className="p-2 rounded-lg text-black bg-[#39FF14] hover:bg-[#2ee010]"><Mail className="w-3.5 h-3.5" /></button>
                {idx === 0 && (
                  <button type="button" data-testid={`mo-medicao-reabrir-${m.id}`} disabled={!draftEmpty} onClick={() => onReabrir(m)} title={draftEmpty ? 'Reabrir (volta para o rascunho)' : 'Esvazie a medição em aberto para reabrir'} className="p-2 rounded-lg text-zinc-400 hover:text-[#FF5E00] hover:bg-white/10 border border-white/10 disabled:opacity-30"><RotateCcw className="w-3.5 h-3.5" /></button>
                )}
                {idx !== 0 && <span className="p-2 text-zinc-700" title="Fechada"><Lock className="w-3.5 h-3.5" /></span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
