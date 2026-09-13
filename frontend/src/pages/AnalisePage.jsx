import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { AppLayout } from '../components/AppLayout';
import { ProjectFilters } from '../components/ProjectFilters';
import { SearchBar } from '../components/SearchBar';
import { PROJECT_TYPE_LABEL, formatCurrency } from '../lib/constants';
import {
  TrendingUp, TrendingDown, Target, Clock, DollarSign, AlertTriangle,
  CheckCircle2, Zap, Users, Layers, Timer, ArrowUpRight, ArrowDownRight,
  RotateCcw, CalendarX,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line, ComposedChart, Area, AreaChart,
} from 'recharts';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const COLORS = ['#00F0FF', '#39FF14', '#E0FF00', '#FF5E00', '#6366F1', '#FF003C', '#94A3B8', '#22D3EE', '#A855F7', '#EC4899', '#10B981', '#F59E0B'];

// Chaves que NÃO devem ser formatadas como R$ (percentuais, contagens, dias)
const NON_CURRENCY_KEYS = new Set(['productivity', 'count', 'projetos', 'obras', 'dias', 'days', 'percent', 'pct']);

const formatTooltipValue = (entry) => {
  const val = entry?.value;
  if (val === null || val === undefined) return '—';
  const key = (entry?.dataKey || entry?.name || '').toString().toLowerCase();
  const isPercent = key.includes('productivity') || key.includes('pct') || key.includes('percent');
  const isCount = NON_CURRENCY_KEYS.has(key) || key.includes('count') || key.includes('projet') || key.includes('obra');
  if (typeof val !== 'number') return String(val);
  if (isPercent) return `${val.toFixed(1)}%`;
  if (isCount) return Math.round(val).toLocaleString('pt-BR');
  // moeda com 2 casas
  return formatCurrency(val);
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="glass-panel rounded-lg p-3 border border-white/20" style={{ background: '#09090b' }}>
      <p className="text-white text-sm font-bold mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs font-mono" style={{ color: entry.color }}>
          {entry.name}: {formatTooltipValue(entry)}
        </p>
      ))}
    </div>
  );
};

export const AnalisePage = () => {
  const [analytics, setAnalytics] = useState(null);
  const [advanced, setAdvanced] = useState(null);
  const [managerKpis, setManagerKpis] = useState(null);
  const [teams, setTeams] = useState([]);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', teamId: '', minValue: '', maxValue: '' });
  const [topExpensive, setTopExpensive] = useState([]);
  const [search, setSearch] = useState('');
  const [topTypeFilter, setTopTypeFilter] = useState('');

  useEffect(() => {
    axios.get(`${API}/teams`).then(({ data }) => setTeams(data));
    axios.get(`${API}/analytics/advanced`).then(({ data }) => setAdvanced(data));
    axios.get(`${API}/analytics/top-expensive`).then(({ data }) => setTopExpensive(data)).catch(() => {});
  }, []);

  const filteredTop = useMemo(() => {
    const minV = parseFloat(filters.minValue);
    const maxV = parseFloat(filters.maxValue);
    const q = (search || '').toLowerCase();
    return topExpensive.filter((p) => {
      if (filters.teamId && p.team_id !== filters.teamId) return false;
      const ps = (p.start_date || '').slice(0, 10);
      if (filters.startDate && ps && ps < filters.startDate) return false;
      if (filters.endDate && ps && ps > filters.endDate) return false;
      const v = p.programmed_value || 0;
      if (!isNaN(minV) && v < minV) return false;
      if (!isNaN(maxV) && v > maxV) return false;
      if (topTypeFilter && p.project_type !== topTypeFilter) return false;
      if (q && !((p.project_code || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [topExpensive, filters, search, topTypeFilter]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    if (filters.teamId) params.append('team_id', filters.teamId);
    axios.get(`${API}/analytics/production?${params.toString()}`).then(({ data }) => setAnalytics(data));
    axios.get(`${API}/analytics/manager-kpis?${params.toString()}`).then(({ data }) => setManagerKpis(data)).catch(() => setManagerKpis(null));
  }, [filters]);

  return (
    <AppLayout title="Análise" subtitle="Visão completa da operação">
      <div className="mb-4"><SearchBar value={search} onChange={setSearch} testid="analise-search" /></div>

      <ProjectFilters
        filters={filters}
        onChange={setFilters}
        teams={teams}
        onReset={() => setFilters({ startDate: '', endDate: '', teamId: '', minValue: '', maxValue: '' })}
        showValueFilter={true}
      />

      {/* Executive KPIs (Fev/2026) — visão gerencial no topo */}
      {managerKpis && (
        <div data-testid="manager-kpis" className="mb-6 space-y-4">
          {/* Alerta de Meta (Fev/2026) — dispara quando <25% dos dias úteis restantes E <75% da meta */}
          {managerKpis.alert && managerKpis.alert.meta_active && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              data-testid="meta-alert-banner"
              className="rounded-2xl p-4 border-2 flex items-start gap-3"
              style={{
                borderColor: managerKpis.alert.severity === 'critical' ? '#FF003C' : '#FF5E00',
                background: managerKpis.alert.severity === 'critical'
                  ? 'linear-gradient(90deg, rgba(255,0,60,0.12), rgba(255,94,0,0.08))'
                  : 'linear-gradient(90deg, rgba(255,94,0,0.12), rgba(224,255,0,0.05))',
              }}
            >
              <AlertTriangle
                className="w-6 h-6 flex-shrink-0 mt-0.5"
                style={{ color: managerKpis.alert.severity === 'critical' ? '#FF003C' : '#FF5E00' }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs tracking-[0.2em] uppercase font-black mb-1"
                  style={{ color: managerKpis.alert.severity === 'critical' ? '#FF003C' : '#FF5E00' }}
                >
                  {managerKpis.alert.severity === 'critical' ? '⚠ Meta em Risco Crítico' : '⚠ Meta em Risco'}
                </p>
                <p className="text-white text-sm font-bold">{managerKpis.alert.message}</p>
              </div>
            </motion.div>
          )}
          {/* Meta Contratual (Fev/2026) — barra de progresso destacada */}
          {managerKpis.targets && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              data-testid="targets-panel"
              className="glass-panel rounded-2xl p-5 border border-[#E0FF00]/40"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-4 h-4 text-[#E0FF00]" />
                    <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#E0FF00]">Meta Contratual Mensal</p>
                  </div>
                  <p className="font-heading font-black text-2xl tracking-tighter text-white leading-none">
                    {formatCurrency(managerKpis.targets.monthly_actual)}
                    <span className="text-sm text-zinc-500 font-mono font-normal ml-2">
                      / {formatCurrency(managerKpis.targets.monthly_contract)}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Atingido</p>
                  <p
                    className="font-heading font-black text-3xl tracking-tighter leading-none"
                    style={{ color: managerKpis.targets.monthly_pct >= 100 ? '#39FF14' : managerKpis.targets.monthly_pct >= 70 ? '#E0FF00' : '#FF5E00' }}
                    data-testid="target-monthly-pct"
                  >
                    {managerKpis.targets.monthly_pct.toFixed(1)}%
                  </p>
                </div>
              </div>
              {/* Barra de progresso */}
              <div className="relative h-2.5 rounded-full bg-white/5 overflow-hidden mb-2" data-testid="target-progress-bar">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, managerKpis.targets.monthly_pct)}%`,
                    background: managerKpis.targets.monthly_pct >= 100
                      ? 'linear-gradient(90deg, #39FF14, #00F0FF)'
                      : managerKpis.targets.monthly_pct >= 70
                      ? 'linear-gradient(90deg, #E0FF00, #39FF14)'
                      : 'linear-gradient(90deg, #FF003C, #FF5E00, #E0FF00)',
                  }}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-[11px]">
                <div>
                  <p className="text-zinc-500 uppercase text-[9px] tracking-wider font-bold">Faltam</p>
                  <p className="text-white font-mono font-bold" data-testid="target-monthly-gap">{formatCurrency(managerKpis.targets.monthly_gap)}</p>
                </div>
                <div>
                  <p className="text-zinc-500 uppercase text-[9px] tracking-wider font-bold">Meta Diária/Equipe</p>
                  <p className="text-[#00F0FF] font-mono font-bold" data-testid="target-daily-team">{formatCurrency(managerKpis.targets.team_daily)}</p>
                </div>
                <div>
                  <p className="text-zinc-500 uppercase text-[9px] tracking-wider font-bold">Equipes Ativas</p>
                  <p className="text-white font-mono font-bold" data-testid="target-active-teams">{managerKpis.targets.active_teams_count}</p>
                </div>
                <div>
                  <p className="text-zinc-500 uppercase text-[9px] tracking-wider font-bold">Meta Diária Total</p>
                  <p className="text-[#39FF14] font-mono font-bold" data-testid="target-daily-total">{formatCurrency(managerKpis.targets.daily_target_total)}</p>
                </div>
              </div>
              {managerKpis.targets.team_daily_perf && managerKpis.targets.team_daily_perf.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/10">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Aderência por Equipe (mês atual · {managerKpis.targets.business_days_in_month} dias úteis)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {managerKpis.targets.team_daily_perf.map((tp, i) => (
                      <div
                        key={tp.name}
                        data-testid={`team-daily-perf-${i}`}
                        className="rounded-lg p-2.5 border"
                        style={{
                          backgroundColor: tp.meta_pct >= 100 ? '#39FF1415' : tp.meta_pct >= 70 ? '#E0FF0015' : '#FF5E0015',
                          borderColor: tp.meta_pct >= 100 ? '#39FF1440' : tp.meta_pct >= 70 ? '#E0FF0040' : '#FF5E0040',
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-white text-xs font-bold truncate">{tp.name}</p>
                          <p
                            className="text-sm font-mono font-black"
                            style={{ color: tp.meta_pct >= 100 ? '#39FF14' : tp.meta_pct >= 70 ? '#E0FF00' : '#FF5E00' }}
                          >
                            {tp.meta_pct.toFixed(0)}%
                          </p>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {formatCurrency(tp.actual)} / {formatCurrency(tp.expected_monthly)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              testid="kpi-adherence"
              icon={<Target className="w-4 h-4" />}
              label="Aderência ao Programa"
              value={`${managerKpis.financial.adherence_pct.toFixed(1)}%`}
              hint="Produção realizada ÷ programado"
              color={managerKpis.financial.adherence_pct >= 95 ? '#39FF14' : managerKpis.financial.adherence_pct >= 80 ? '#E0FF00' : '#FF5E00'}
              drillTo="/carteira?filter=active"
              drillHint="Ver obras ativas"
            />
            <KpiCard
              testid="kpi-billing-pct"
              icon={<DollarSign className="w-4 h-4" />}
              label="% Faturado"
              value={`${managerKpis.financial.billing_pct.toFixed(1)}%`}
              hint="Faturado ÷ realizado"
              color={managerKpis.financial.billing_pct >= 80 ? '#39FF14' : managerKpis.financial.billing_pct >= 50 ? '#E0FF00' : '#FF5E00'}
              drillTo="/faturamento"
              drillHint="Abrir esteira"
            />
            <KpiCard
              testid="kpi-avg-ticket"
              icon={<Layers className="w-4 h-4" />}
              label="Ticket Médio"
              value={formatCurrency(managerKpis.financial.avg_ticket)}
              hint={`${managerKpis.operational.active} obras ativas`}
              color="#00F0FF"
              drillTo="/carteira?filter=active"
              drillHint="Ver obras ativas"
            />
            <KpiCard
              testid="kpi-completion"
              icon={<CheckCircle2 className="w-4 h-4" />}
              label="Taxa de Conclusão"
              value={`${managerKpis.operational.completion_pct.toFixed(1)}%`}
              hint={`${managerKpis.operational.completed}/${managerKpis.operational.total} obras`}
              color={managerKpis.operational.completion_pct >= 70 ? '#39FF14' : '#E0FF00'}
              drillTo="/carteira?filter=completed"
              drillHint="Ver concluídas"
            />
            <KpiCard
              testid="kpi-lead-days"
              icon={<Timer className="w-4 h-4" />}
              label="Prazo Médio"
              value={`${managerKpis.operational.avg_lead_days.toFixed(0)}d`}
              hint="Início → conclusão"
              color="#A855F7"
              drillTo="/carteira?filter=completed"
              drillHint="Ver concluídas"
            />
            <KpiCard
              testid="kpi-mom-delta"
              icon={managerKpis.mom.delta_pct >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              label="Produção MoM"
              value={`${managerKpis.mom.delta_pct >= 0 ? '+' : ''}${managerKpis.mom.delta_pct.toFixed(1)}%`}
              hint={`${managerKpis.mom.current_month} vs ${managerKpis.mom.previous_month}`}
              color={managerKpis.mom.delta_pct >= 0 ? '#39FF14' : '#FF003C'}
              drillTo="/faturamento"
              drillHint="Ver faturamento"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Alertas Operacionais */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              data-testid="alerts-panel"
              className="glass-panel rounded-2xl p-5 border border-[#FF003C]/25"
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#FF003C]" />
                <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF003C]">Alertas Operacionais</p>
              </div>
              <div className="space-y-2.5">
                <AlertRow
                  testid="alert-overdue"
                  label="Obras vencidas"
                  count={managerKpis.operational.overdue}
                  color="#FF003C"
                  drillTo="/carteira?filter=vencidas"
                />
                <AlertRow
                  testid="alert-backlog"
                  label="Paradas no faturamento (>15d)"
                  count={managerKpis.financial.backlog_count}
                  extra={managerKpis.financial.backlog_value > 0 && formatCurrency(managerKpis.financial.backlog_value)}
                  color="#FF5E00"
                  drillTo="/faturamento?view=backlog"
                />
                <AlertRow
                  testid="alert-losses"
                  label="Custo de perdas no período"
                  count={managerKpis.losses.estimated_cost > 0 ? formatCurrency(managerKpis.losses.estimated_cost) : '—'}
                  extra={`${managerKpis.losses.unproductive_hours}h + ${managerKpis.losses.unavailable_days}d + ${managerKpis.losses.reschedule_count || 0} retornos`}
                  color="#E0FF00"
                  noBadge
                  drillTo="/improdutividade"
                />
              </div>
            </motion.div>

            {/* Destaques de Performance */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              data-testid="highlights-panel"
              className="glass-panel rounded-2xl p-5 border border-[#39FF14]/25 lg:col-span-2"
            >
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-[#39FF14]" />
                <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#39FF14]">Destaques do Período</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <HighlightCard
                  testid="highlight-best-team"
                  icon={<Users className="w-3.5 h-3.5" />}
                  label="Melhor Equipe"
                  primary={managerKpis.highlights.best_team?.name || '—'}
                  secondary={managerKpis.highlights.best_team ? `${managerKpis.highlights.best_team.productivity_pct}% de aderência` : 'Sem dados'}
                  color="#39FF14"
                  drillTo={managerKpis.highlights.best_team ? `/carteira?team_name=${encodeURIComponent(managerKpis.highlights.best_team.name)}` : null}
                />
                <HighlightCard
                  testid="highlight-worst-team"
                  icon={<TrendingDown className="w-3.5 h-3.5" />}
                  label="Precisa Atenção"
                  primary={managerKpis.highlights.worst_team?.name || '—'}
                  secondary={managerKpis.highlights.worst_team ? `${managerKpis.highlights.worst_team.productivity_pct}% de aderência` : 'Sem dados'}
                  color="#FF5E00"
                  drillTo={managerKpis.highlights.worst_team ? `/carteira?team_name=${encodeURIComponent(managerKpis.highlights.worst_team.name)}` : null}
                />
                <HighlightCard
                  testid="highlight-top-type"
                  icon={<Zap className="w-3.5 h-3.5" />}
                  label="Tipo Mais Rentável"
                  primary={managerKpis.highlights.top_type?.type || '—'}
                  secondary={managerKpis.highlights.top_type ? `${formatCurrency(managerKpis.highlights.top_type.billing)} faturado` : 'Sem dados'}
                  color="#E0FF00"
                  drillTo={managerKpis.highlights.top_type ? `/carteira?type=${encodeURIComponent(_typeValueFromLabel(managerKpis.highlights.top_type.type))}` : null}
                />
              </div>
            </motion.div>
          </div>

          {/* Prejuízos Operacionais — detalhamento (Fev/2026) */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="losses-panel"
            className="glass-panel rounded-2xl p-5 border border-[#FF5E00]/25"
          >
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-4 h-4 text-[#FF5E00]" />
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF5E00]">Prejuízos Operacionais</p>
              <span className="ml-auto text-[10px] font-mono text-zinc-500">
                R$ {(managerKpis.losses.hour_cost ?? 500).toLocaleString('pt-BR')}/h · R$ {(managerKpis.losses.day_cost ?? 4000).toLocaleString('pt-BR')}/dia · valor programado não realizado
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <LossCard
                testid="loss-improdutividade"
                icon={<Clock className="w-4 h-4" />}
                label="Improdutividade"
                primary={formatCurrency(managerKpis.losses.unproductive_cost || 0)}
                secondary={`${managerKpis.losses.unproductive_hours}h perdidas`}
                color="#FF5E00"
                drillTo="/improdutividade"
              />
              <LossCard
                testid="loss-indisponibilidade"
                icon={<CalendarX className="w-4 h-4" />}
                label="Indisponibilidade"
                primary={formatCurrency(managerKpis.losses.unavailable_cost || 0)}
                secondary={`${managerKpis.losses.unavailable_days} dia(s) parados`}
                color="#00F0FF"
                drillTo="/indisponibilidade"
              />
              <LossCard
                testid="loss-retornos"
                icon={<RotateCcw className="w-4 h-4" />}
                label="Retornos de Programação"
                primary={formatCurrency(managerKpis.losses.reschedule_lost_value || 0)}
                secondary={`${managerKpis.losses.reschedule_count || 0} obras não executadas${managerKpis.losses.reschedule_events ? ` · ${managerKpis.losses.reschedule_events} reagendamentos` : ''}`}
                color="#E0FF00"
                drillTo="/carteira?filter=reprogramar"
              />
              <LossCard
                testid="loss-total"
                icon={<AlertTriangle className="w-4 h-4" />}
                label="Prejuízo Total"
                primary={formatCurrency(managerKpis.losses.estimated_cost || 0)}
                secondary="Soma estimada do período"
                color="#FF003C"
                emphasize
              />
            </div>
          </motion.div>
        </div>
      )}

      {/* Monthly Production */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        data-testid="chart-monthly"
        className="glass-panel rounded-2xl p-6 mb-6"
      >
        <div className="mb-4">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Ciclo Mensal</p>
          <h3 className="font-heading font-black text-xl tracking-tighter text-white">
            Produção e Faturamento por Mês
          </h3>
        </div>
        {advanced && advanced.monthly.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={advanced.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" stroke="#71717a" style={{ fontSize: '11px' }} />
              <YAxis stroke="#71717a" style={{ fontSize: '11px' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="programmed" name="Programado" fill="#00F0FF" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Produção" fill="#39FF14" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="billing" name="Faturamento" stroke="#E0FF00" strokeWidth={3} dot={{ fill: '#E0FF00', r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">Sem dados</div>
        )}
      </motion.div>

      {/* Team Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="chart-team-performance"
          className="glass-panel rounded-2xl p-6"
        >
          <div className="mb-4">
            <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Performance</p>
            <h3 className="font-heading font-black text-xl tracking-tighter text-white">Produtividade por Equipe</h3>
          </div>
          {advanced && advanced.team_performance.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={advanced.team_performance} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  type="number"
                  stroke="#71717a"
                  style={{ fontSize: '11px' }}
                  domain={[0, (dataMax) => Math.max(120, Math.ceil((dataMax || 0) / 10) * 10)]}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis dataKey="team" type="category" stroke="#71717a" style={{ fontSize: '11px' }} width={110} />
                <Tooltip
                  contentStyle={{ background: '#09090b', border: '1px solid rgba(255,255,255,0.2)' }}
                  formatter={(v, _n, entry) => {
                    const num = typeof v === 'number' ? v : parseFloat(v);
                    if (isNaN(num)) return v;
                    return [`${num.toFixed(1)}%`, 'Produtividade'];
                  }}
                  labelFormatter={(l) => `Equipe: ${l}`}
                />
                <Bar dataKey="productivity" name="Produtividade" radius={[0, 4, 4, 0]}>
                  {advanced.team_performance.map((entry, i) => (
                    <Cell key={i} fill={entry.productivity >= 100 ? '#39FF14' : entry.productivity >= 80 ? '#E0FF00' : '#FF003C'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center gap-2 px-6">
              <Users className="w-8 h-8 text-zinc-700" />
              <p className="text-zinc-500 text-sm">Nenhuma equipe ativa com dados</p>
              <p className="text-[10px] text-zinc-600 max-w-xs">Cadastre membros ou supervisor na aba <span className="text-[#E0FF00] font-bold">Equipes</span> para aparecer aqui.</p>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="chart-team-values"
          className="glass-panel rounded-2xl p-6"
        >
          <div className="mb-4">
            <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Valores por Equipe</p>
            <h3 className="font-heading font-black text-xl tracking-tighter text-white">Programado x Produção x Faturamento</h3>
          </div>
          {advanced && advanced.team_performance.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={advanced.team_performance}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="team" stroke="#71717a" style={{ fontSize: '11px' }} />
                <YAxis stroke="#71717a" style={{ fontSize: '11px' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="programmed" name="Programado" fill="#00F0FF" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Produção" fill="#39FF14" radius={[4, 4, 0, 0]} />
                <Bar dataKey="billing" name="Faturamento" fill="#E0FF00" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">Sem dados</div>
          )}
        </motion.div>
      </div>

      {/* By Type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="chart-by-type"
          className="glass-panel rounded-2xl p-6"
        >
          <div className="mb-4">
            <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Distribuição</p>
            <h3 className="font-heading font-black text-xl tracking-tighter text-white">Por Tipo de Projeto</h3>
          </div>
          {analytics && analytics.by_type.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={analytics.by_type}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  fill="#8884d8"
                  dataKey="programmed"
                  nameKey="type"
                  label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                >
                  {analytics.by_type.map((entry, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#050505" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '10px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">Sem dados</div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="chart-status"
          className="glass-panel rounded-2xl p-6"
        >
          <div className="mb-4">
            <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Status Execução</p>
            <h3 className="font-heading font-black text-xl tracking-tighter text-white">Estado Atual</h3>
          </div>
          {analytics && analytics.by_status ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={Object.entries(analytics.by_status).map(([k, v]) => ({ status: k, count: v }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="status" stroke="#71717a" style={{ fontSize: '10px' }} angle={-15} textAnchor="end" height={60} />
                <YAxis stroke="#71717a" style={{ fontSize: '11px' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#09090b', border: '1px solid rgba(255,255,255,0.2)' }} />
                <Bar dataKey="count" name="Projetos" fill="#E0FF00" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">Sem dados</div>
          )}
        </motion.div>
      </div>

      {/* Faturamento Ciclo */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        data-testid="chart-billing-cycle"
        className="glass-panel rounded-2xl p-6 mb-6"
      >
        <div className="mb-4">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Ciclo</p>
          <h3 className="font-heading font-black text-xl tracking-tighter text-white">Evolução do Faturamento</h3>
        </div>
        {advanced && advanced.monthly.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={advanced.monthly}>
              <defs>
                <linearGradient id="billingGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E0FF00" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#E0FF00" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" stroke="#71717a" style={{ fontSize: '11px' }} />
              <YAxis stroke="#71717a" style={{ fontSize: '11px' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="billing" name="Faturamento" stroke="#E0FF00" strokeWidth={3} fill="url(#billingGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">Sem dados</div>
        )}
      </motion.div>

      {/* Top 10 obras mais caras */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        data-testid="chart-top-expensive"
        className="glass-panel rounded-2xl p-6"
      >
        <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Oportunidades</p>
            <h3 className="font-heading font-black text-xl tracking-tighter text-white">Top 10 Obras Mais Caras</h3>
            <p className="text-xs text-zinc-500 mt-1">Ativas (excluindo concluídas e canceladas)</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              data-testid="top-type-filter"
              value={topTypeFilter}
              onChange={(e) => setTopTypeFilter(e.target.value)}
              className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E0FF00] focus:outline-none"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(PROJECT_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00]">
              {filteredTop.length} obra{filteredTop.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {topExpensive.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-zinc-600 text-sm">Sem obras ativas.</div>
        ) : filteredTop.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-zinc-600 text-sm">Nenhuma obra dentro dos filtros.</div>
        ) : (
          <div className="space-y-2">
            {filteredTop.map((p, i) => (
              <div key={p.id} data-testid={`top-expensive-${i}`} className="flex items-center gap-3 rounded-xl p-3 bg-white/[0.02] border border-white/10 hover:border-[#E0FF00]/40 transition-all">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center font-mono text-lg font-bold flex-shrink-0"
                  style={{
                    backgroundColor: i < 3 ? '#E0FF0022' : 'rgba(255,255,255,0.03)',
                    color: i < 3 ? '#E0FF00' : '#71717a',
                    border: i < 3 ? '1px solid #E0FF00' : '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.project_code && <span className="font-mono text-[10px] text-[#00F0FF]">{p.project_code}</span>}
                    <p className="text-white font-bold text-sm truncate">{p.name}</p>
                  </div>
                  <div className="text-[11px] text-zinc-500 flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{PROJECT_TYPE_LABEL[p.project_type] || p.project_type}</span>
                    {p.team_name && <span>• {p.team_name}</span>}
                    {p.location && <span>• {p.location}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono text-lg font-bold text-[#39FF14]">{formatCurrency(p.programmed_value)}</p>
                  <p className="text-[10px] text-zinc-500 uppercase">{p.execution_status?.replace(/_/g, ' ')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </AppLayout>
  );
};

// ─── Componentes auxiliares dos KPIs executivos ───────────────────────────────
// Fev/2026 · Helper que abre uma URL do mesmo domínio numa nova aba
const openDrill = (path) => {
  if (!path) return;
  const url = new URL(path, window.location.origin).toString();
  window.open(url, '_blank', 'noopener,noreferrer');
};

// Reverse-lookup do rótulo do tipo para o valor (para drill-down por tipo)
const _typeValueFromLabel = (label) => {
  const entry = Object.entries(PROJECT_TYPE_LABEL).find(([, l]) => l === label);
  return entry ? entry[0] : (label || '');
};

const KpiCard = ({ testid, icon, label, value, hint, color, drillTo, drillHint }) => {
  const clickable = !!drillTo;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid={testid}
      onClick={clickable ? () => openDrill(drillTo) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') openDrill(drillTo); } : undefined}
      className={`glass-panel rounded-2xl p-4 border border-white/10 transition-all group ${clickable ? 'cursor-pointer hover:-translate-y-0.5' : ''}`}
      style={clickable ? { borderColor: 'rgba(255,255,255,0.1)' } : undefined}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.borderColor = `${color}55`; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; } : undefined}
      title={clickable ? drillHint : undefined}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}40` }}
        >
          {icon}
        </div>
        <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500 truncate">{label}</p>
      </div>
      <p className="font-heading font-black text-2xl tracking-tighter leading-none mb-1" style={{ color }}>
        {value}
      </p>
      <div className="flex items-center gap-1 min-h-[14px]">
        {hint && <p className="text-[10px] text-zinc-500 truncate flex-1">{hint}</p>}
        {clickable && (
          <ArrowUpRight className="w-3 h-3 text-zinc-600 group-hover:text-white transition-colors flex-shrink-0" data-testid={`${testid}-drill`} />
        )}
      </div>
    </motion.div>
  );
};

const AlertRow = ({ testid, label, count, extra, color, noBadge, drillTo }) => {
  const clickable = !!drillTo;
  return (
    <div
      data-testid={testid}
      onClick={clickable ? () => openDrill(drillTo) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') openDrill(drillTo); } : undefined}
      className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 -mx-2 group ${clickable ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
      title={clickable ? 'Ver detalhes em nova aba' : undefined}
    >
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <p className="text-xs text-zinc-300 truncate">{label}</p>
        {clickable && <ArrowUpRight className="w-3 h-3 text-zinc-600 group-hover:text-white transition-colors flex-shrink-0" data-testid={`${testid}-drill`} />}
      </div>
      {extra && <p className="text-[10px] font-mono text-zinc-500 hidden sm:block">{extra}</p>}
      {noBadge ? (
        <span className="font-mono font-bold text-lg" style={{ color }}>{count}</span>
      ) : (
        <span
          className="font-mono font-black text-xl px-3 py-1 rounded-lg min-w-[3rem] text-center"
          style={{ color, backgroundColor: `${color}15`, border: `1px solid ${color}40` }}
        >
          {count}
        </span>
      )}
    </div>
  );
};

const HighlightCard = ({ testid, icon, label, primary, secondary, color, drillTo }) => {
  const clickable = !!drillTo;
  return (
    <div
      data-testid={testid}
      onClick={clickable ? () => openDrill(drillTo) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') openDrill(drillTo); } : undefined}
      className={`rounded-xl p-3 border transition-all group ${clickable ? 'cursor-pointer hover:-translate-y-0.5' : ''}`}
      style={{ backgroundColor: `${color}08`, borderColor: `${color}30` }}
      title={clickable ? 'Abrir carteira filtrada em nova aba' : undefined}
    >
      <div className="flex items-center justify-between mb-1.5" style={{ color }}>
        <div className="flex items-center gap-1.5">
          {icon}
          <p className="text-[9px] tracking-[0.2em] uppercase font-bold">{label}</p>
        </div>
        {clickable && <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`${testid}-drill`} />}
      </div>
      <p className="text-white font-bold text-sm truncate mb-0.5" title={primary}>{primary}</p>
      <p className="text-[10px] text-zinc-400">{secondary}</p>
    </div>
  );
};

// Fev/2026 · Cartão de prejuízo operacional detalhado
const LossCard = ({ testid, icon, label, primary, secondary, color, drillTo, emphasize }) => {
  const clickable = !!drillTo;
  return (
    <div
      data-testid={testid}
      onClick={clickable ? () => openDrill(drillTo) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') openDrill(drillTo); } : undefined}
      className={`rounded-xl p-3 border transition-all group ${clickable ? 'cursor-pointer hover:-translate-y-0.5' : ''}`}
      style={{
        backgroundColor: emphasize ? `${color}18` : `${color}0A`,
        borderColor: emphasize ? `${color}80` : `${color}40`,
      }}
      title={clickable ? 'Abrir detalhes em nova aba' : undefined}
    >
      <div className="flex items-center justify-between mb-1.5" style={{ color }}>
        <div className="flex items-center gap-1.5">
          {icon}
          <p className="text-[9px] tracking-[0.2em] uppercase font-bold">{label}</p>
        </div>
        {clickable && <ArrowUpRight className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" data-testid={`${testid}-drill`} />}
      </div>
      <p className={`font-heading font-black tracking-tighter leading-none mb-1 ${emphasize ? 'text-2xl' : 'text-xl'}`} style={{ color }}>
        {primary}
      </p>
      <p className="text-[10px] text-zinc-400 truncate" title={secondary}>{secondary}</p>
    </div>
  );
};
