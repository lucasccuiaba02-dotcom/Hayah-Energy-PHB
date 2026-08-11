import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { AppLayout } from '../components/AppLayout';
import {
  DollarSign, TrendingUp, Clock, Package, CheckCircle2, Truck, FileCheck2,
  Send, ChevronRight, Filter, Calendar, ArrowRight, Zap, AlertTriangle, Timer,
  Volume2, VolumeX, ChevronLeft,
} from 'lucide-react';
import { formatCurrency, todayISO } from '../lib/constants';
import { showNotification } from '../lib/offline';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Cor por estágio (baseado no fluxo de dinheiro)
const STAGE_COLORS = {
  recebimento_tecnico:      '#00F0FF', // ciano — recém-recebida
  em_fechamento:            '#00E5C1',
  ajuste_material:          '#FF5E00', // laranja — atenção
  pendencia_construtiva:    '#FF003C', // vermelho — problema
  aguardando_fiscalizacao:  '#E0FF00', // amarelo — aguardando
  aprovada:                 '#B8FF00',
  digitada:                 '#39FF14',
  pago:                     '#00A050', // verde escuro — dinheiro no caixa
};

const STAGE_ICONS = {
  recebimento_tecnico: Truck,
  em_fechamento: FileCheck2,
  ajuste_material: Package,
  pendencia_construtiva: Zap,
  aguardando_fiscalizacao: Clock,
  aprovada: CheckCircle2,
  digitada: Send,
  pago: DollarSign,
};

// Datas rápidas para o filtro
const dateNDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export const FaturamentoPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30');
  const [startDate, setStartDate] = useState(dateNDaysAgo(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [movingId, setMovingId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('hayah_backlog_sound') !== '0');
  const alertedCountRef = useRef(-1);

  const playBacklogBeep = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      // Two-tone alert: 880Hz then 660Hz
      [
        { f: 880, t0: 0.00, dur: 0.18 },
        { f: 660, t0: 0.22, dur: 0.22 },
      ].forEach(({ f, t0, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, now + t0);
        gain.gain.exponentialRampToValueAtTime(0.2, now + t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + t0);
        osc.stop(now + t0 + dur + 0.02);
      });
      setTimeout(() => { try { ctx.close(); } catch {} }, 900);
    } catch (err) { /* silent */ }
  };

  const applyRangePreset = (days) => {
    setRange(String(days));
    if (days === 'all') {
      setStartDate('');
      setEndDate('');
    } else {
      setStartDate(dateNDaysAgo(days));
      setEndDate(todayISO());
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      const { data } = await axios.get(`${API}/faturamento/pipeline?${params}`);
      setData(data);
    } catch { toast.error('Erro ao carregar pipeline'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [startDate, endDate]);

  // Aviso de Backlog: som + notificação local quando obras ficam > 15 dias paradas na mesma etapa.
  // Dispara apenas quando a contagem muda (evita spam a cada refresh).
  useEffect(() => {
    const count = data?.stuck_projects?.length || 0;
    if (loading || count === 0) return;
    if (alertedCountRef.current === count) return; // no change
    alertedCountRef.current = count;
    const totalValue = data.stuck_projects.reduce((s, p) => s + (p.programmed_value || 0), 0);
    if (soundOn) playBacklogBeep();
    try {
      showNotification(
        `⚠️ ${count} obra(s) parada(s) no faturamento`,
        `Backlog > 15 dias · Total ${formatCurrency(totalValue)}`,
      );
    } catch {}
  }, [data?.stuck_projects, loading, soundOn]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem('hayah_backlog_sound', next ? '1' : '0');
    if (next) playBacklogBeep(); // preview
    toast[next ? 'success' : 'info'](next ? 'Aviso sonoro do Backlog ativado' : 'Aviso sonoro do Backlog silenciado');
  };

  const stages = data?.stages || [];
  const pipeline = data?.pipeline || {};
  const pipelineRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const refreshScrollState = () => {
    const el = pipelineRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };
  useEffect(() => {
    // Defer to next tick so DOM has laid out the kanban columns
    const t = setTimeout(refreshScrollState, 50);
    const t2 = setTimeout(refreshScrollState, 300);
    const el = pipelineRef.current;
    if (!el) return () => { clearTimeout(t); clearTimeout(t2); };
    el.addEventListener('scroll', refreshScrollState, { passive: true });
    window.addEventListener('resize', refreshScrollState);
    return () => {
      clearTimeout(t); clearTimeout(t2);
      el.removeEventListener('scroll', refreshScrollState);
      window.removeEventListener('resize', refreshScrollState);
    };
  }, [data]);

  const scrollBy = (delta) => {
    const el = pipelineRef.current;
    if (el) el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const moveTo = async (project, newStage) => {
    setMovingId(project.id);
    try {
      await axios.put(`${API}/projects/${project.id}/billing-stage`, { stage: newStage, notes: '' });
      toast.success(`${project.project_code || project.name} → ${labelOf(newStage)}`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao mover');
    } finally { setMovingId(null); }
  };

  const labelOf = (key) => stages.find((s) => s.key === key)?.label || key;

  return (
    <AppLayout title="Faturamento" subtitle="Esteira financeira — acompanhe onde o dinheiro está preso">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        {/* KPIs de topo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiCard testid="fat-kpi-total" label="Total no ciclo" value={formatCurrency(data?.totals?.value || 0)} sub={`${data?.totals?.count || 0} obras`} color="#00F0FF" icon={TrendingUp} />
          <KpiCard testid="fat-kpi-backlog" label="Backlog (não pago)" value={formatCurrency(data?.backlog_value || 0)} sub="R$ preso" color="#FF5E00" icon={Clock} />
          <KpiCard testid="fat-kpi-invoiced" label="Notas emitidas" value={formatCurrency(data?.totals?.invoiced || 0)} sub="valor faturado" color="#E0FF00" icon={FileCheck2} />
          <KpiCard testid="fat-kpi-paid" label="Pago" value={formatCurrency(data?.paid_value || 0)} sub="dinheiro em caixa" color="#00A050" icon={DollarSign} />
        </div>

        {/* Filtro por data */}
        <div className="glass-panel rounded-2xl p-3 flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-[#E0FF00]" />
          <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Ciclo</span>
          {[
            { l: '7d', d: 7 },
            { l: '15d', d: 15 },
            { l: '30d', d: 30 },
            { l: '60d', d: 60 },
            { l: '90d', d: 90 },
            { l: 'Todos', d: 'all' },
          ].map((r) => (
            <button
              key={r.l}
              data-testid={`fat-range-${r.l.toLowerCase()}`}
              onClick={() => applyRangePreset(r.d)}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-full ${range === String(r.d) ? 'bg-[#E0FF00] text-black' : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-white'}`}
            >
              {r.l}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-auto">
            <Calendar className="w-3 h-3 text-zinc-500" />
            <input data-testid="fat-start" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setRange('custom'); }} className="bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono" />
            <span className="text-zinc-500 text-xs">→</span>
            <input data-testid="fat-end" type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setRange('custom'); }} className="bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono" />
          </div>
        </div>

        {/* Lead Time indicators (avg days by transition bucket) */}
        <div data-testid="fat-lead-times" className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <LeadCard testid="lead-rec-fech" label="Recebimento → Fechamento" days={data?.lead_buckets?.recebimento_to_fechamento} />
          <LeadCard testid="lead-fech-fisc" label="Fechamento → Fiscalização" days={data?.lead_buckets?.fechamento_to_fiscalizacao} />
          <LeadCard testid="lead-fisc-aprv" label="Fiscalização → Aprovada" days={data?.lead_buckets?.fiscalizacao_to_aprovada} />
          <LeadCard testid="lead-aprv-pago" label="Aprovada → Pago" days={data?.lead_buckets?.aprovada_to_pago} />
        </div>
      </motion.div>

      {loading ? (
        <p className="text-center text-zinc-500 py-8 text-sm">Carregando pipeline…</p>
      ) : (
        <div className="relative w-full">
          {/* Setas de scroll horizontal */}
          <button
            type="button"
            data-testid="fat-scroll-left"
            onClick={() => scrollBy(-560)}
            disabled={!canScrollLeft}
            className="hidden md:flex absolute left-1 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-[#0f0f10] border border-[#E0FF00]/40 items-center justify-center text-[#E0FF00] shadow-lg hover:bg-[#E0FF00] hover:text-black transition disabled:opacity-30 disabled:cursor-not-allowed"
            title="Deslizar para a esquerda"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            data-testid="fat-scroll-right"
            onClick={() => scrollBy(560)}
            disabled={!canScrollRight}
            className="hidden md:flex absolute right-1 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-[#0f0f10] border border-[#E0FF00]/40 items-center justify-center text-[#E0FF00] shadow-lg hover:bg-[#E0FF00] hover:text-black transition disabled:opacity-30 disabled:cursor-not-allowed"
            title="Deslizar para a direita"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <div ref={pipelineRef} data-testid="fat-pipeline" className="hayah-hscroll w-full pb-6">
            <div className="flex gap-3 min-w-max">
            {stages.map((s) => {
              const items = pipeline[s.key] || [];
              const color = STAGE_COLORS[s.key];
              const Icon = STAGE_ICONS[s.key] || Package;
              const stageTotal = items.reduce((sum, x) => sum + (x.programmed_value || 0), 0);
              return (
                <div key={s.key} data-testid={`fat-stage-${s.key}`} className="w-[260px] flex-shrink-0 glass-panel rounded-2xl overflow-hidden" style={{ borderTop: `3px solid ${color}` }}>
                  <div className="p-3 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4" style={{ color }} />
                      <p className="text-[10px] tracking-[0.2em] uppercase font-bold" style={{ color }}>{s.label}</p>
                    </div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="font-mono text-2xl font-black text-white leading-none">{items.length}</p>
                      <p className="font-mono text-lg font-bold" style={{ color }}>{formatCurrency(stageTotal)}</p>
                    </div>
                  </div>
                  <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
                    {items.length === 0 && <p className="text-[10px] text-zinc-600 italic text-center py-3">—</p>}
                    {items.map((p) => {
                      const idx = stages.findIndex((x) => x.key === s.key);
                      const next = stages[idx + 1];
                      return (
                        <div
                          key={p.id}
                          data-testid={`fat-card-${p.id}`}
                          className="rounded-lg p-2 bg-zinc-950/60 border cursor-pointer hover:brightness-125 transition"
                          style={{ borderColor: `${color}40` }}
                          onClick={() => setDetail(p)}
                        >
                          <div className="flex items-center gap-1 mb-1">
                            {p.project_code && <span className="font-mono text-[10px] text-[#E0FF00] font-bold">{p.project_code}</span>}
                            {p.requires_hot_line && <Zap className="w-2.5 h-2.5 text-[#FF5E00]" />}
                          </div>
                          <p className="text-white text-xs font-bold truncate">{p.name}</p>
                          <p className="text-[10px] text-zinc-500 truncate">{p.team_name || 'sem equipe'} · {p.location || '—'}</p>
                          <div className="flex items-baseline justify-between mt-1.5">
                            <p className="font-mono text-[11px] text-white font-bold">{formatCurrency(p.programmed_value)}</p>
                            <p className="text-[9px] text-zinc-600 font-mono">{p.entered_stage_at || '—'}</p>
                          </div>
                          {typeof p.days_in_stage === 'number' && (
                            <div className="mt-1 flex items-center gap-1">
                              {p.is_stuck ? (
                                <span data-testid={`fat-stuck-${p.id}`} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF003C]/15 text-[#FF003C] border border-[#FF003C]/40 inline-flex items-center gap-1">
                                  <AlertTriangle className="w-2.5 h-2.5" /> {p.days_in_stage}d parado
                                </span>
                              ) : (
                                <span className="text-[9px] text-zinc-500 font-mono inline-flex items-center gap-1">
                                  <Timer className="w-2.5 h-2.5" /> {p.days_in_stage}d
                                </span>
                              )}
                            </div>
                          )}
                          {next && (
                            <button
                              data-testid={`fat-next-${p.id}`}
                              disabled={movingId === p.id}
                              onClick={(e) => { e.stopPropagation(); moveTo(p, next.key); }}
                              className="mt-2 w-full text-[9px] font-bold uppercase tracking-wider inline-flex items-center justify-center gap-1 py-1 rounded-full border transition-all disabled:opacity-50"
                              style={{ borderColor: `${color}60`, color, background: `${color}10` }}
                            >
                              {movingId === p.id ? '...' : <>Avançar <ArrowRight className="w-2.5 h-2.5" /></>}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </div>
      )}

      {detail && <BillingDetailModal item={detail} stages={stages} onClose={() => setDetail(null)} onSaved={() => { setDetail(null); load(); }} />}

      {/* Radar de Backlog: obras paradas > 15 dias */}
      {!loading && (data?.stuck_projects?.length || 0) > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} data-testid="fat-stuck-radar" className="mt-6 glass-panel rounded-2xl overflow-hidden border border-[#FF003C]/40">
          <div className="px-4 py-3 border-b border-[#FF003C]/20 bg-[#FF003C]/5 flex items-center gap-2">
            <span className="relative flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-[#FF003C]" />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#FF003C] animate-ping"></span>
            </span>
            <div className="flex-1">
              <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#FF003C]">Radar de Backlog</p>
              <p className="text-xs text-zinc-400">
                {data.stuck_projects.length} obra(s) parada(s) há mais de {data.stuck_threshold_days || 15} dias — total{' '}
                <span className="font-mono font-bold text-white">
                  {formatCurrency(data.stuck_projects.reduce((s, p) => s + (p.programmed_value || 0), 0))}
                </span>
              </p>
            </div>
            <button
              type="button"
              data-testid="fat-backlog-sound-toggle"
              onClick={toggleSound}
              title={soundOn ? 'Silenciar aviso sonoro' : 'Ativar aviso sonoro'}
              className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border transition ${
                soundOn
                  ? 'bg-[#E0FF00]/15 border-[#E0FF00]/40 text-[#E0FF00] hover:bg-[#E0FF00]/25'
                  : 'bg-white/5 border-white/10 text-zinc-500 hover:text-white'
              }`}
            >
              {soundOn ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
              {soundOn ? 'Som on' : 'Som off'}
            </button>
          </div>
          <div className="divide-y divide-white/5 max-h-[45vh] overflow-y-auto">
            {data.stuck_projects.map((p) => {
              const color = STAGE_COLORS[p.billing_stage] || '#FF003C';
              const stageLabel = stages.find((s) => s.key === p.billing_stage)?.label || p.billing_stage;
              return (
                <div
                  key={p.id}
                  data-testid={`fat-stuck-item-${p.id}`}
                  onClick={() => {
                    // find the full pipeline item so the modal opens with all fields
                    const full = (pipeline[p.billing_stage] || []).find((x) => x.id === p.id) || p;
                    setDetail(full);
                  }}
                  className="px-4 py-2.5 hover:bg-white/5 cursor-pointer flex items-center gap-3 transition"
                >
                  <div className="w-1 h-8 rounded-full" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      {p.project_code && <span className="font-mono text-[10px] text-[#E0FF00] font-bold">{p.project_code}</span>}
                      <p className="text-white text-sm font-bold truncate">{p.name}</p>
                    </div>
                    <p className="text-[10px] text-zinc-500 truncate">
                      {p.team_name || 'sem equipe'} · <span style={{ color }}>{stageLabel}</span>
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono text-sm font-bold text-white">{formatCurrency(p.programmed_value)}</p>
                    <p className="text-[10px] font-bold text-[#FF003C] inline-flex items-center gap-1 justify-end">
                      <AlertTriangle className="w-2.5 h-2.5" /> {p.days_in_stage} dias parada
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AppLayout>
  );
};

const LeadCard = ({ label, days, testid }) => (
  <div data-testid={testid} className="rounded-lg bg-white/[0.02] border border-white/10 p-2 flex items-center gap-2">
    <Timer className="w-3.5 h-3.5 text-[#00F0FF] flex-shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 truncate">{label}</p>
      <p className="font-mono text-sm font-bold text-white">
        {days > 0 ? <>{days}<span className="text-[10px] text-zinc-500 ml-1">dias</span></> : <span className="text-zinc-600">—</span>}
      </p>
    </div>
  </div>
);

const KpiCard = ({ label, value, sub, color, icon: Icon, testid }) => (
  <div data-testid={testid} className="glass-panel rounded-2xl p-5" style={{ borderLeft: `4px solid ${color}` }}>
    <div className="flex items-center gap-2 mb-1.5">
      <Icon className="w-5 h-5" style={{ color }} />
      <p className="text-[11px] tracking-[0.2em] uppercase font-bold text-zinc-500">{label}</p>
    </div>
    <p className="font-mono text-3xl md:text-4xl font-black text-white truncate leading-tight" style={{ color }}>{value}</p>
    <p className="text-[11px] text-zinc-500 mt-1">{sub}</p>
  </div>
);

const BillingDetailModal = ({ item, stages, onClose, onSaved }) => {
  const [stage, setStage] = useState(item.billing_stage);
  const [notes, setNotes] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState(item.invoice_number || '');
  const [invoiceDate, setInvoiceDate] = useState(item.invoice_date || todayISO());
  const [invoiceValue, setInvoiceValue] = useState(item.invoice_value || 0);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/projects/${item.id}/billing-stage`, {
        stage,
        notes,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        invoice_value: Number(invoiceValue) || 0,
      });
      toast.success('Etapa atualizada');
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  return (
    <div data-testid="fat-detail-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()} className="glass-panel rounded-2xl border border-[#E0FF00]/40 max-w-lg w-full p-6">
        <div className="mb-4">
          <p className="font-mono text-[10px] text-[#E0FF00] font-bold">{item.project_code || '—'}</p>
          <h3 className="text-white font-bold text-lg">{item.name}</h3>
          <p className="text-xs text-zinc-500">{item.team_name || 'sem equipe'} · {formatCurrency(item.programmed_value)}</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Mover para estágio</label>
            <select data-testid="fat-detail-stage" value={stage} onChange={(e) => setStage(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none">
              {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Nº NF</label>
              <input data-testid="fat-detail-invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-2 text-white text-sm focus:border-[#E0FF00] focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Data NF</label>
              <input data-testid="fat-detail-invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-2 text-white text-sm font-mono focus:border-[#E0FF00] focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Valor NF</label>
              <input data-testid="fat-detail-invoice-value" type="number" step="0.01" value={invoiceValue} onChange={(e) => setInvoiceValue(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-2 text-white text-sm font-mono focus:border-[#E0FF00] focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Observação</label>
            <textarea data-testid="fat-detail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ex.: Aguardando 3 dias na fiscalização, pedi urgência" className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#E0FF00] focus:outline-none" />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button data-testid="fat-detail-cancel" onClick={onClose} className="flex-1 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-sm font-bold py-2 rounded-full">Cancelar</button>
          <button data-testid="fat-detail-save" disabled={saving} onClick={save} className="flex-1 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-sm font-bold py-2 rounded-full disabled:opacity-60">{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </motion.div>
    </div>
  );
};
