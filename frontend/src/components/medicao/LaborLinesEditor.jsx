import React, { useState, useMemo, useRef } from 'react';
import { Plus, Trash2, Search, Copy } from 'lucide-react';
import { formatCurrency } from '../../lib/constants';

const num = (v) => Number(v || 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const cell = 'bg-transparent border border-white/5 hover:border-white/20 focus:border-[#E0FF00] rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:bg-zinc-950/60';

/** Editor de linhas de mão de obra (orçado/realizado): adicionar da base, manual, editar qtd/preço, remover. */
export const LaborLinesEditor = ({ items, onChange, catalog = [], accent = '#E0FF00', testPrefix = 'mo', readOnly = false, extraActions = null }) => {
  const [pick, setPick] = useState('');
  const [openPicker, setOpenPicker] = useState(false);
  const pickerRef = useRef(null);

  const matches = useMemo(() => {
    const q = pick.trim().toLowerCase();
    if (!q) return catalog.slice(0, 8);
    return catalog.filter((c) => c.code.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q)).slice(0, 12);
  }, [pick, catalog]);

  const update = (id, patch) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch, total: Math.round(num(patch.qty ?? it.qty) * num(patch.unit_price ?? it.unit_price) * 100) / 100 } : it)));
  const remove = (id) => onChange(items.filter((it) => it.id !== id));
  const addFromCatalog = (c) => {
    const existing = items.find((it) => it.catalog_id === c.id);
    if (existing) { update(existing.id, { qty: num(existing.qty) + 1 }); }
    else onChange([...items, { id: uid(), catalog_id: c.id, code: c.code, description: c.description, unit: c.unit, unit_price: c.unit_price, qty: 1, total: c.unit_price, notes: '' }]);
    setPick(''); setOpenPicker(false);
  };
  const addManual = () => onChange([...items, { id: uid(), catalog_id: '', code: '', description: '', unit: 'UN', unit_price: 0, qty: 1, total: 0, notes: '' }]);
  const total = items.reduce((s, it) => s + num(it.total), 0);

  return (
    <div className="space-y-3" data-testid={`${testPrefix}-editor`}>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]" ref={pickerRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input data-testid={`${testPrefix}-pick`} value={pick} onFocus={() => setOpenPicker(true)} onBlur={() => setTimeout(() => setOpenPicker(false), 150)} onChange={(e) => { setPick(e.target.value); setOpenPicker(true); }}
              placeholder={catalog.length ? `Adicionar da base do contrato (${catalog.length} serviços)…` : 'Base do contrato vazia — importe em "Base do contrato"'}
              className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:outline-none" style={{ borderColor: openPicker ? accent : undefined }} />
            {openPicker && matches.length > 0 && (
              <div data-testid={`${testPrefix}-pick-list`} className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f10] shadow-2xl">
                {matches.map((c) => (
                  <button key={c.id} type="button" data-testid={`${testPrefix}-pick-${c.id}`} onMouseDown={(e) => e.preventDefault()} onClick={() => addFromCatalog(c)} className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2 text-xs">
                    <span className="font-mono text-[#E0FF00] w-20 truncate">{c.code || '—'}</span>
                    <span className="flex-1 text-white truncate">{c.description}</span>
                    <span className="text-zinc-500">{c.unit}</span>
                    <span className="font-mono text-zinc-300">{formatCurrency(c.unit_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" data-testid={`${testPrefix}-add-manual`} onClick={addManual} className="text-xs font-bold text-zinc-300 bg-white/5 hover:bg-white/10 px-3 py-2 rounded-full inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Linha manual</button>
          {extraActions}
        </div>
      )}
      <div className="rounded-xl border border-white/5 overflow-x-auto">
        <table className="w-full text-xs" data-testid={`${testPrefix}-table`}>
          <thead>
            <tr className="bg-white/[0.03] text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500">
              <th className="text-left px-2 py-2">Código</th><th className="text-left px-2 py-2">Serviço / Mão de obra</th><th className="px-2 py-2">Un</th>
              <th className="text-right px-2 py-2">Qtd</th><th className="text-right px-2 py-2">Preço unit.</th><th className="text-right px-2 py-2" style={{ color: accent }}>Total</th>{!readOnly && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500 italic">Nenhum item. {readOnly ? '' : 'Adicione da base do contrato ou crie uma linha manual.'}</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} data-testid={`${testPrefix}-row-${it.id}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-2 py-1.5">{readOnly ? <span className="font-mono text-[#E0FF00]">{it.code || '—'}</span> : <input data-testid={`${testPrefix}-code-${it.id}`} value={it.code} onChange={(e) => update(it.id, { code: e.target.value })} className={`${cell} w-20 font-mono text-[#E0FF00]`} />}</td>
                <td className="px-2 py-1.5">{readOnly ? <span className="text-white">{it.description}</span> : <input data-testid={`${testPrefix}-desc-${it.id}`} value={it.description} onChange={(e) => update(it.id, { description: e.target.value })} placeholder="Descrição do serviço" className={`${cell} w-full min-w-[220px]`} />}</td>
                <td className="px-2 py-1.5 text-center">{readOnly ? <span className="text-zinc-400">{it.unit}</span> : <input data-testid={`${testPrefix}-unit-${it.id}`} value={it.unit} onChange={(e) => update(it.id, { unit: e.target.value.toUpperCase() })} className={`${cell} w-12 text-center`} />}</td>
                <td className="px-2 py-1.5 text-right">{readOnly ? <span className="font-mono text-white">{it.qty}</span> : <input data-testid={`${testPrefix}-qty-${it.id}`} type="number" step="0.01" min="0" value={it.qty} onChange={(e) => update(it.id, { qty: e.target.value })} className={`${cell} w-20 text-right font-mono`} />}</td>
                <td className="px-2 py-1.5 text-right">{readOnly ? <span className="font-mono text-zinc-300">{formatCurrency(it.unit_price)}</span> : <input data-testid={`${testPrefix}-price-${it.id}`} type="number" step="0.01" min="0" value={it.unit_price} onChange={(e) => update(it.id, { unit_price: e.target.value })} className={`${cell} w-24 text-right font-mono`} />}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold text-white" data-testid={`${testPrefix}-total-${it.id}`}>{formatCurrency(it.total)}</td>
                {!readOnly && <td className="px-2 py-1.5 text-right"><button type="button" data-testid={`${testPrefix}-remove-${it.id}`} onClick={() => remove(it.id)} className="w-6 h-6 rounded-full bg-white/5 hover:bg-[#FF003C]/20 text-zinc-500 hover:text-[#FF003C] inline-flex items-center justify-center"><Trash2 className="w-3 h-3" /></button></td>}
              </tr>
            ))}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/[0.02]">
                <td colSpan={5} className="px-2 py-2 text-right text-[10px] uppercase tracking-wider font-bold text-zinc-500">{items.length} item(ns) · Total</td>
                <td className="px-2 py-2 text-right font-mono text-base font-black" style={{ color: accent }} data-testid={`${testPrefix}-grand-total`}>{formatCurrency(total)}</td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export const CopyIcon = Copy;
