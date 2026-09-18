import React, { useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, Percent } from 'lucide-react';
import { formatCurrency } from '../../lib/constants';
import { API, inputCls, labelCls, btnGhost, btnPrimary, num } from './orcamentoShared';

const cell = 'bg-transparent border border-white/10 rounded px-2 py-1 text-[12px] text-white focus:border-[#E0FF00] focus:outline-none w-full';
const UNITS = ['SV', 'UN', 'PC', 'M', 'KM', 'KG', 'CX', 'RL', 'PAR', 'H', 'DIA', 'VB'];

const newRow = (kind) => (kind === 'labor'
  ? { id: `tmp-${Date.now()}`, description: '', unit: 'SV', qty: 1, unit_price: 0 }
  : { id: `tmp-${Date.now()}`, code: '', description: '', unit: 'UN', qty: 1, unit_cost: 0, supplier: '' });

const ImportBox = ({ orcId, onImported, saveNow }) => {
  const ref = useRef(null);
  const [supplier, setSupplier] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      await saveNow();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('supplier', supplier);
      fd.append('replace', replace ? 'true' : 'false');
      const { data } = await axios.post(`${API}/orcamentos/${orcId}/materials/import`, fd);
      onImported(data.items);
      toast.success(`${data.imported} material(is) importado(s) · ${data.total_items} na lista`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao importar planilha');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div data-testid="orc-mat-import" className="rounded-xl border border-dashed border-[#00F0FF]/40 bg-[#00F0FF]/[0.04] p-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
      <div>
        <label className={labelCls}>Importar planilha do fornecedor (xlsx/csv)</label>
        <input data-testid="orc-mat-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Fornecedor / distribuidor (opcional)" className={inputCls} />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-zinc-400 pb-2 cursor-pointer select-none">
        <input data-testid="orc-mat-replace" type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="w-4 h-4 accent-[#00F0FF]" /> substituir lista
      </label>
      <button data-testid="orc-mat-import-btn" disabled={busy} onClick={() => ref.current?.click()} className={btnGhost}><Upload className="w-3.5 h-3.5" /> {busy ? 'Importando…' : 'Escolher arquivo'}</button>
      <input ref={ref} data-testid="orc-mat-import-file" type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <p className="sm:col-span-3 text-[10px] text-zinc-500">Detecta automaticamente colunas de código, descrição, unidade, quantidade e preço unitário.</p>
    </div>
  );
};

export const OrcamentoItemsTab = ({ kind, items, onChange, markup, onMarkup, orcId, saveNow, onImported }) => {
  const isLabor = kind === 'labor';
  const mk = num(markup);
  const update = (idx, k, v) => onChange(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  const remove = (idx) => onChange(items.filter((_, i) => i !== idx));
  const rowTotal = (it) => (isLabor ? num(it.qty) * num(it.unit_price) : num(it.qty) * num(it.unit_cost) * (1 + mk / 100));
  const total = items.reduce((s, it) => s + rowTotal(it), 0);
  const cost = isLabor ? 0 : items.reduce((s, it) => s + num(it.qty) * num(it.unit_cost), 0);
  const tid = isLabor ? 'labor' : 'mat';

  return (
    <div className="space-y-3" data-testid={`orc-tab-${tid}`}>
      {!isLabor && (
        <>
          <ImportBox orcId={orcId} onImported={onImported || onChange} saveNow={saveNow} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <label className={labelCls}>Margem sobre materiais (%)</label>
              <div className="relative">
                <input data-testid="orc-mat-markup" type="number" step="0.5" value={markup} onChange={(e) => onMarkup(e.target.value)} className={`${inputCls} pr-8`} />
                <Percent className="w-3.5 h-3.5 text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 pb-2">Custo fornecedor <span className="text-white font-bold" data-testid="orc-mat-cost-total">{formatCurrency(cost)}</span> → preço ao cliente <span className="text-[#E0FF00] font-bold">{formatCurrency(total)}</span></p>
          </div>
        </>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-[12px]" data-testid={`orc-${tid}-table`}>
          <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              {!isLabor && <th className="text-left px-2 py-2 w-24">Código</th>}
              <th className="text-left px-2 py-2 min-w-[220px]">{isLabor ? 'Descrição do serviço' : 'Descrição do material'}</th>
              <th className="px-2 py-2 w-20">Un</th>
              <th className="px-2 py-2 w-20">Qtd</th>
              <th className="px-2 py-2 w-28">{isLabor ? 'Preço unit.' : 'Custo unit.'}</th>
              {!isLabor && <th className="px-2 py-2 w-28">Preço c/ margem</th>}
              <th className="px-2 py-2 w-28 text-right">Total</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={isLabor ? 6 : 8} className="px-3 py-6 text-center text-zinc-500 italic">Nenhum item. Adicione abaixo{isLabor ? '' : ' ou importe a planilha do fornecedor'}.</td></tr>
            )}
            {items.map((it, i) => (
              <tr key={it.id || i} data-testid={`orc-${tid}-row-${i}`} className="border-t border-white/5">
                {!isLabor && <td className="px-1 py-1"><input data-testid={`orc-${tid}-code-${i}`} value={it.code || ''} onChange={(e) => update(i, 'code', e.target.value)} className={`${cell} font-mono`} /></td>}
                <td className="px-1 py-1"><input data-testid={`orc-${tid}-desc-${i}`} value={it.description || ''} onChange={(e) => update(i, 'description', e.target.value)} className={cell} /></td>
                <td className="px-1 py-1">
                  <input data-testid={`orc-${tid}-unit-${i}`} list={`orc-units-${tid}`} value={it.unit || ''} onChange={(e) => update(i, 'unit', e.target.value.toUpperCase())} className={`${cell} text-center uppercase`} />
                </td>
                <td className="px-1 py-1"><input data-testid={`orc-${tid}-qty-${i}`} type="number" step="any" value={it.qty} onChange={(e) => update(i, 'qty', e.target.value)} className={`${cell} text-right font-mono`} /></td>
                <td className="px-1 py-1"><input data-testid={`orc-${tid}-price-${i}`} type="number" step="0.01" value={isLabor ? it.unit_price : it.unit_cost} onChange={(e) => update(i, isLabor ? 'unit_price' : 'unit_cost', e.target.value)} className={`${cell} text-right font-mono`} /></td>
                {!isLabor && <td className="px-2 py-1 text-right font-mono text-zinc-400">{formatCurrency(num(it.unit_cost) * (1 + mk / 100))}</td>}
                <td className="px-2 py-1 text-right font-mono font-bold text-white" data-testid={`orc-${tid}-total-${i}`}>{formatCurrency(rowTotal(it))}</td>
                <td className="px-1 py-1"><button data-testid={`orc-${tid}-remove-${i}`} onClick={() => remove(i)} className="p-1 rounded text-zinc-500 hover:text-[#FF003C]"><Trash2 className="w-3.5 h-3.5" /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 bg-white/[0.03]">
              <td colSpan={isLabor ? 4 : 6} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Total {isLabor ? 'mão de obra' : 'materiais'}</td>
              <td className="px-2 py-2 text-right font-mono font-black text-[#E0FF00]" data-testid={`orc-${tid}-sum`}>{formatCurrency(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <datalist id={`orc-units-${tid}`}>{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      </div>
      <button data-testid={`orc-${tid}-add`} onClick={() => onChange([...items, newRow(kind)])} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Adicionar {isLabor ? 'serviço' : 'material'}</button>
    </div>
  );
};
