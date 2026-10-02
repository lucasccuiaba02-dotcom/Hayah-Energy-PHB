import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Search, Ruler, BookOpen, Save, Upload, Copy, CheckCircle2, DollarSign, ClipboardList, TrendingUp, ArrowRight, FileDown, Mail, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { formatCurrency, EXECUTION_STATUS_LABEL, PROJECT_TYPE_LABEL } from '../lib/constants';
import { LaborLinesEditor } from '../components/medicao/LaborLinesEditor';
import { LaborCatalogModal } from '../components/medicao/LaborCatalogModal';
import { MedicaoEnvioModal, downloadMedicaoPdf } from '../components/medicao/MedicaoEnvioModal';
import { FecharMedicaoModal } from '../components/medicao/FecharMedicaoModal';
import { MedicoesHistory } from '../components/medicao/MedicoesHistory';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const BILLING_LABEL = { recebimento_tecnico: 'Recebimento Técnico', em_fechamento: 'Em Fechamento', ajuste_material: 'Ajuste de Material', pendencia_construtiva: 'Pendência Construtiva', aguardando_fiscalizacao: 'Aguardando Fiscalização', digitada: 'Digitada', aprovada: 'Aprovada', pago: 'Pago' };
const dateBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const Kpi = ({ icon: Icon, label, value, hint, color, testid }) => (
  <div data-testid={testid} className="glass-panel rounded-2xl p-4 border" style={{ borderColor: `${color}30` }}>
    <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, border: `1px solid ${color}40` }}><Icon className="w-4 h-4" style={{ color }} /></div><p className="text-[10px] tracking-[0.22em] uppercase font-bold text-zinc-500">{label}</p></div>
    <p className="font-mono text-2xl font-black text-white leading-none">{value}</p>
    {hint && <p className="text-[11px] text-zinc-500 mt-1">{hint}</p>}
  </div>
);

const ProjectList = ({ projects, selectedId, onSelect, q, setQ, filter, setFilter }) => (
  <div className="glass-panel rounded-2xl overflow-hidden min-w-0" data-testid="mo-project-list">
    <div className="p-3 border-b border-white/5 space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
        <input data-testid="mo-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar obra, código ou equipe…" className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#E0FF00] focus:outline-none" />
      </div>
      <div className="flex gap-1 flex-wrap">
        {[['all', 'Todas'], ['pending', 'Sem medição'], ['measured', 'Medidas'], ['closing', 'Em fechamento']].map(([k, l]) => (
          <button key={k} data-testid={`mo-filter-${k}`} onClick={() => setFilter(k)} className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition ${filter === k ? 'bg-[#E0FF00] text-black border-[#E0FF00]' : 'bg-white/5 text-zinc-400 border-white/10 hover:text-white'}`}>{l}</button>
        ))}
      </div>
    </div>
    <div className="max-h-[70vh] overflow-y-auto divide-y divide-white/5">
      {projects.length === 0 ? <p className="p-6 text-center text-xs text-zinc-500 italic">Nenhuma obra</p> : projects.map((p) => {
        const active = p.id === selectedId;
        const st = EXECUTION_STATUS_LABEL[p.execution_status];
        return (
          <button key={p.id} data-testid={`mo-project-${p.id}`} onClick={() => onSelect(p.id)} className={`w-full text-left px-3 py-2.5 transition ${active ? 'bg-[#E0FF00]/10 border-l-2 border-[#E0FF00]' : 'hover:bg-white/[0.02] border-l-2 border-transparent'}`}>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {p.project_code && <p className="font-mono text-[10px] text-[#E0FF00] uppercase tracking-wider">{p.project_code}</p>}
                <p className={`text-sm font-bold truncate ${active ? 'text-white' : 'text-zinc-300'}`}>{p.name}</p>
                <p className="text-[10px] text-zinc-500 truncate">{p.team_name || '—'}{st ? ` · ${st.label}` : ''}{p.billing_stage ? ` · ${BILLING_LABEL[p.billing_stage] || p.billing_stage}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[11px] text-zinc-400">Orç. {formatCurrency(p.orcado)}</p>
                <p className={`font-mono text-[11px] font-bold ${p.realizado_count ? 'text-[#39FF14]' : 'text-zinc-600'}`}>Real. {formatCurrency(p.realizado)}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

export const MedicaoPage = () => {
  const navigate = useNavigate();
  const [list, setList] = useState({ projects: [], totals: {} });
  const [catalog, setCatalog] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [budget, setBudget] = useState([]);
  const [measured, setMeasured] = useState([]);
  const [tab, setTab] = useState('realizado');
  const [saving, setSaving] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [envioOpen, setEnvioOpen] = useState(false);
  const [envioMedicao, setEnvioMedicao] = useState(null);
  const [fecharOpen, setFecharOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef(null);

  const loadList = async () => {
    try { const { data } = await axios.get(`${API}/medicao/projects`); setList(data); if (!selectedId && data.projects?.[0]) setSelectedId(data.projects[0].id); }
    catch { toast.error('Erro ao carregar obras'); }
  };
  const loadCatalog = async () => { try { const { data } = await axios.get(`${API}/medicao/catalogo`); setCatalog(data.items || []); } catch { /* silencioso */ } };
  const loadDetail = async (pid) => {
    if (!pid) return;
    try { const { data } = await axios.get(`${API}/projects/${pid}/medicao`); setDetail(data); setBudget(data.budget || []); setMeasured(data.measured || []); }
    catch { toast.error('Erro ao carregar medição da obra'); }
  };
  useEffect(() => { loadList(); loadCatalog(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { loadDetail(selectedId); }, [selectedId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return list.projects.filter((p) => {
      if (t && !(p.project_code || '').toLowerCase().includes(t) && !(p.name || '').toLowerCase().includes(t) && !(p.team_name || '').toLowerCase().includes(t)) return false;
      if (filter === 'pending') return !p.realizado_count;
      if (filter === 'measured') return p.realizado_count > 0;
      if (filter === 'closing') return ['concluido', 'executada'].includes(p.execution_status) || !!p.billing_stage;
      return true;
    });
  }, [list, q, filter]);

  const dirty = useMemo(() => JSON.stringify(tab === 'orcado' ? budget : measured) !== JSON.stringify(tab === 'orcado' ? detail?.budget || [] : detail?.measured || []), [tab, budget, measured, detail]);
  const sum = (items) => items.reduce((s, i) => s + Number(i.total || 0), 0);

  const save = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const items = (tab === 'orcado' ? budget : measured).map((i) => ({ ...i, qty: Number(i.qty || 0), unit_price: Number(i.unit_price || 0) }));
      const { data } = await axios.put(`${API}/projects/${detail.project.id}/medicao/${tab}`, { items });
      setDetail(data); setBudget(data.budget); setMeasured(data.measured);
      toast.success(tab === 'orcado' ? `Orçado salvo · Mão de obra da obra = ${formatCurrency(data.totals.orcado)}` : `Medição salva · Produção Realizada = ${formatCurrency(data.totals.realizado)} (já na esteira de Faturamento)`);
      loadList();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao salvar'); } finally { setSaving(false); }
  };
  const copyFromBudget = async () => {
    if (!detail) return;
    if (measured.length && !window.confirm('Substituir a lista realizada pela lista orçada?')) return;
    try { const { data } = await axios.post(`${API}/projects/${detail.project.id}/medicao/realizado/from-orcado`); setDetail(data); setBudget(data.budget); setMeasured(data.measured); setTab('realizado'); toast.success('Realizado copiado do orçado e aplicado à Produção Realizada'); loadList(); }
    catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };
  const importBudget = async (file) => {
    if (!file || !detail) return;
    setImporting(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('replace', budget.length ? String(window.confirm('Substituir a lista orçada atual? (Cancelar = acrescentar)')) : 'true');
      const { data } = await axios.post(`${API}/projects/${detail.project.id}/medicao/orcado/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDetail(data); setBudget(data.budget); setMeasured(data.measured); toast.success(`${data.imported} item(ns) importados · Orçado ${formatCurrency(data.totals.orcado)}`); loadList();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao importar'); } finally { setImporting(false); if (importRef.current) importRef.current.value = ''; }
  };
  const applyDetail = (data) => { if (!data?.project) return; setDetail(data); setBudget(data.budget || []); setMeasured(data.measured || []); loadList(); };
  const reabrir = async (m) => {
    if (!detail || !window.confirm(`Reabrir a Medição nº ${m.number}? Os itens voltam para a medição em aberto.`)) return;
    try { const { data } = await axios.post(`${API}/projects/${detail.project.id}/medicao/${m.id}/reabrir`); applyDetail(data); setTab('realizado'); toast.success(`Medição nº ${m.number} reaberta`); }
    catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao reabrir'); }
  };
  const openEnvio = (m = null) => { setEnvioMedicao(m); setEnvioOpen(true); };

  const p = detail?.project;
  const t = list.totals || {};
  return (
    <AppLayout title="Medição de Mão de Obra" subtitle="Base do contrato · Orçado por obra · Realizado no fechamento → Produção Realizada (Faturamento)"
      actions={<button data-testid="mo-catalog-open" onClick={() => setCatalogOpen(true)} className="inline-flex items-center gap-1 text-xs font-bold text-black bg-[#E0FF00] hover:bg-[#C8E600] px-4 py-2 rounded-full"><BookOpen className="w-3.5 h-3.5" /> Base do contrato ({catalog.length})</button>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi testid="mo-kpi-base" icon={BookOpen} label="Serviços na base" value={catalog.length} hint="base geral do contrato" color="#E0FF00" />
        <Kpi testid="mo-kpi-orcado" icon={ClipboardList} label="Orçado (todas)" value={formatCurrency(t.orcado)} hint={`${t.projects || 0} obras`} color="#00F0FF" />
        <Kpi testid="mo-kpi-realizado" icon={DollarSign} label="Realizado (medido)" value={formatCurrency(t.realizado)} hint={`${t.with_measurement || 0} obra(s) com medição`} color="#39FF14" />
        <Kpi testid="mo-kpi-pct" icon={TrendingUp} label="Realizado ÷ Orçado" value={t.orcado ? `${(100 * (t.realizado || 0) / t.orcado).toFixed(1)}%` : '—'} hint="aderência global" color="#FF5E00" />
      </div>

      <div className="grid lg:grid-cols-[340px_1fr] gap-4 min-w-0">
        <ProjectList projects={filtered} selectedId={selectedId} onSelect={setSelectedId} q={q} setQ={setQ} filter={filter} setFilter={setFilter} />

        {!p ? (
          <div className="glass-panel rounded-2xl p-10 text-center"><Ruler className="w-12 h-12 text-zinc-600 mx-auto mb-3" /><p className="text-zinc-400 font-bold">Escolha uma obra para lançar a medição</p></div>
        ) : (
          <motion.div key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 min-w-0" data-testid="mo-detail">
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  {p.project_code && <p className="font-mono text-[11px] text-[#E0FF00] uppercase tracking-wider">{p.project_code}</p>}
                  <h2 className="text-white text-xl font-bold truncate" data-testid="mo-detail-name">{p.name}</h2>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{p.team_name || '—'}{p.project_type ? ` · ${PROJECT_TYPE_LABEL[p.project_type] || p.project_type}` : ''}{EXECUTION_STATUS_LABEL[p.execution_status] ? ` · ${EXECUTION_STATUS_LABEL[p.execution_status].label}` : ''}{p.billing_stage ? ` · Faturamento: ${BILLING_LABEL[p.billing_stage] || p.billing_stage}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button data-testid="mo-pdf" disabled={!detail.totals.realizado_count} onClick={() => downloadMedicaoPdf(p.id)} title={detail.totals.realizado_count ? 'Baixar o Resumo de Mão de Obra da medição em aberto (PDF)' : 'Lance e salve a medição primeiro'} className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-200 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-full disabled:opacity-40"><FileDown className="w-3.5 h-3.5" /> PDF (em aberto)</button>
                  <button data-testid="mo-enviar" disabled={!detail.totals.realizado_count} onClick={() => openEnvio(null)} title={detail.totals.realizado_count ? 'Enviar a medição em aberto por e-mail aos fiscais' : 'Lance e salve a medição primeiro'} className="inline-flex items-center gap-1.5 text-xs font-black text-black bg-[#39FF14] hover:bg-[#2ee010] px-3 py-2 rounded-full disabled:opacity-40"><Mail className="w-3.5 h-3.5" /> Enviar aos fiscais{detail.fiscais?.length ? ` (${detail.fiscais.length})` : ''}</button>
                  <button data-testid="mo-open-faturamento" onClick={() => navigate('/faturamento')} className="text-[11px] font-bold text-[#00F0FF] hover:underline inline-flex items-center gap-1">Ver na esteira <ArrowRight className="w-3 h-3" /></button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <div className="rounded-xl border border-[#00F0FF]/30 bg-[#00F0FF]/5 p-3"><p className="text-[9px] uppercase tracking-wider font-bold text-[#00F0FF]">Orçado (M.O.)</p><p className="font-mono text-lg font-black text-white" data-testid="mo-total-orcado">{formatCurrency(detail.totals.orcado)}</p><p className="text-[10px] text-zinc-500">{detail.totals.orcado_count} item(ns) · labor_cost da obra</p></div>
                <div className="rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/5 p-3"><p className="text-[9px] uppercase tracking-wider font-bold text-[#39FF14]">Realizado (medido)</p><p className="font-mono text-lg font-black text-white" data-testid="mo-total-realizado">{formatCurrency(detail.totals.realizado)}</p><p className="text-[10px] text-zinc-500" data-testid="mo-total-realizado-hint">{detail.totals.medicoes_count ? `${detail.totals.medicoes_count} fechada(s) ${formatCurrency(detail.totals.fechado)} · em aberto ${formatCurrency(detail.totals.em_aberto)}` : `${detail.totals.realizado_count} item(ns) em aberto`}</p></div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><p className="text-[9px] uppercase tracking-wider font-bold text-zinc-400">Diferença</p><p className={`font-mono text-lg font-black ${detail.totals.diff >= 0 ? 'text-[#39FF14]' : 'text-[#FF5E00]'}`} data-testid="mo-total-diff">{detail.totals.diff >= 0 ? '+' : ''}{formatCurrency(detail.totals.diff)}</p><p className="text-[10px] text-zinc-500">{detail.totals.pct != null ? `${detail.totals.pct}% do orçado` : 'sem orçado'}</p></div>
                <div className="rounded-xl border border-[#E0FF00]/30 bg-[#E0FF00]/5 p-3"><p className="text-[9px] uppercase tracking-wider font-bold text-[#E0FF00]">Produção Realizada (obra)</p><p className="font-mono text-lg font-black text-white" data-testid="mo-applied-actual">{formatCurrency(detail.applied.actual_value)}</p><p className="text-[10px] text-zinc-500 inline-flex items-center gap-1">{detail.applied.at ? <><CheckCircle2 className="w-3 h-3 text-[#39FF14]" /> aplicado {dateBR(detail.applied.at)}</> : 'ainda sem medição aplicada'}</p></div>
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <button data-testid="mo-tab-orcado" onClick={() => setTab('orcado')} className={`text-[11px] font-bold uppercase tracking-wider px-4 py-2 rounded-full border transition ${tab === 'orcado' ? 'bg-[#00F0FF] border-[#00F0FF] text-black' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}>Orçado · {formatCurrency(sum(budget))}</button>
                <button data-testid="mo-tab-realizado" onClick={() => setTab('realizado')} className={`text-[11px] font-bold uppercase tracking-wider px-4 py-2 rounded-full border transition ${tab === 'realizado' ? 'bg-[#39FF14] border-[#39FF14] text-black' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'}`}>Medição nº {detail.next_number || 1} (em aberto) · {formatCurrency(sum(measured))}</button>
                <div className="ml-auto flex items-center gap-2">
                  {dirty && <span data-testid="mo-dirty" className="text-[10px] font-bold text-[#FF5E00]">alterações não salvas</span>}
                  {tab === 'realizado' && (
                    <button data-testid="mo-fechar" disabled={dirty || !measured.length} onClick={() => setFecharOpen(true)} title={dirty ? 'Salve a medição antes de fechar' : !measured.length ? 'Sem itens em aberto' : `Fechar a Medição nº ${detail.next_number || 1} e guardar no histórico`} className="inline-flex items-center gap-1 text-xs font-black text-black bg-[#E0FF00] hover:bg-[#C8E600] px-4 py-2 rounded-full disabled:opacity-40"><Lock className="w-3.5 h-3.5" /> Fechar medição nº {detail.next_number || 1}</button>
                  )}
                  <button data-testid="mo-save" disabled={saving || !dirty} onClick={save} className="inline-flex items-center gap-1 text-xs font-black text-black px-4 py-2 rounded-full disabled:opacity-40" style={{ background: tab === 'orcado' ? '#00F0FF' : '#39FF14' }}><Save className="w-3.5 h-3.5" /> {saving ? 'Salvando…' : tab === 'orcado' ? 'Salvar orçado' : 'Salvar medição → Faturamento'}</button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 mb-3">{tab === 'orcado' ? 'Mão de obra prevista para a obra. O total vira o campo "Mão de Obra" (labor_cost) do cadastro.' : `Rascunho da Medição nº ${detail.next_number || 1}: selecione da base os serviços executados no período e as quantidades, salve e depois feche a medição para guardá-la no histórico (PDF e envio próprios). Produção Realizada = medições fechadas + em aberto.`}</p>
              {tab === 'orcado' ? (
                <LaborLinesEditor items={budget} onChange={setBudget} catalog={catalog} accent="#00F0FF" testPrefix="mo-orc"
                  extraActions={<><input ref={importRef} data-testid="mo-orc-import-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => importBudget(e.target.files?.[0])} /><button type="button" data-testid="mo-orc-import" disabled={importing} onClick={() => importRef.current?.click()} className="text-xs font-bold text-black bg-[#00F0FF] hover:bg-[#00D9E5] px-3 py-2 rounded-full inline-flex items-center gap-1 disabled:opacity-50"><Upload className="w-3 h-3" /> {importing ? 'Importando…' : 'Importar planilha orçada'}</button></>} />
              ) : (
                <LaborLinesEditor items={measured} onChange={setMeasured} catalog={catalog} accent="#39FF14" testPrefix="mo-real"
                  extraActions={<button type="button" data-testid="mo-real-copy" disabled={!budget.length} onClick={copyFromBudget} className="text-xs font-bold text-zinc-200 bg-white/5 hover:bg-white/10 px-3 py-2 rounded-full inline-flex items-center gap-1 disabled:opacity-40"><Copy className="w-3 h-3" /> Copiar do orçado</button>} />
              )}
            </div>

            <MedicoesHistory detail={detail} onEnviar={(m) => openEnvio(m)} onReabrir={reabrir} />
          </motion.div>
        )}
      </div>

      <LaborCatalogModal open={catalogOpen} catalog={catalog} onClose={() => setCatalogOpen(false)} onChanged={loadCatalog} />
      <MedicaoEnvioModal open={envioOpen} detail={detail} medicao={envioMedicao} onClose={() => { setEnvioOpen(false); setEnvioMedicao(null); }} onChanged={(data) => { if (data?.project) setDetail(data); }} />
      <FecharMedicaoModal open={fecharOpen} detail={detail} onClose={() => setFecharOpen(false)} onClosed={applyDetail} />
    </AppLayout>
  );
};

export default MedicaoPage;
