import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, Gauge, Clock, DollarSign, Package, Plus, Trash2, Save, ExternalLink, Search, AlertTriangle, FileDown } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { AvancoQuickEntry, AvancoItemsTable, AvancoTimeline, ProgressBar, effColor } from '../components/AvancoWidgets';
import { AvancoPdfModal } from '../components/AvancoPdfModal';
import { formatCurrency, EXECUTION_STATUS_LABEL } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

const Kpi = ({ testid, label, value, sub, color = '#fff', icon: Icon }) => (
  <div data-testid={testid} className="glass-panel rounded-xl p-3 border-l-4" style={{ borderColor: color }}>
    <div className="flex items-center justify-between mb-1">
      <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">{label}</p>
      {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
    </div>
    <p className={`font-mono text-2xl font-black leading-none ${color === '#fff' ? 'text-white' : ''}`} style={color === '#fff' ? undefined : { color }}>{value}</p>
    {sub && <p className="text-[10px] text-zinc-500 mt-1">{sub}</p>}
  </div>
);

const ProjectCard = ({ p, active, onClick }) => {
  const st = EXECUTION_STATUS_LABEL[p.execution_status];
  const ec = effColor(p.eficiencia);
  return (
    <button
      data-testid={`avanco-project-${p.id}`}
      onClick={onClick}
      className={`w-full text-left glass-panel rounded-xl p-3 border transition ${active ? 'border-[#E0FF00] bg-[#E0FF00]/[0.06]' : 'border-white/10 hover:border-white/25'}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-xs font-bold text-[#E0FF00]">{p.project_code || '—'}</span>
        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: `${st?.color || '#94A3B8'}20`, color: st?.color || '#94A3B8' }}>{st?.label || p.execution_status}</span>
      </div>
      <p className="text-sm text-white font-bold truncate">{p.name}</p>
      <p className="text-[10px] text-zinc-500 truncate">{p.team_name || 'Sem equipe'} · {formatCurrency(p.programmed_value)}</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1"><ProgressBar pct={p.pct_fisico} color="#39FF14" h="h-1.5" /></div>
        <span className="font-mono text-[11px] font-bold text-[#39FF14]">{p.pct_fisico}%</span>
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px]">
        <span className="text-zinc-500">tempo {fmtPct(p.pct_tempo)}</span>
        <span className="font-bold" style={{ color: ec }}>efic. {p.eficiencia === null ? '—' : p.eficiencia.toFixed(2)}</span>
      </div>
    </button>
  );
};

const CurveChart = ({ data }) => (
  <ResponsiveContainer width="100%" height={240}>
    <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
      <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
      <XAxis dataKey="date" tickFormatter={(d) => d.slice(5).split('-').reverse().join('/')} tick={{ fontSize: 10, fill: '#a1a1aa' }} />
      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#a1a1aa' }} tickFormatter={(v) => `${v}%`} />
      <Tooltip contentStyle={{ background: '#0b0b0d', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }} formatter={(v) => (v === null ? '—' : `${v}%`)} labelFormatter={(d) => d.split('-').reverse().join('/')} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Line type="linear" dataKey="planned_pct" name="Planejado" stroke="#00F0FF" strokeDasharray="5 4" dot={false} strokeWidth={2} />
      <Line type="linear" dataKey="real_pct" name="Realizado" stroke="#39FF14" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} />
    </LineChart>
  </ResponsiveContainer>
);

const ItemsConfig = ({ projectId, detail, onSaved }) => {
  const [customs, setCustoms] = useState(detail.custom_items || []);
  const [weights, setWeights] = useState(detail.weights || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCustoms(detail.custom_items || []); setWeights(detail.weights || {}); }, [detail]);
  const save = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/projects/${projectId}/avanco/items`, { custom_items: customs, weights });
      toast.success('Etapas e pesos salvos');
      onSaved && onSaved();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao salvar'); } finally { setSaving(false); }
  };
  return (
    <div data-testid="avanco-items-config" className="space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">Pesos dos itens (quantitativos + etapas)</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {detail.items.map((i) => (
            <label key={i.key} className="flex items-center gap-2 text-[11px] text-zinc-300">
              <span className="flex-1 truncate">{i.label}</span>
              <input data-testid={`avanco-weight-${i.key}`} type="number" step="0.5" min="0" value={weights[i.key] ?? i.weight} onChange={(e) => setWeights((w) => ({ ...w, [i.key]: e.target.value }))} className="w-16 bg-zinc-950/90 border border-white/10 rounded px-2 py-1 text-xs text-white font-mono" />
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Etapas personalizadas</p>
          <button data-testid="avanco-add-custom" onClick={() => setCustoms((c) => [...c, { key: '', label: '', unit: 'un', planned_qty: 0 }])} className="text-[11px] font-bold text-[#00F0FF] inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Adicionar etapa</button>
        </div>
        {customs.length === 0 && <p className="text-[11px] text-zinc-600 italic">Ex.: Locação, Fundação, Lançamento de cabo…</p>}
        <div className="space-y-2">
          {customs.map((c, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2">
              <input data-testid={`avanco-custom-label-${idx}`} placeholder="Nome da etapa" value={c.label} onChange={(e) => setCustoms((arr) => arr.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} className="col-span-6 bg-zinc-950/90 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
              <input data-testid={`avanco-custom-unit-${idx}`} placeholder="un" value={c.unit} onChange={(e) => setCustoms((arr) => arr.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))} className="col-span-2 bg-zinc-950/90 border border-white/10 rounded px-2 py-1.5 text-xs text-white" />
              <input data-testid={`avanco-custom-qty-${idx}`} type="number" step="any" placeholder="Meta" value={c.planned_qty} onChange={(e) => setCustoms((arr) => arr.map((x, i) => i === idx ? { ...x, planned_qty: e.target.value } : x))} className="col-span-3 bg-zinc-950/90 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono" />
              <button onClick={() => setCustoms((arr) => arr.filter((_, i) => i !== idx))} className="col-span-1 text-zinc-500 hover:text-[#FF003C] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
      <button data-testid="avanco-items-save" disabled={saving} onClick={save} className="inline-flex items-center gap-1 bg-[#00F0FF]/15 border border-[#00F0FF]/50 text-[#00F0FF] text-xs font-bold px-4 py-1.5 rounded-full hover:bg-[#00F0FF]/25 disabled:opacity-50">
        <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando…' : 'Salvar etapas e pesos'}
      </button>
    </div>
  );
};

const MaterialsControl = ({ projectId, materials, summary, onChanged }) => {
  const setApplied = async (id, v) => {
    try {
      await axios.patch(`${API}/projects/${projectId}/materials/${id}`, { qty_applied: parseFloat(v) || 0 });
      onChanged && onChanged();
    } catch { toast.error('Erro ao salvar aplicado'); }
  };
  return (
    <div data-testid="avanco-materials">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-center">
        {[['Itens', summary.items, '#fff'], ['% Entregue', `${summary.pct_delivered}%`, '#00F0FF'], ['Pendentes', summary.pending_items, summary.pending_items ? '#FF5E00' : '#39FF14'], ['Valor lista', formatCurrency(summary.total_value), '#E0FF00']].map(([l, v, c]) => (
          <div key={l} className="rounded-lg p-2 bg-white/[0.02] border border-white/5">
            <p className="text-[9px] uppercase tracking-wider text-zinc-500">{l}</p>
            <p className="font-mono text-sm font-bold" style={{ color: c }}>{v}</p>
          </div>
        ))}
      </div>
      {materials.length === 0 ? <p className="text-[11px] text-zinc-500 italic">Sem lista de materiais nesta obra.</p> : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="text-[9px] uppercase tracking-wider text-zinc-500 bg-white/[0.03] sticky top-0">
              <tr><th className="text-left px-2 py-1.5">Código</th><th className="text-left px-2 py-1.5">Descrição</th><th className="text-right px-2 py-1.5">Solic.</th><th className="text-right px-2 py-1.5">Entregue</th><th className="text-right px-2 py-1.5">Aplicado</th><th className="text-right px-2 py-1.5">Saldo</th></tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const saldo = (m.qty_delivered || 0) - (m.qty_applied || 0);
                return (
                  <tr key={m.id} data-testid={`avanco-mat-${m.id}`} className="border-t border-white/5">
                    <td className="px-2 py-1 font-mono text-[#E0FF00]">{m.code || '—'}</td>
                    <td className="px-2 py-1 text-white truncate max-w-[200px]" title={m.item}>{m.item || '—'}</td>
                    <td className="px-2 py-1 text-right font-mono text-zinc-300">{m.qty_requested}</td>
                    <td className="px-2 py-1 text-right font-mono" style={{ color: m.pct_delivered >= 100 ? '#39FF14' : '#FF5E00' }}>{m.qty_delivered}</td>
                    <td className="px-2 py-1 text-right">
                      <input data-testid={`avanco-mat-applied-${m.id}`} type="number" step="any" defaultValue={m.qty_applied} onBlur={(e) => e.target.value !== String(m.qty_applied) && setApplied(m.id, e.target.value)} className="w-16 bg-zinc-950/90 border border-white/10 rounded px-1.5 py-0.5 text-right text-xs text-white font-mono" />
                    </td>
                    <td className="px-2 py-1 text-right font-mono font-bold" style={{ color: saldo < 0 ? '#FF003C' : '#a1a1aa' }}>{saldo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const AvancoFisicoPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [selectedId, setSelectedId] = useState(searchParams.get('obra') || '');
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const navigate = useNavigate();

  const loadList = useCallback(async () => {
    try { const { data } = await axios.get(`${API}/avanco/projects`, { params: { include_completed: showCompleted ? 1 : 0 } }); setList(data); } catch { toast.error('Erro ao carregar avanço físico'); }
  }, [showCompleted]);
  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    try { const { data } = await axios.get(`${API}/projects/${id}/avanco`); setDetail(data); } catch { toast.error('Erro ao carregar obra'); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);
  useEffect(() => {
    if (list && !selectedId && list.projects.length) setSelectedId(list.projects[0].id);
  }, [list, selectedId]);

  const select = (id) => { setSelectedId(id); setConfigOpen(false); setSearchParams({ obra: id }); };
  const refresh = () => { loadList(); loadDetail(selectedId); };

  const filteredProjects = useMemo(() => {
    const q = search.toLowerCase().trim();
    const ps = list?.projects || [];
    return q ? ps.filter((p) => (p.project_code || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q) || (p.team_name || '').toLowerCase().includes(q)) : ps;
  }, [list, search]);

  const s = detail?.summary;
  const [pdfOpen, setPdfOpen] = useState(false);
  const deleteEntry = async (eid) => {
    if (!window.confirm('Remover este lançamento?')) return;
    await axios.delete(`${API}/projects/${selectedId}/avanco/entries/${eid}`);
    toast.info('Lançamento removido');
    refresh();
  };

  return (
    <AppLayout title="Avanço Físico" subtitle={list ? `Obras acima de ${formatCurrency(list.threshold)} · Programadas · A Reprogramar · Em Execução · ${list.totals.count} obra(s)` : 'Obras de ticket grande'}>
      {list && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} data-testid="avanco-totals" className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Kpi testid="avanco-total-count" label="Obras" value={list.totals.count} sub={`> ${formatCurrency(list.threshold)}`} color="#E0FF00" icon={TrendingUp} />
          <Kpi testid="avanco-total-prog" label="Programado" value={formatCurrency(list.totals.programmed_value)} color="#fff" icon={DollarSign} />
          <Kpi testid="avanco-total-real" label="Produção" value={formatCurrency(list.totals.actual_value)} sub={list.totals.programmed_value ? `${Math.round(100 * list.totals.actual_value / list.totals.programmed_value)}% financeiro` : ''} color="#00F0FF" icon={DollarSign} />
          <Kpi testid="avanco-total-fisico" label="Físico médio" value={`${list.totals.avg_pct_fisico}%`} color="#39FF14" icon={Gauge} />
          <Kpi testid="avanco-total-critical" label="Críticas" value={list.totals.critical} sub="eficiência < 0,80" color={list.totals.critical ? '#FF003C' : '#39FF14'} icon={AlertTriangle} />
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="space-y-2">
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center gap-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <input data-testid="avanco-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar obra, código ou equipe…" className="flex-1 bg-transparent text-sm text-white focus:outline-none" />
          </div>
          <label data-testid="avanco-toggle-completed" className="flex items-center gap-2 px-1 text-[11px] text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} className="w-4 h-4 accent-[#00F0FF]" />
            Mostrar concluídas
            {!showCompleted && list?.totals?.hidden_completed > 0 && (
              <span data-testid="avanco-hidden-completed" className="ml-auto px-2 py-0.5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF] font-bold">{list.totals.hidden_completed} oculta(s)</span>
            )}
          </label>
          <div data-testid="avanco-project-list" className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {!list ? <p className="text-zinc-500 text-sm">Carregando…</p> : filteredProjects.length === 0 ? (
              <div className="glass-panel rounded-xl p-6 text-center text-zinc-500 text-sm">
                Nenhuma obra programada, a reprogramar ou em execução acima de {formatCurrency(list.threshold)}.
                <p className="text-[10px] text-zinc-600 mt-1">Obras aguardando programação entram aqui assim que forem programadas.</p>
              </div>
            ) : filteredProjects.map((p) => <ProjectCard key={p.id} p={p} active={p.id === selectedId} onClick={() => select(p.id)} />)}
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          {!detail || !s ? (
            <div className="glass-panel rounded-2xl p-10 text-center text-zinc-500">Selecione uma obra ao lado.</div>
          ) : (
            <>
              <div data-testid="avanco-detail-header" className="glass-panel rounded-2xl p-4 flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-mono text-xs font-bold text-[#E0FF00]">{s.project_code || '—'}</p>
                  <h2 className="font-heading font-black text-xl text-white leading-tight">{s.name}</h2>
                  <p className="text-[11px] text-zinc-400 mt-1">{s.team_name || 'Sem equipe'} · {s.location || '—'} · {s.start ? s.start.split('-').reverse().join('/') : '—'} → {s.end ? s.end.split('-').reverse().join('/') : '—'} {s.total_days ? `(${s.total_days} dias)` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500">Programado</p>
                  <p className="font-mono text-lg font-bold text-white">{formatCurrency(s.programmed_value)}</p>
                  <p className="text-[10px] text-zinc-500">Realizado <span className="text-[#00F0FF] font-bold">{formatCurrency(s.actual_value)}</span></p>
                </div>
                <div className="flex flex-col gap-2">
                  <button data-testid="avanco-download-pdf" onClick={() => setPdfOpen(true)} className="inline-flex items-center justify-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600]"><FileDown className="w-3.5 h-3.5" /> Relatório PDF</button>
                  <button data-testid="avanco-open-project" onClick={() => navigate(`/projeto/${s.id}`)} className="inline-flex items-center justify-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15 text-zinc-300 hover:bg-white/10"><ExternalLink className="w-3 h-3" /> Abrir obra</button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Kpi testid="avanco-kpi-fisico" label="% Físico" value={`${s.pct_fisico}%`} sub={`${s.items_count} item(ns) · ${s.entries_count} lançamento(s)`} color="#39FF14" icon={Gauge} />
                <Kpi testid="avanco-kpi-financeiro" label="% Financeiro" value={`${s.pct_financeiro}%`} sub="Produção ÷ Programado" color="#00F0FF" icon={DollarSign} />
                <Kpi testid="avanco-kpi-tempo" label="% Tempo" value={fmtPct(s.pct_tempo)} sub={s.pct_tempo === null ? 'defina Data Vencimento' : `${s.dias_trabalhados} dia(s) trabalhado(s)`} color="#E0FF00" icon={Clock} />
                <Kpi testid="avanco-kpi-eficiencia" label="Eficiência" value={s.eficiencia === null ? '—' : s.eficiencia.toFixed(2)} sub="% Físico ÷ % Tempo" color={effColor(s.eficiencia)} icon={TrendingUp} />
                <Kpi testid="avanco-kpi-dia" label="R$ / dia" value={formatCurrency(s.produzido_por_dia)} sub={`meta ${formatCurrency(s.meta_diaria)} · ${s.aderencia_diaria}%`} color={s.aderencia_diaria >= 100 ? '#39FF14' : s.aderencia_diaria >= 70 ? '#E0FF00' : '#FF5E00'} icon={DollarSign} />
              </div>

              <div className="glass-panel rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Lançar avanço</p>
                  <button data-testid="avanco-toggle-config" onClick={() => setConfigOpen((v) => !v)} className="text-[11px] font-bold text-[#00F0FF] underline">{configOpen ? 'Fechar configuração' : 'Etapas & pesos'}</button>
                </div>
                <AvancoQuickEntry projectId={s.id} items={detail.items} onSaved={refresh} />
                {configOpen && <div className="mt-4 pt-4 border-t border-white/5"><ItemsConfig projectId={s.id} detail={detail} onSaved={() => { setConfigOpen(false); refresh(); }} /></div>}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="glass-panel rounded-2xl p-4" data-testid="avanco-curve">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Curva S · planejado × realizado</p>
                  <CurveChart data={detail.curve} />
                </div>
                <div className="glass-panel rounded-2xl p-4" data-testid="avanco-items">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Itens de avanço</p>
                  {detail.items.length === 0 ? <p className="text-[11px] text-zinc-500 italic">Sem quantitativos cadastrados. Edite a obra na Carteira (postes, trafos, km…) ou adicione etapas em "Etapas & pesos".</p> : <AvancoItemsTable items={detail.items} />}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="glass-panel rounded-2xl p-4">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2 flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Controle de materiais</p>
                  <MaterialsControl projectId={s.id} materials={detail.materials} summary={s.materials} onChanged={refresh} />
                </div>
                <div className="glass-panel rounded-2xl p-4" data-testid="avanco-timeline">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Histórico de lançamentos</p>
                  <AvancoTimeline entries={detail.entries} items={detail.items} onDelete={deleteEntry} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <AvancoPdfModal open={pdfOpen} projectId={selectedId} projectCode={s?.project_code} onClose={() => setPdfOpen(false)} />
    </AppLayout>
  );
};
