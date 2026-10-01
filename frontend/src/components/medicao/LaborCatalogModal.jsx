import React, { useState, useRef, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { X, Upload, Plus, Trash2, Save, Search, BookOpen } from 'lucide-react';
import { formatCurrency } from '../../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const inp = 'bg-zinc-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:border-[#E0FF00] focus:outline-none';

/** Base geral do contrato: catálogo de serviços de mão de obra com preço unitário (import xlsx/csv + CRUD). */
export const LaborCatalogModal = ({ open, catalog, onClose, onChanged }) => {
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({ code: '', description: '', unit: 'UN', unit_price: '', group: '' });
  const [importing, setImporting] = useState(false);
  const [replace, setReplace] = useState(false);
  const fileRef = useRef(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? catalog.filter((c) => c.code.toLowerCase().includes(t) || c.description.toLowerCase().includes(t) || (c.group || '').toLowerCase().includes(t)) : catalog;
  }, [catalog, q]);
  if (!open) return null;

  const add = async () => {
    if (!draft.description.trim()) { toast.error('Descrição obrigatória'); return; }
    try {
      await axios.post(`${API}/medicao/catalogo`, { ...draft, unit_price: Number(draft.unit_price || 0) });
      toast.success('Serviço adicionado à base');
      setDraft({ code: '', description: '', unit: 'UN', unit_price: '', group: '' });
      onChanged();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao salvar'); }
  };
  const patch = async (c, field, value) => {
    const v = field === 'unit_price' ? Number(value || 0) : value;
    if (c[field] === v) return;
    try { await axios.patch(`${API}/medicao/catalogo/${c.id}`, { [field]: v }); onChanged(); } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao atualizar'); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Remover "${c.description}" da base?`)) return;
    try { await axios.delete(`${API}/medicao/catalogo/${c.id}`); toast.success('Removido'); onChanged(); } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };
  const importFile = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('replace', replace ? 'true' : 'false');
      const { data } = await axios.post(`${API}/medicao/catalogo/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`${data.imported} serviço(s) lidos · ${data.created} novos · ${data.updated} atualizados`);
      onChanged();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao importar planilha'); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" data-testid="mo-catalog-modal">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#0f0f10] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E0FF00]/15 border border-[#E0FF00]/40 flex items-center justify-center"><BookOpen className="w-5 h-5 text-[#E0FF00]" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#E0FF00] font-bold">Base geral do contrato</p>
            <h3 className="text-white font-bold text-lg">Serviços de mão de obra · {catalog.length} item(ns)</h3>
            <p className="text-[11px] text-zinc-500">Planilha com colunas Código · Descrição · Un · Preço unitário (opcional: Grupo). Itens com o mesmo código são atualizados.</p>
          </div>
          <button data-testid="mo-catalog-close" onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-white/5 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input data-testid="mo-catalog-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, descrição ou grupo…" className={`${inp} w-full pl-9`} />
          </div>
          <label className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer"><input data-testid="mo-catalog-replace" type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-[#E0FF00]" /> substituir base inteira</label>
          <input ref={fileRef} data-testid="mo-catalog-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
          <button data-testid="mo-catalog-import" disabled={importing} onClick={() => fileRef.current?.click()} className="text-xs font-bold text-black bg-[#00F0FF] hover:bg-[#00D9E5] px-3 py-2 rounded-full inline-flex items-center gap-1 disabled:opacity-50"><Upload className="w-3 h-3" /> {importing ? 'Importando…' : 'Importar planilha'}</button>
        </div>
        <div className="px-5 py-3 border-b border-white/5 grid grid-cols-2 md:grid-cols-6 gap-2 items-end bg-white/[0.02]">
          <div><label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Código</label><input data-testid="mo-catalog-new-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className={`${inp} w-full font-mono`} /></div>
          <div className="col-span-2"><label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Descrição *</label><input data-testid="mo-catalog-new-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${inp} w-full`} /></div>
          <div><label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Un</label><input data-testid="mo-catalog-new-unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value.toUpperCase() })} className={`${inp} w-full`} /></div>
          <div><label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Preço unit. (R$)</label><input data-testid="mo-catalog-new-price" type="number" step="0.01" value={draft.unit_price} onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })} className={`${inp} w-full font-mono`} /></div>
          <button data-testid="mo-catalog-add" onClick={add} className="text-xs font-black text-black bg-[#E0FF00] hover:bg-[#C8E600] px-3 py-2 rounded-full inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" /> Adicionar</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">{catalog.length === 0 ? 'Base vazia. Importe a planilha do contrato ou cadastre o primeiro serviço.' : 'Nada encontrado.'}</p>
          ) : (
            <table className="w-full text-xs" data-testid="mo-catalog-table">
              <thead className="sticky top-0 bg-[#0f0f10]"><tr className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 border-b border-white/5">
                <th className="text-left px-3 py-2">Código</th><th className="text-left px-3 py-2">Descrição</th><th className="text-left px-2 py-2">Grupo</th><th className="px-2 py-2">Un</th><th className="text-right px-3 py-2">Preço unit.</th><th className="px-2 py-2" /></tr></thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} data-testid={`mo-catalog-row-${c.id}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5"><input defaultValue={c.code} onBlur={(e) => patch(c, 'code', e.target.value)} className="bg-transparent border border-transparent hover:border-white/10 focus:border-[#E0FF00] rounded px-1 py-0.5 w-24 font-mono text-[#E0FF00] focus:outline-none" /></td>
                    <td className="px-3 py-1.5"><input defaultValue={c.description} onBlur={(e) => patch(c, 'description', e.target.value)} className="bg-transparent border border-transparent hover:border-white/10 focus:border-[#E0FF00] rounded px-1 py-0.5 w-full text-white focus:outline-none" /></td>
                    <td className="px-2 py-1.5"><input defaultValue={c.group} onBlur={(e) => patch(c, 'group', e.target.value)} className="bg-transparent border border-transparent hover:border-white/10 focus:border-[#E0FF00] rounded px-1 py-0.5 w-28 text-zinc-300 focus:outline-none" /></td>
                    <td className="px-2 py-1.5 text-center"><input defaultValue={c.unit} onBlur={(e) => patch(c, 'unit', e.target.value.toUpperCase())} className="bg-transparent border border-transparent hover:border-white/10 focus:border-[#E0FF00] rounded px-1 py-0.5 w-12 text-center text-zinc-300 focus:outline-none" /></td>
                    <td className="px-3 py-1.5 text-right"><input data-testid={`mo-catalog-price-${c.id}`} type="number" step="0.01" defaultValue={c.unit_price} onBlur={(e) => patch(c, 'unit_price', e.target.value)} className="bg-transparent border border-transparent hover:border-white/10 focus:border-[#E0FF00] rounded px-1 py-0.5 w-24 text-right font-mono text-white focus:outline-none" /></td>
                    <td className="px-2 py-1.5 text-right"><button data-testid={`mo-catalog-delete-${c.id}`} onClick={() => remove(c)} className="w-6 h-6 rounded-full bg-white/5 hover:bg-[#FF003C]/20 text-zinc-500 hover:text-[#FF003C] inline-flex items-center justify-center"><Trash2 className="w-3 h-3" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Total da base: <b className="font-mono text-white">{formatCurrency(catalog.reduce((s, c) => s + Number(c.unit_price || 0), 0))}</b> (soma dos preços unitários)</span>
          <button onClick={onClose} className="text-xs font-bold text-black bg-[#E0FF00] px-4 py-2 rounded-full inline-flex items-center gap-1"><Save className="w-3 h-3" /> Concluir</button>
        </div>
      </motion.div>
    </div>
  );
};
