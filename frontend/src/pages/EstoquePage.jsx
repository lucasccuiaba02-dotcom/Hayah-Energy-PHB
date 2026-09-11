import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Package, DollarSign, Target, AlertTriangle, TrendingDown, TrendingUp,
  Search, Filter, Upload, Download, Plus, Edit3, Trash2, X, Save,
  CircleAlert, CheckCircle2, FileSpreadsheet, RefreshCw, Layers,
} from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { MATERIAL_UNITS, formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmtPct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;
const numFmt = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const KpiCard = ({ icon: Icon, label, value, hint, color = '#E0FF00', testid, warn = false, onClick }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    data-testid={testid}
    onClick={onClick}
    className={`glass-panel rounded-2xl p-4 border ${onClick ? 'cursor-pointer hover:border-opacity-80 hover:bg-white/[0.02] transition' : ''}`}
    style={{ borderColor: warn ? '#FF003C55' : `${color}30` }}
  >
    <div className="flex items-center gap-2 mb-2">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15`, border: `1px solid ${color}40` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <p className="text-[10px] tracking-[0.22em] uppercase font-bold text-zinc-500">{label}</p>
    </div>
    <p className="font-mono text-2xl font-black text-white leading-none">{value}</p>
    {hint && <p className="text-[11px] text-zinc-500 mt-1">{hint}</p>}
  </motion.div>
);

const EditModal = ({ open, item, onClose, onSaved, onDelete }) => {
  const [form, setForm] = useState(item || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(item || {}); }, [item]);
  if (!open || !item) return null;
  const isNew = !item.id;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.code || !form.description) { toast.error('Código e descrição obrigatórios'); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code, description: form.description, unit: (form.unit || 'UN').toUpperCase(),
        family: form.family || '', group: form.group || '',
        qty_system: Number(form.qty_system || 0),
        qty_physical: Number(form.qty_physical || 0),
        unit_value: Number(form.unit_value || 0),
        min_stock: Number(form.min_stock || 0),
        notes: form.notes || '',
      };
      const url = isNew ? `${API}/estoque` : `${API}/estoque/${item.id}`;
      const { data } = isNew ? await axios.post(url, payload) : await axios.patch(url, payload);
      toast.success(isNew ? 'Item criado' : 'Item atualizado');
      onSaved(data);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar');
    } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!item.id) return onClose();
    if (!window.confirm(`Excluir ${item.code} — ${item.description}?`)) return;
    try {
      await axios.delete(`${API}/estoque/${item.id}`);
      toast.success('Item removido');
      onDelete(item.id);
      onClose();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" data-testid="est-edit-modal">
      <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#0f0f10] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#E0FF00] font-bold">{isNew ? 'Novo item de estoque' : 'Editar item de estoque'}</p>
            <h3 className="text-white font-bold text-lg">{form.code || 'Novo'} — {form.description || ''}</h3>
          </div>
          <button data-testid="est-edit-close" onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Código *</label>
            <input data-testid="est-form-code" value={form.code || ''} onChange={(e) => set('code', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Unidade</label>
            <select data-testid="est-form-unit" value={(form.unit || 'UN').toUpperCase()} onChange={(e) => set('unit', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none">
              {MATERIAL_UNITS.map((u) => <option key={u.value} value={u.value}>{u.value} — {u.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Descrição *</label>
            <input data-testid="est-form-description" value={form.description || ''} onChange={(e) => set('description', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Família</label>
            <input data-testid="est-form-family" value={form.family || ''} onChange={(e) => set('family', e.target.value)} placeholder="Ex: CONDUTORES" className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Grupo</label>
            <input data-testid="est-form-group" value={form.group || ''} onChange={(e) => set('group', e.target.value)} placeholder="Ex: BT" className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-[#39FF14] font-bold">Qtd Sistêmica</label>
            <input data-testid="est-form-qty-system" type="number" step="0.01" value={form.qty_system ?? 0} onChange={(e) => set('qty_system', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-[#39FF14]/30 rounded-lg px-3 py-2 text-white font-mono focus:border-[#39FF14] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-[#00F0FF] font-bold">Qtd Física</label>
            <input data-testid="est-form-qty-physical" type="number" step="0.01" value={form.qty_physical ?? 0} onChange={(e) => set('qty_physical', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-[#00F0FF]/30 rounded-lg px-3 py-2 text-white font-mono focus:border-[#00F0FF] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-[#E0FF00] font-bold">Valor Unitário (R$)</label>
            <input data-testid="est-form-unit-value" type="number" step="0.01" value={form.unit_value ?? 0} onChange={(e) => set('unit_value', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-[#E0FF00]/30 rounded-lg px-3 py-2 text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-[#FF003C] font-bold">Estoque Mínimo</label>
            <input data-testid="est-form-min-stock" type="number" step="0.01" value={form.min_stock ?? 0} onChange={(e) => set('min_stock', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-[#FF003C]/30 rounded-lg px-3 py-2 text-white font-mono focus:border-[#FF003C] focus:outline-none" />
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Notas</label>
            <textarea data-testid="est-form-notes" rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-2">
          {!isNew && (
            <button data-testid="est-form-delete" onClick={remove} className="inline-flex items-center gap-1 text-xs font-bold text-[#FF003C] hover:bg-[#FF003C]/10 px-3 py-2 rounded-lg">
              <Trash2 className="w-4 h-4" /> Excluir
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button data-testid="est-form-cancel" onClick={onClose} className="text-xs font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full">Cancelar</button>
            <button data-testid="est-form-save" onClick={save} disabled={saving} className="inline-flex items-center gap-2 text-xs font-black bg-[#E0FF00] hover:bg-[#C8E600] text-black px-5 py-2 rounded-full disabled:opacity-60">
              <Save className="w-4 h-4" /> {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const ImportModal = ({ open, onClose, onDone }) => {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('merge');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    if (!file) { toast.error('Selecione um arquivo'); return; }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      const { data } = await axios.post(`${API}/estoque/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      toast.success(`${data.imported} linhas processadas (${data.created} novas, ${data.updated} atualizadas)`);
      onDone();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro no import'); }
    finally { setImporting(false); }
  };

  useEffect(() => { if (!open) { setFile(null); setResult(null); } }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" data-testid="est-import-modal">
      <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#0f0f10] border border-white/10 rounded-2xl max-w-lg w-full">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#E0FF00] font-bold">Importar planilha sistêmica</p>
            <h3 className="text-white font-bold">Atualizar estoque a partir do sistema</h3>
          </div>
          <button data-testid="est-import-close" onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Aceita <strong className="text-white">.xlsx</strong> ou <strong className="text-white">.csv</strong>. Reconhece colunas <span className="text-[#E0FF00]">COD/CÓDIGO</span>, <span className="text-[#E0FF00]">DESCRIÇÃO</span>, <span className="text-[#E0FF00]">UNID</span>, <span className="text-[#E0FF00]">SOMA/QTD SISTEMA</span>, opcional <span className="text-[#E0FF00]">FAMILIA</span>, <span className="text-[#E0FF00]">GRUPO</span>. O upload atualiza qty_system e descrição/unidade dos códigos encontrados.
          </p>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Arquivo</label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              data-testid="est-import-file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full mt-1 text-xs text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-[#E0FF00] file:text-black file:font-bold file:cursor-pointer hover:file:bg-[#C8E600]"
            />
            {file && <p className="text-[11px] text-[#39FF14] mt-1">Selecionado: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Modo</label>
            <div className="flex gap-2 mt-1">
              {[
                { v: 'merge', l: 'Mesclar', hint: 'Cria/atualiza itens da planilha; mantém demais' },
                { v: 'replace_system_only', l: 'Substituir sistêmico', hint: 'Zera qty_system dos itens ausentes' },
              ].map((o) => (
                <button
                  key={o.v}
                  data-testid={`est-import-mode-${o.v}`}
                  onClick={() => setMode(o.v)}
                  className={`flex-1 text-left px-3 py-2 rounded-lg border text-xs transition ${
                    mode === o.v ? 'bg-[#E0FF00]/10 border-[#E0FF00]/50 text-white' : 'bg-white/5 border-white/10 text-zinc-500 hover:text-white'
                  }`}
                >
                  <p className="font-bold uppercase text-[10px] tracking-wider">{o.l}</p>
                  <p className="text-[10px] text-zinc-500 leading-tight mt-0.5">{o.hint}</p>
                </button>
              ))}
            </div>
          </div>
          {result && (
            <div className="rounded-lg bg-[#39FF14]/8 border border-[#39FF14]/30 p-3 text-xs" data-testid="est-import-result">
              <p className="font-bold text-[#39FF14] mb-1">✓ Importação concluída</p>
              <p className="text-zinc-300">Processadas: <span className="font-mono font-bold text-white">{result.imported}</span> · Criadas: <span className="font-mono font-bold text-white">{result.created}</span> · Atualizadas: <span className="font-mono font-bold text-white">{result.updated}</span>{result.zeroed_when_absent > 0 && <> · Zeradas: <span className="font-mono font-bold text-[#FF5E00]">{result.zeroed_when_absent}</span></>}</p>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button data-testid="est-import-cancel" onClick={onClose} className="text-xs font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full">Fechar</button>
          <button data-testid="est-import-submit" onClick={submit} disabled={!file || importing} className="inline-flex items-center gap-2 text-xs font-black bg-[#E0FF00] hover:bg-[#C8E600] text-black px-5 py-2 rounded-full disabled:opacity-60">
            <Upload className="w-4 h-4" /> {importing ? 'Enviando…' : 'Importar'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export const EstoquePage = () => {
  const [items, setItems] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [family, setFamily] = useState('');
  const [group, setGroup] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [divergent, setDivergent] = useState(false);
  const [families, setFamilies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [groupBy, setGroupBy] = useState('none'); // 'none' | 'family' | 'group'

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (family) params.set('family', family);
      if (group) params.set('group', group);
      if (lowStock) params.set('low_stock', '1');
      if (divergent) params.set('divergent', '1');
      const [{ data: list }, { data: k }, { data: f }] = await Promise.all([
        axios.get(`${API}/estoque?${params.toString()}`),
        axios.get(`${API}/estoque/kpis`),
        axios.get(`${API}/estoque/families`),
      ]);
      setItems(list.items || []);
      setKpis(k);
      setFamilies(f.families || []);
      setGroups(f.groups || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao carregar estoque');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [q, family, group, lowStock, divergent]);

  const grouped = useMemo(() => {
    if (groupBy === 'none') return { '': items };
    const acc = {};
    for (const it of items) {
      const key = (groupBy === 'family' ? it.family : it.group) || '(sem categoria)';
      if (!acc[key]) acc[key] = [];
      acc[key].push(it);
    }
    return acc;
  }, [items, groupBy]);

  const patchQty = async (item, field, value) => {
    const v = Number(value);
    if (isNaN(v)) return;
    try {
      const { data } = await axios.patch(`${API}/estoque/${item.id}`, { [field]: v });
      setItems((prev) => prev.map((x) => (x.id === item.id ? data : x)));
      // refresh KPIs periodically
      axios.get(`${API}/estoque/kpis`).then(({ data: k }) => setKpis(k)).catch(() => {});
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };

  const exportCsv = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/estoque/export`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `estoque-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Erro ao exportar'); }
  };

  const clearFilters = () => {
    setQ(''); setFamily(''); setGroup(''); setLowStock(false); setDivergent(false);
  };

  return (
    <AppLayout title="Estoque" subtitle="Contagem física, sistêmica e acuracidade">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard
          testid="est-kpi-value-phys"
          icon={DollarSign}
          label="Valor Físico Total"
          value={formatCurrency(kpis?.value_physical_total || 0)}
          hint={`${kpis?.total_items || 0} itens`}
          color="#00F0FF"
        />
        <KpiCard
          testid="est-kpi-value-sys"
          icon={FileSpreadsheet}
          label="Valor Sistêmico"
          value={formatCurrency(kpis?.value_system_total || 0)}
          hint={`Diferença: ${formatCurrency(kpis?.value_diff_total || 0)}`}
          color="#39FF14"
        />
        <KpiCard
          testid="est-kpi-accuracy"
          icon={Target}
          label="Acuracidade"
          value={fmtPct(kpis?.accuracy_global || 0)}
          hint={`${kpis?.divergent_count || 0} divergentes`}
          color={(kpis?.accuracy_global || 0) >= 0.9 ? '#39FF14' : (kpis?.accuracy_global || 0) >= 0.75 ? '#E0FF00' : '#FF5E00'}
        />
        <KpiCard
          testid="est-kpi-low-stock"
          icon={AlertTriangle}
          label="Itens em Alerta"
          value={numFmt(kpis?.low_stock_count || 0)}
          hint={`${kpis?.families_count || 0} famílias · ${kpis?.groups_count || 0} grupos · Clique para filtrar`}
          color="#FF003C"
          warn={(kpis?.low_stock_count || 0) > 0}
          onClick={() => setLowStock(true)}
        />
      </div>

      {/* Toolbar */}
      <div className="glass-panel rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              data-testid="est-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pesquisar código ou descrição…"
              className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#E0FF00] focus:outline-none"
            />
          </div>
          <select data-testid="est-filter-family" value={family} onChange={(e) => setFamily(e.target.value)} className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E0FF00] focus:outline-none">
            <option value="">Todas famílias</option>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select data-testid="est-filter-group" value={group} onChange={(e) => setGroup(e.target.value)} className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E0FF00] focus:outline-none">
            <option value="">Todos grupos</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <button
            data-testid="est-filter-low"
            onClick={() => setLowStock(!lowStock)}
            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-full border transition ${lowStock ? 'bg-[#FF003C]/15 border-[#FF003C]/40 text-[#FF003C]' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}
          >
            <AlertTriangle className="inline w-3 h-3 mr-1" /> Estoque baixo
          </button>
          <button
            data-testid="est-filter-divergent"
            onClick={() => setDivergent(!divergent)}
            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-full border transition ${divergent ? 'bg-[#E0FF00]/15 border-[#E0FF00]/40 text-[#E0FF00]' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}
          >
            <TrendingUp className="inline w-3 h-3 mr-1" /> Divergentes
          </button>
          {(q || family || group || lowStock || divergent) && (
            <button data-testid="est-clear-filters" onClick={clearFilters} className="text-[10px] font-bold uppercase text-zinc-500 hover:text-white">
              <X className="inline w-3 h-3 mr-0.5" /> Limpar
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 mr-2">
            <Layers className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Agrupar por:</span>
            {['none', 'family', 'group'].map((g) => (
              <button
                key={g}
                data-testid={`est-groupby-${g}`}
                onClick={() => setGroupBy(g)}
                className={`text-[10px] font-bold px-2 py-1 rounded-full border transition ${groupBy === g ? 'bg-[#E0FF00] text-black border-[#E0FF00]' : 'bg-white/5 text-zinc-400 border-white/10 hover:text-white'}`}
              >
                {g === 'none' ? 'Nenhum' : g === 'family' ? 'Família' : 'Grupo'}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button data-testid="est-reload" onClick={load} className="text-xs font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-2 rounded-full inline-flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Atualizar
            </button>
            <button data-testid="est-import-open" onClick={() => setImportOpen(true)} className="text-xs font-bold text-black bg-[#00F0FF] hover:bg-[#00D9E5] px-3 py-2 rounded-full inline-flex items-center gap-1">
              <Upload className="w-3 h-3" /> Importar sistêmico
            </button>
            <button data-testid="est-export" onClick={exportCsv} className="text-xs font-bold text-black bg-[#39FF14] hover:bg-[#2DE010] px-3 py-2 rounded-full inline-flex items-center gap-1">
              <Download className="w-3 h-3" /> Exportar
            </button>
            <button data-testid="est-new" onClick={() => setEditing({ code: '', description: '', unit: 'UN' })} className="text-xs font-black text-black bg-[#E0FF00] hover:bg-[#C8E600] px-3 py-2 rounded-full inline-flex items-center gap-1">
              <Plus className="w-3 h-3" /> Novo item
            </button>
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="glass-panel rounded-2xl overflow-hidden" data-testid="est-table-wrapper">
        {loading ? (
          <p className="p-6 text-center text-sm text-zinc-500">Carregando…</p>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400 font-bold">Nenhum item de estoque</p>
            <p className="text-[11px] text-zinc-500 mt-1">Importe a planilha sistêmica ou cadastre manualmente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="est-table">
              <thead>
                <tr className="bg-white/[0.03] text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500">
                  <th className="text-left px-3 py-2">Código</th>
                  <th className="text-left px-3 py-2">Descrição</th>
                  <th className="px-2 py-2">Un</th>
                  <th className="text-left px-2 py-2">Família / Grupo</th>
                  <th className="text-right px-2 py-2 text-[#39FF14]">Sistêmico</th>
                  <th className="text-right px-2 py-2 text-[#00F0FF]">Físico</th>
                  <th className="text-right px-2 py-2">Net</th>
                  <th className="text-right px-2 py-2">Acuracidade</th>
                  <th className="text-right px-2 py-2">Vlr Unit</th>
                  <th className="text-right px-2 py-2">Vlr Físico</th>
                  <th className="text-center px-2 py-2">Alerta</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([grpKey, grpItems]) => (
                  <React.Fragment key={grpKey || 'nogroup'}>
                    {groupBy !== 'none' && (
                      <tr data-testid={`est-group-${grpKey}`} className="bg-[#E0FF00]/[0.05] border-y border-[#E0FF00]/20">
                        <td colSpan={12} className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-[#E0FF00]">
                          <span className="inline-flex items-center gap-1"><Layers className="w-3 h-3" /> {grpKey}</span>
                          <span className="ml-2 text-zinc-500 font-mono normal-case">{grpItems.length} itens</span>
                        </td>
                      </tr>
                    )}
                    {grpItems.map((it) => (
                      <tr
                        key={it.id}
                        data-testid={`est-row-${it.code}`}
                        className={`border-t border-white/5 hover:bg-white/[0.02] ${it.is_low_stock ? 'bg-[#FF003C]/[0.03]' : ''}`}
                      >
                        <td className="px-3 py-2 font-mono text-[#E0FF00]">{it.code}</td>
                        <td className="px-3 py-2 text-white max-w-[280px] truncate" title={it.description}>{it.description}</td>
                        <td className="px-2 py-2 text-center text-zinc-400">{it.unit}</td>
                        <td className="px-2 py-2 text-[10px]">
                          <p className="text-zinc-300 truncate max-w-[140px]" title={it.family}>{it.family || '—'}</p>
                          {it.group && <p className="text-zinc-500 truncate max-w-[140px]" title={it.group}>{it.group}</p>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            data-testid={`est-qty-system-${it.code}`}
                            type="number"
                            step="0.01"
                            defaultValue={it.qty_system}
                            onBlur={(e) => { if (Number(e.target.value) !== it.qty_system) patchQty(it, 'qty_system', e.target.value); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                            className="w-20 bg-transparent border border-white/5 hover:border-[#39FF14]/40 focus:border-[#39FF14] rounded px-1.5 py-1 text-right text-[#39FF14] font-mono focus:outline-none focus:bg-zinc-950/60"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            data-testid={`est-qty-physical-${it.code}`}
                            type="number"
                            step="0.01"
                            defaultValue={it.qty_physical}
                            onBlur={(e) => { if (Number(e.target.value) !== it.qty_physical) patchQty(it, 'qty_physical', e.target.value); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                            className="w-20 bg-transparent border border-white/5 hover:border-[#00F0FF]/40 focus:border-[#00F0FF] rounded px-1.5 py-1 text-right text-[#00F0FF] font-mono focus:outline-none focus:bg-zinc-950/60"
                          />
                        </td>
                        <td className={`px-2 py-2 text-right font-mono font-bold ${it.net > 0 ? 'text-[#39FF14]' : it.net < 0 ? 'text-[#FF003C]' : 'text-zinc-500'}`}>
                          {it.net > 0 && '+'}{numFmt(it.net)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <span
                            className="inline-block font-mono text-[11px] font-bold px-1.5 py-0.5 rounded"
                            style={{
                              color: it.accuracy >= 0.9 ? '#39FF14' : it.accuracy >= 0.75 ? '#E0FF00' : '#FF5E00',
                              backgroundColor: it.accuracy >= 0.9 ? '#39FF1418' : it.accuracy >= 0.75 ? '#E0FF0018' : '#FF5E0018',
                            }}
                          >
                            {fmtPct(it.accuracy)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            data-testid={`est-unit-value-${it.code}`}
                            type="number"
                            step="0.01"
                            defaultValue={it.unit_value}
                            onBlur={(e) => { if (Number(e.target.value) !== it.unit_value) patchQty(it, 'unit_value', e.target.value); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                            className="w-20 bg-transparent border border-white/5 hover:border-[#E0FF00]/40 focus:border-[#E0FF00] rounded px-1.5 py-1 text-right text-white font-mono focus:outline-none focus:bg-zinc-950/60"
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-bold text-white">{formatCurrency(it.value_physical)}</td>
                        <td className="px-2 py-2 text-center">
                          {it.is_low_stock && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#FF003C] px-1.5 py-0.5 rounded-full bg-[#FF003C]/15 border border-[#FF003C]/40" title={`Estoque físico ≤ mínimo (${numFmt(it.min_stock)})`}>
                              <CircleAlert className="w-2.5 h-2.5" /> Baixo
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            data-testid={`est-edit-${it.code}`}
                            onClick={() => setEditing(it)}
                            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-[#E0FF00] flex items-center justify-center"
                            title="Editar item"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditModal
        open={!!editing}
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => { setItems((prev) => { const has = prev.find((x) => x.id === saved.id); return has ? prev.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...prev]; }); load(); }}
        onDelete={(id) => { setItems((prev) => prev.filter((x) => x.id !== id)); load(); }}
      />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={load}
      />
    </AppLayout>
  );
};

export default EstoquePage;
