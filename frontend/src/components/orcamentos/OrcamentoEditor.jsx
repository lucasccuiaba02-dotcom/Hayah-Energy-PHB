import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Save, Copy, FileDown, FileCheck2, Trash2, Ban, ChevronRight, MessageCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/constants';
import { openWhatsApp, orcamentoText } from '../../lib/whatsapp';
import { API, STATUS, statusOf, calcTotals, downloadPdf, num, fmtDate, btnGhost, btnPrimary } from './orcamentoShared';
import { OrcamentoClientTab } from './OrcamentoClientTab';
import { OrcamentoItemsTab } from './OrcamentoItemsTab';
import { OrcamentoPhotosTab } from './OrcamentoPhotosTab';
import { OrcamentoTextsTab } from './OrcamentoTextsTab';

const TEXT_KEYS = ['intro_text', 'labor_notes', 'material_notes', 'payment_terms', 'validity_text', 'mobilization_text', 'delivery_text', 'taxes_text'];
const TABS = [
  ['cliente', 'Cliente & Escopo'], ['labor', 'Mão de Obra'], ['mat', 'Materiais'], ['fotos', 'Fotos & Croquis'], ['textos', 'Textos & PDF'],
];
const FLOW = STATUS.filter((s) => s.key !== 'cancelado');

const toForm = (o) => ({
  client: { name: '', contact: '', phone: '', email: '', document: '', address: '', city: '', ...(o.client || {}) },
  objeto: o.objeto || '', location: o.location || '', base_date: (o.base_date || '').slice(0, 10), validity_days: o.validity_days || 30,
  scope_items: o.scope_items || [], labor_items: o.labor_items || [], material_items: o.material_items || [],
  material_markup_pct: o.material_markup_pct || 0, include_labor_table: !!o.include_labor_table, include_material_table: !!o.include_material_table,
  completion_notes: o.completion_notes || '', executed_by: o.executed_by || '', started_at: (o.started_at || '').slice(0, 10), finished_at: (o.finished_at || '').slice(0, 10), notes: o.notes || '',
  ...Object.fromEntries(TEXT_KEYS.map((k) => [k, o[k] || ''])),
});

const toBody = (f) => ({
  ...f,
  validity_days: parseInt(f.validity_days, 10) || 30,
  material_markup_pct: num(f.material_markup_pct),
  scope_items: f.scope_items.filter((s) => s.trim()),
  labor_items: f.labor_items.map((i) => ({ id: String(i.id || '').startsWith('tmp-') ? null : i.id, description: i.description || '', unit: i.unit || 'SV', qty: num(i.qty), unit_price: num(i.unit_price) })),
  material_items: f.material_items.map((i) => ({ id: String(i.id || '').startsWith('tmp-') ? null : i.id, code: i.code || '', description: i.description || '', unit: i.unit || 'UN', qty: num(i.qty), unit_cost: num(i.unit_cost), supplier: i.supplier || '' })),
});

export const OrcamentoEditor = ({ orc, onRefresh, onDeleted, onCreated, onBack }) => {
  const [form, setForm] = useState(() => toForm(orc));
  const [saved, setSaved] = useState(() => JSON.stringify(toForm(orc)));
  const [tab, setTab] = useState('cliente');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const f = toForm(orc); setForm(f); setSaved(JSON.stringify(f)); }, [orc]);

  const dirty = JSON.stringify(form) !== saved;
  const totals = useMemo(() => calcTotals(form), [form]);
  const st = statusOf(orc.status);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setClient = (k, v) => setForm((f) => ({ ...f, client: { ...f.client, [k]: v } }));

  const saveNow = useCallback(async () => {
    if (JSON.stringify(form) === saved) return orc;
    setSaving(true);
    try {
      const { data } = await axios.put(`${API}/orcamentos/${orc.id}`, toBody(form));
      setSaved(JSON.stringify(toForm(data)));
      onRefresh(data);
      toast.success('Orçamento salvo');
      return data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao salvar');
      throw e;
    } finally { setSaving(false); }
  }, [form, saved, orc, onRefresh]);

  const reload = async () => {
    const { data } = await axios.get(`${API}/orcamentos/${orc.id}`);
    onRefresh(data);
  };

  const setStatus = async (key) => {
    if (key === orc.status) return;
    if (key === 'cancelado' && !window.confirm('Cancelar este orçamento?')) return;
    try {
      if (dirty) await saveNow();
      await axios.post(`${API}/orcamentos/${orc.id}/status`, { status: key });
      toast.success(`Status: ${statusOf(key).label}`);
      await reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Falha ao mudar status'); }
  };

  const duplicate = async () => {
    try {
      if (dirty) await saveNow();
      const { data } = await axios.post(`${API}/orcamentos/${orc.id}/duplicate`);
      toast.success(`Cópia criada: ${data.code}`);
      onCreated(data);
    } catch { toast.error('Falha ao duplicar'); }
  };

  const remove = async () => {
    if (!window.confirm(`Excluir o orçamento ${orc.code}? Esta ação não pode ser desfeita.`)) return;
    try {
      await axios.delete(`${API}/orcamentos/${orc.id}`);
      toast.success('Orçamento excluído');
      onDeleted(orc.id);
    } catch { toast.error('Falha ao excluir'); }
  };

  const pdf = async (kind) => {
    try { if (dirty) await saveNow(); } catch { return; }
    const code = orc.code.replace('/', '-');
    await downloadPdf(`${API}/orcamentos/${orc.id}/pdf/${kind}`, `${kind === 'proposta' ? 'proposta_comercial' : 'relatorio_conclusao'}_${code}.pdf`);
  };

  return (
    <div className="space-y-4 min-w-0" data-testid="orc-editor">
      <div className="glass-panel rounded-2xl p-4 border border-white/10">
        <div className="flex items-start gap-3 flex-wrap">
          <button data-testid="orc-back" onClick={onBack} className="lg:hidden p-2 rounded-full hover:bg-white/10 text-zinc-300"><ArrowLeft className="w-4 h-4" /></button>
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span data-testid="orc-editor-code" className="font-mono text-sm font-black text-[#E0FF00]">Nº {orc.code}</span>
              <span data-testid="orc-editor-status" className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: `${st.color}22`, color: st.color, border: `1px solid ${st.color}55` }}>{st.label}</span>
              {dirty && <span data-testid="orc-dirty" className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF5E00]/15 text-[#FF5E00] border border-[#FF5E00]/40">alterações não salvas</span>}
            </div>
            <h2 className="font-heading font-black text-lg text-white leading-tight mt-1 truncate">{form.client.name || 'Novo cliente'}</h2>
            <p className="text-[11px] text-zinc-400 truncate">{form.objeto || 'Sem objeto definido'} · Data base {fmtDate(form.base_date)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button data-testid="orc-save" disabled={!dirty || saving} onClick={saveNow} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {saving ? 'Salvando…' : 'Salvar'}</button>
            <button data-testid="orc-pdf-proposta" onClick={() => pdf('proposta')} className={btnGhost}><FileDown className="w-3.5 h-3.5" /> Proposta PDF</button>
            <button data-testid="orc-pdf-conclusao" onClick={() => pdf('conclusao')} className={btnGhost}><FileCheck2 className="w-3.5 h-3.5" /> Conclusão PDF</button>
            <button data-testid="orc-whatsapp" onClick={() => openWhatsApp(orcamentoText({ ...form, code: orc.code }, totals), form.client.phone)} className={`${btnGhost} border-[#25D366]/50 text-[#25D366]`}><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</button>
            <button data-testid="orc-duplicate" onClick={duplicate} className={btnGhost}><Copy className="w-3.5 h-3.5" /> Duplicar</button>
            <button data-testid="orc-delete" onClick={remove} className={`${btnGhost} text-[#FF003C] border-[#FF003C]/40`}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1 flex-wrap" data-testid="orc-status-flow">
          {FLOW.map((s, i) => {
            const idx = FLOW.findIndex((x) => x.key === orc.status);
            const done = idx >= 0 && i <= idx;
            return (
              <React.Fragment key={s.key}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-zinc-600" />}
                <button data-testid={`orc-status-${s.key}`} onClick={() => setStatus(s.key)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase transition ${done ? 'text-black' : 'bg-white/5 border border-white/10 text-zinc-500 hover:text-white'}`} style={done ? { background: s.color } : {}}>{s.label}</button>
              </React.Fragment>
            );
          })}
          <button data-testid="orc-status-cancelado" onClick={() => setStatus('cancelado')} className={`ml-auto px-2.5 py-1 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1 ${orc.status === 'cancelado' ? 'bg-[#FF003C] text-black' : 'border border-[#FF003C]/40 text-[#FF003C] hover:bg-[#FF003C]/10'}`}><Ban className="w-3 h-3" /> Cancelar</button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[['orc-total-labor', 'Mão de obra', totals.labor_total, '#00F0FF'], ['orc-total-material', 'Materiais', totals.material_total, '#FF5E00'], ['orc-total-grand', 'Total da obra', totals.grand_total, '#E0FF00']].map(([tid, l, v, c]) => (
            <div key={tid} data-testid={tid} className="rounded-xl bg-white/[0.03] border-l-4 px-3 py-2" style={{ borderColor: c }}>
              <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500">{l}</p>
              <p className="font-mono text-sm sm:text-lg font-black truncate" style={{ color: c }}>{formatCurrency(v)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-4 border border-white/10">
        <div className="flex gap-1 overflow-x-auto pb-3 mb-3 border-b border-white/5" data-testid="orc-tabs">
          {TABS.map(([k, l]) => (
            <button key={k} data-testid={`orc-tab-btn-${k}`} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition ${tab === k ? 'bg-[#E0FF00] text-black' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
              {l}{k === 'fotos' && orc.photos?.length ? ` (${orc.photos.length})` : ''}{k === 'labor' && form.labor_items.length ? ` (${form.labor_items.length})` : ''}{k === 'mat' && form.material_items.length ? ` (${form.material_items.length})` : ''}
            </button>
          ))}
        </div>
        {tab === 'cliente' && <OrcamentoClientTab form={form} set={set} setClient={setClient} />}
        {tab === 'labor' && <OrcamentoItemsTab kind="labor" items={form.labor_items} onChange={(v) => set('labor_items', v)} />}
        {tab === 'mat' && <OrcamentoItemsTab kind="material" items={form.material_items} onChange={(v) => set('material_items', v)} markup={form.material_markup_pct} onMarkup={(v) => set('material_markup_pct', v)} orcId={orc.id} saveNow={saveNow} onImported={reload} />}
        {tab === 'fotos' && <OrcamentoPhotosTab orcId={orc.id} photos={orc.photos || []} onChanged={reload} />}
        {tab === 'textos' && <OrcamentoTextsTab form={form} set={set} />}
      </div>
    </div>
  );
};
