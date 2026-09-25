import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Recycle, Scale, Package, DollarSign, ArrowDownToLine, ArrowUpFromLine, Search, Download, Plus, Edit3, Trash2, X, Save,
  ChevronDown, ChevronUp, History, RefreshCw,
} from 'lucide-react';
import { MATERIAL_UNITS, formatCurrency, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const ACCENT = '#FF5E00';
const numFmt = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const inputCls = 'w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#FF5E00] focus:outline-none';
const labelCls = 'text-[10px] tracking-widest uppercase text-zinc-500 font-bold';

const Kpi = ({ icon: Icon, label, value, hint, color = ACCENT, testid }) => (
  <div data-testid={testid} className="rounded-xl p-3 border" style={{ borderColor: `${color}30`, background: `${color}06` }}>
    <div className="flex items-center gap-1.5 mb-1">
      <Icon className="w-3.5 h-3.5" style={{ color }} />
      <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500">{label}</p>
    </div>
    <p className="font-mono text-xl font-black text-white leading-none">{value}</p>
    {hint && <p className="text-[10px] text-zinc-500 mt-1">{hint}</p>}
  </div>
);

const SucataKpis = ({ kpis }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4" data-testid="sucata-kpis">
    <Kpi testid="sucata-kpi-items" icon={Package} label="Itens" value={numFmt(kpis?.items)} hint={`${kpis?.items_with_balance || 0} com saldo`} />
    <Kpi testid="sucata-kpi-qty" icon={Recycle} label="Saldo Qtd" value={numFmt(kpis?.qty_total)} hint="unidades em sucata" color="#E0FF00" />
    <Kpi testid="sucata-kpi-kg" icon={Scale} label="Saldo Kg" value={`${numFmt(kpis?.kg_total)} kg`} hint={`+${numFmt(kpis?.kg_in_month)} kg no mês`} color="#00F0FF" />
    <Kpi testid="sucata-kpi-value" icon={DollarSign} label="Valor Estimado" value={formatCurrency(kpis?.estimated_value)} hint="saldo × valor unit./kg" color="#39FF14" />
    <Kpi testid="sucata-kpi-sold" icon={DollarSign} label="Vendido" value={formatCurrency(kpis?.sold_value)} hint="saídas com destino venda" color="#A855F7" />
    <Kpi testid="sucata-kpi-month" icon={History} label="Movimentos (mês)" value={`${kpis?.entries_month || 0} / ${kpis?.exits_month || 0}`} hint="entradas / saídas" color="#FFB800" />
  </div>
);

const ItemModal = ({ item, onClose, onSaved }) => {
  const [form, setForm] = useState({ code: '', description: '', unit: 'UN', family: '', unit_value: 0, kg_value: 0, notes: '', ...(item || {}) });
  const [saving, setSaving] = useState(false);
  const isNew = !item?.id;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.description?.trim()) { toast.error('Descrição obrigatória'); return; }
    setSaving(true);
    try {
      const payload = { code: form.code || '', description: form.description, unit: form.unit || 'UN', family: form.family || '', unit_value: Number(form.unit_value || 0), kg_value: Number(form.kg_value || 0), notes: form.notes || '' };
      const { data } = isNew ? await axios.post(`${API}/sucata`, payload) : await axios.patch(`${API}/sucata/${item.id}`, payload);
      toast.success(isNew ? 'Item de sucata criado' : 'Item atualizado');
      onSaved(data, isNew);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao salvar'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" data-testid="sucata-item-modal">
      <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#0f0f10] border border-white/10 rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold" style={{ color: ACCENT }}>{isNew ? 'Novo item de sucata' : 'Editar item de sucata'}</p>
            <h3 className="text-white font-bold text-lg">{form.description || 'Novo'}</h3>
          </div>
          <button data-testid="sucata-form-close" onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Código</label><input data-testid="sucata-form-code" value={form.code || ''} onChange={(e) => set('code', e.target.value)} placeholder="Ex: 90588" className={`${inputCls} font-mono`} /></div>
          <div>
            <label className={labelCls}>Unidade</label>
            <select data-testid="sucata-form-unit" value={(form.unit || 'UN').toUpperCase()} onChange={(e) => set('unit', e.target.value)} className={inputCls}>
              {MATERIAL_UNITS.map((u) => <option key={u.value} value={u.value}>{u.value}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><label className={labelCls}>Descrição *</label><input data-testid="sucata-form-description" value={form.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Ex: Cabo de alumínio 2 AWG retirado" className={inputCls} /></div>
          <div><label className={labelCls}>Família</label><input data-testid="sucata-form-family" value={form.family || ''} onChange={(e) => set('family', e.target.value)} placeholder="Ex: CONDUTORES" className={inputCls} /></div>
          <div><label className={labelCls} style={{ color: '#39FF14' }}>R$ por unidade (estimado)</label><input data-testid="sucata-form-unit-value" type="number" step="0.01" value={form.unit_value ?? 0} onChange={(e) => set('unit_value', e.target.value)} className={`${inputCls} font-mono`} /></div>
          <div><label className={labelCls} style={{ color: '#00F0FF' }}>R$ por kg (prevalece se &gt; 0)</label><input data-testid="sucata-form-kg-value" type="number" step="0.01" value={form.kg_value ?? 0} onChange={(e) => set('kg_value', e.target.value)} className={`${inputCls} font-mono`} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Notas</label><textarea data-testid="sucata-form-notes" rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className={inputCls} /></div>
        </div>
        <div className="px-5 py-4 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-bold text-zinc-400 hover:text-white px-4 py-2 rounded-full bg-white/5">Cancelar</button>
          <button data-testid="sucata-form-save" disabled={saving} onClick={save} className="inline-flex items-center gap-1 text-xs font-black text-black px-4 py-2 rounded-full disabled:opacity-50" style={{ background: ACCENT }}><Save className="w-3.5 h-3.5" /> {saving ? 'Salvando…' : isNew ? 'Criar e registrar entrada' : 'Salvar'}</button>
        </div>
      </motion.div>
    </div>
  );
};

const MovModal = ({ item, type, meta, projects, teams, onClose, onSaved }) => {
  const isIn = type === 'entrada';
  const [form, setForm] = useState({ qty: '', weight_kg: '', date: todayISO(), project_id: '', team_name: '', reason: isIn ? 'retirado_rede' : '', destination: isIn ? '' : 'venda', responsible: '', value: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const color = isIn ? '#39FF14' : '#FF003C';
  const options = isIn ? meta.reasons : meta.destinations;
  const save = async () => {
    if (!(Number(form.qty) > 0) && !(Number(form.weight_kg) > 0)) { toast.error('Informe quantidade ou peso (kg)'); return; }
    setSaving(true);
    try {
      const proj = projects.find((p) => p.id === form.project_id);
      const payload = {
        type, qty: Number(form.qty || 0), weight_kg: Number(form.weight_kg || 0), date: form.date, project_id: form.project_id || '',
        project_code: proj ? (proj.project_code || proj.name || '') : '', team_name: form.team_name || (proj?.team_name || ''),
        reason: isIn ? form.reason : '', destination: isIn ? '' : form.destination, responsible: form.responsible || '', value: Number(form.value || 0), notes: form.notes || '',
      };
      const { data } = await axios.post(`${API}/sucata/${item.id}/movements`, payload);
      toast.success(isIn ? 'Entrada registrada' : 'Saída registrada');
      onSaved(data.item);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao registrar'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" data-testid="sucata-mov-modal">
      <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#0f0f10] border border-white/10 rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold" style={{ color }}>{isIn ? 'Entrada de sucata' : 'Saída de sucata'}</p>
            <h3 className="text-white font-bold text-lg">{item.code ? <span className="font-mono text-[#E0FF00] mr-2">{item.code}</span> : null}{item.description}</h3>
            <p className="text-[11px] text-zinc-500 font-mono">Saldo atual: {numFmt(item.qty)} {item.unit} · {numFmt(item.weight_kg)} kg</p>
          </div>
          <button data-testid="sucata-mov-close" onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-3">
          <div><label className={labelCls} style={{ color }}>Quantidade ({item.unit})</label><input data-testid="sucata-mov-qty" type="number" step="0.001" min="0" value={form.qty} onChange={(e) => set('qty', e.target.value)} className={`${inputCls} font-mono`} /></div>
          <div><label className={labelCls} style={{ color: '#00F0FF' }}>Peso (kg)</label><input data-testid="sucata-mov-kg" type="number" step="0.001" min="0" value={form.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} className={`${inputCls} font-mono`} /></div>
          <div><label className={labelCls}>Data</label><input data-testid="sucata-mov-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputCls} /></div>
          <div>
            <label className={labelCls}>{isIn ? 'Motivo' : 'Destino'}</label>
            <select data-testid={isIn ? 'sucata-mov-reason' : 'sucata-mov-destination'} value={isIn ? form.reason : form.destination} onChange={(e) => set(isIn ? 'reason' : 'destination', e.target.value)} className={inputCls}>
              {Object.entries(options || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Obra de origem {isIn ? '' : '(opcional)'}</label>
            <select data-testid="sucata-mov-project" value={form.project_id} onChange={(e) => { const p = projects.find((x) => x.id === e.target.value); set('project_id', e.target.value); if (p?.team_name && !form.team_name) set('team_name', p.team_name); }} className={inputCls}>
              <option value="">— sem obra —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code || p.name}{p.project_code && p.name ? ` · ${p.name}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Equipe</label>
            <select data-testid="sucata-mov-team" value={form.team_name} onChange={(e) => set('team_name', e.target.value)} className={inputCls}>
              <option value="">— sem equipe —</option>
              {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Responsável</label><input data-testid="sucata-mov-responsible" value={form.responsible} onChange={(e) => set('responsible', e.target.value)} placeholder="Quem registrou / entregou" className={inputCls} /></div>
          <div><label className={labelCls} style={{ color: '#39FF14' }}>{isIn ? 'Valor estimado (R$)' : 'Valor da saída / venda (R$)'}</label><input data-testid="sucata-mov-value" type="number" step="0.01" min="0" value={form.value} onChange={(e) => set('value', e.target.value)} className={`${inputCls} font-mono`} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Observação</label><textarea data-testid="sucata-mov-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} /></div>
        </div>
        <div className="px-5 py-4 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-bold text-zinc-400 hover:text-white px-4 py-2 rounded-full bg-white/5">Cancelar</button>
          <button data-testid="sucata-mov-save" disabled={saving} onClick={save} className="inline-flex items-center gap-1 text-xs font-black text-black px-4 py-2 rounded-full disabled:opacity-50" style={{ background: color }}>
            {isIn ? <ArrowDownToLine className="w-3.5 h-3.5" /> : <ArrowUpFromLine className="w-3.5 h-3.5" />} {saving ? 'Salvando…' : isIn ? 'Registrar entrada' : 'Registrar saída'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const MovHistory = ({ item, meta, onDelete }) => (
  <tr data-testid={`sucata-history-${item.id}`} className="bg-black/40">
    <td colSpan={11} className="px-3 py-3">
      {item.movements.length === 0 ? <p className="text-[11px] text-zinc-500">Sem movimentações.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-[9px] uppercase tracking-wider text-zinc-500">
              <th className="text-left px-2 py-1">Data</th><th className="text-left px-2 py-1">Tipo</th><th className="text-right px-2 py-1">Qtd</th><th className="text-right px-2 py-1">Kg</th>
              <th className="text-left px-2 py-1">Obra</th><th className="text-left px-2 py-1">Equipe</th><th className="text-left px-2 py-1">Motivo / Destino</th><th className="text-left px-2 py-1">Responsável</th><th className="text-right px-2 py-1">R$</th><th className="text-left px-2 py-1">Obs</th><th></th>
            </tr></thead>
            <tbody>
              {item.movements.map((m) => (
                <tr key={m.id} data-testid={`sucata-mov-${m.id}`} className="border-t border-white/5">
                  <td className="px-2 py-1 font-mono text-zinc-300">{dateBR(m.date)}</td>
                  <td className="px-2 py-1"><span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ color: m.type === 'entrada' ? '#39FF14' : '#FF003C', background: m.type === 'entrada' ? '#39FF1418' : '#FF003C18' }}>{m.type === 'entrada' ? 'ENTRADA' : 'SAÍDA'}</span></td>
                  <td className="px-2 py-1 text-right font-mono text-white">{numFmt(m.qty)}</td>
                  <td className="px-2 py-1 text-right font-mono text-[#00F0FF]">{numFmt(m.weight_kg)}</td>
                  <td className="px-2 py-1 font-mono text-[#E0FF00]">{m.project_code || '—'}</td>
                  <td className="px-2 py-1 text-zinc-300">{m.team_name || '—'}</td>
                  <td className="px-2 py-1 text-zinc-300">{m.type === 'entrada' ? (meta.reasons?.[m.reason] || m.reason || '—') : (meta.destinations?.[m.destination] || m.destination || '—')}</td>
                  <td className="px-2 py-1 text-zinc-400">{m.responsible || '—'}</td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-300">{m.value ? formatCurrency(m.value) : '—'}</td>
                  <td className="px-2 py-1 text-zinc-500 max-w-[200px] truncate" title={m.notes}>{m.notes || ''}</td>
                  <td className="px-2 py-1 text-right"><button data-testid={`sucata-mov-delete-${m.id}`} onClick={() => onDelete(item, m)} title="Excluir movimentação" className="w-6 h-6 rounded-full bg-white/5 hover:bg-[#FF003C]/20 text-zinc-500 hover:text-[#FF003C] inline-flex items-center justify-center"><Trash2 className="w-3 h-3" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </td>
  </tr>
);

export const SucataPanel = () => {
  const [items, setItems] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [meta, setMeta] = useState({ reasons: {}, destinations: {} });
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const [onlyBalance, setOnlyBalance] = useState(false);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [itemModal, setItemModal] = useState(null);
  const [movModal, setMovModal] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (reason) params.set('reason', reason);
      if (onlyBalance) params.set('only_balance', '1');
      const [{ data: list }, { data: k }] = await Promise.all([axios.get(`${API}/sucata?${params.toString()}`), axios.get(`${API}/sucata/kpis`)]);
      setItems(list.items || []);
      setMeta({ reasons: list.reasons || {}, destinations: list.destinations || {} });
      setKpis(k);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao carregar sucata'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [q, reason, onlyBalance]);
  useEffect(() => {
    axios.get(`${API}/projects`).then(({ data }) => setProjects((Array.isArray(data) ? data : []).filter((p) => !['cancelado'].includes(p.execution_status)))).catch(() => {});
    axios.get(`${API}/teams`).then(({ data }) => setTeams(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const refreshKpis = () => axios.get(`${API}/sucata/kpis`).then(({ data }) => setKpis(data)).catch(() => {});
  const upsert = (saved) => { setItems((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev])); refreshKpis(); };

  const removeItem = async (it) => {
    if (!window.confirm(`Excluir "${it.description}" e todas as ${it.movements_count} movimentações?`)) return;
    try { await axios.delete(`${API}/sucata/${it.id}`); setItems((prev) => prev.filter((x) => x.id !== it.id)); refreshKpis(); toast.success('Item removido'); } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };
  const removeMov = async (it, m) => {
    if (!window.confirm(`Excluir ${m.type === 'entrada' ? 'entrada' : 'saída'} de ${dateBR(m.date)}?`)) return;
    try { const { data } = await axios.delete(`${API}/sucata/${it.id}/movements/${m.id}`); upsert(data.item); toast.success('Movimentação removida'); } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };
  const exportCsv = async () => {
    try {
      const res = await axios.get(`${API}/sucata/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = `sucata-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('Erro ao exportar'); }
  };

  const totals = useMemo(() => items.reduce((acc, i) => ({ qty: acc.qty + i.qty, kg: acc.kg + i.weight_kg, val: acc.val + i.estimated_value }), { qty: 0, kg: 0, val: 0 }), [items]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid="sucata-panel" id="sucata" className="glass-panel rounded-2xl p-4 mt-6 border" style={{ borderColor: `${ACCENT}30` }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${ACCENT}15`, border: `1px solid ${ACCENT}40` }}><Recycle className="w-4.5 h-4.5" style={{ color: ACCENT }} /></div>
          <div>
            <p className="text-[10px] tracking-[0.22em] uppercase font-bold text-zinc-500">Controle de Sucata</p>
            <p className="text-white font-bold text-sm">Materiais retirados da rede · entradas, saídas e saldo</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button data-testid="sucata-reload" onClick={load} className="text-xs font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-2 rounded-full inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Atualizar</button>
          <button data-testid="sucata-export" onClick={exportCsv} className="text-xs font-bold text-black bg-[#39FF14] hover:bg-[#2DE010] px-3 py-2 rounded-full inline-flex items-center gap-1"><Download className="w-3 h-3" /> Exportar CSV</button>
          <button data-testid="sucata-new" onClick={() => setItemModal({})} className="text-xs font-black text-black px-3 py-2 rounded-full inline-flex items-center gap-1 hover:brightness-110" style={{ background: ACCENT }}><Plus className="w-3 h-3" /> Novo item</button>
          <button data-testid="sucata-toggle" onClick={() => setOpen((o) => !o)} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center" title={open ? 'Recolher' : 'Expandir'}>{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
        </div>
      </div>

      <SucataKpis kpis={kpis} />

      {open && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input data-testid="sucata-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar código, descrição, família ou obra…" className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#FF5E00] focus:outline-none" />
            </div>
            <select data-testid="sucata-filter-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#FF5E00] focus:outline-none">
              <option value="">Todos os motivos</option>
              {Object.entries(meta.reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button data-testid="sucata-only-balance" onClick={() => setOnlyBalance((v) => !v)} className={`text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-full border transition ${onlyBalance ? 'bg-[#FF5E00]/15 border-[#FF5E00]/40 text-[#FF5E00]' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}>Só com saldo</button>
            <span className="text-[10px] text-zinc-500 font-mono ml-auto" data-testid="sucata-totals">{items.length} item(ns) · {numFmt(totals.qty)} un · {numFmt(totals.kg)} kg · {formatCurrency(totals.val)}</span>
          </div>

          <div className="rounded-xl overflow-hidden border border-white/5" data-testid="sucata-table-wrapper">
            {loading ? <p className="p-6 text-center text-sm text-zinc-500">Carregando…</p> : items.length === 0 ? (
              <div className="p-8 text-center">
                <Recycle className="w-9 h-9 text-zinc-600 mx-auto mb-2" />
                <p className="text-zinc-400 font-bold">Nenhum item de sucata</p>
                <p className="text-[11px] text-zinc-500 mt-1">Cadastre o material retirado da rede em "Novo item" e registre a entrada informando obra, equipe e motivo.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="sucata-table">
                  <thead>
                    <tr className="bg-white/[0.03] text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500">
                      <th className="text-left px-3 py-2">Código</th><th className="text-left px-3 py-2">Descrição</th><th className="px-2 py-2">Un</th>
                      <th className="text-right px-2 py-2 text-[#39FF14]">Entradas</th><th className="text-right px-2 py-2 text-[#FF003C]">Saídas</th>
                      <th className="text-right px-2 py-2" style={{ color: ACCENT }}>Saldo</th><th className="text-right px-2 py-2 text-[#00F0FF]">Saldo Kg</th>
                      <th className="text-right px-2 py-2">Vlr Estimado</th><th className="text-right px-2 py-2 text-[#A855F7]">Vendido</th><th className="text-left px-2 py-2">Última origem</th><th className="px-2 py-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <React.Fragment key={it.id}>
                        <tr data-testid={`sucata-row-${it.id}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                          <td className="px-3 py-2 font-mono text-[#E0FF00]">{it.code || '—'}</td>
                          <td className="px-3 py-2 text-white max-w-[260px]"><p className="truncate" title={it.description}>{it.description}</p>{it.family && <p className="text-[10px] text-zinc-500 truncate">{it.family}</p>}</td>
                          <td className="px-2 py-2 text-center text-zinc-400">{it.unit}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#39FF14]">{numFmt(it.qty_in)}{it.kg_in > 0 && <span className="block text-[9px] text-zinc-500">{numFmt(it.kg_in)} kg</span>}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#FF003C]">{numFmt(it.qty_out)}{it.kg_out > 0 && <span className="block text-[9px] text-zinc-500">{numFmt(it.kg_out)} kg</span>}</td>
                          <td className="px-2 py-2 text-right font-mono font-black text-white" data-testid={`sucata-balance-${it.id}`}>{numFmt(it.qty)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#00F0FF]" data-testid={`sucata-balance-kg-${it.id}`}>{numFmt(it.weight_kg)}</td>
                          <td className="px-2 py-2 text-right font-mono text-white">{formatCurrency(it.estimated_value)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#A855F7]">{it.sold_value ? formatCurrency(it.sold_value) : '—'}</td>
                          <td className="px-2 py-2 text-[10px] text-zinc-400 max-w-[180px]">
                            {it.last_origin ? <><span className="font-mono text-[#E0FF00]">{it.last_origin.project_code || '—'}</span>{it.last_origin.team_name ? ` · ${it.last_origin.team_name}` : ''}<br /><span className="text-zinc-500">{meta.reasons?.[it.last_origin.reason] || it.last_origin.reason || ''} · {dateBR(it.last_origin.date)}</span></> : '—'}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <button data-testid={`sucata-entrada-${it.id}`} onClick={() => setMovModal({ item: it, type: 'entrada' })} title="Registrar entrada" className="h-7 px-2 rounded-full bg-[#39FF14]/10 hover:bg-[#39FF14]/25 text-[#39FF14] inline-flex items-center gap-1 text-[10px] font-bold"><ArrowDownToLine className="w-3 h-3" /> Entrada</button>
                              <button data-testid={`sucata-saida-${it.id}`} onClick={() => setMovModal({ item: it, type: 'saida' })} title="Registrar saída" disabled={it.qty <= 0 && it.weight_kg <= 0} className="h-7 px-2 rounded-full bg-[#FF003C]/10 hover:bg-[#FF003C]/25 text-[#FF003C] inline-flex items-center gap-1 text-[10px] font-bold disabled:opacity-30 disabled:cursor-not-allowed"><ArrowUpFromLine className="w-3 h-3" /> Saída</button>
                              <button data-testid={`sucata-history-toggle-${it.id}`} onClick={() => setExpanded(expanded === it.id ? null : it.id)} title="Histórico" className={`w-7 h-7 rounded-full inline-flex items-center justify-center ${expanded === it.id ? 'bg-white/15 text-white' : 'bg-white/5 text-zinc-400 hover:text-white'}`}><History className="w-3 h-3" /><span className="sr-only">{it.movements_count}</span></button>
                              <button data-testid={`sucata-edit-${it.id}`} onClick={() => setItemModal(it)} title="Editar" className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-[#E0FF00] inline-flex items-center justify-center"><Edit3 className="w-3 h-3" /></button>
                              <button data-testid={`sucata-delete-${it.id}`} onClick={() => removeItem(it)} title="Excluir item" className="w-7 h-7 rounded-full bg-white/5 hover:bg-[#FF003C]/20 text-zinc-400 hover:text-[#FF003C] inline-flex items-center justify-center"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </td>
                        </tr>
                        {expanded === it.id && <MovHistory item={it} meta={meta} onDelete={removeMov} />}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {itemModal !== null && (
        <ItemModal item={itemModal.id ? itemModal : null} onClose={() => setItemModal(null)}
          onSaved={(saved, isNew) => { upsert(saved); setItemModal(null); if (isNew) setMovModal({ item: saved, type: 'entrada' }); }} />
      )}
      {movModal && (
        <MovModal item={movModal.item} type={movModal.type} meta={meta} projects={projects} teams={teams} onClose={() => setMovModal(null)}
          onSaved={(saved) => { upsert(saved); setMovModal(null); setExpanded(saved.id); }} />
      )}
    </motion.div>
  );
};
