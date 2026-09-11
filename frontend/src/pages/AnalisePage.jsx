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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              testid="kpi-adherence"
              icon={<Target className="w-4 h-4" />}
              label="Aderência ao Programa"
              value={`${managerKpis.financial.adherence_pct.toFixed(1)}%`}
              hint="Produção realizada ÷ programado"
              color={managerKpis.financial.adherence_pct >= 95 ? '#39FF14' : managerKpis.financial.adherence_pct >= 80 ? '#E0FF00' : '#FF5E00'}
            />
            <KpiCard
              testid="kpi-billing-pct"
              icon={<DollarSign className="w-4 h-4" />}
              label="% Faturado"
              value={`${managerKpis.financial.billing_pct.toFixed(1)}%`}
              hint="Faturado ÷ realizado"
              color={managerKpis.financial.billing_pct >= 80 ? '#39FF14' : managerKpis.financial.billing_pct >= 50 ? '#E0FF00' : '#FF5E00'}
            />
            <KpiCard
              testid="kpi-avg-ticket"
              icon={<Layers className="w-4 h-4" />}
              label="Ticket Médio"
              value={formatCurrency(managerKpis.financial.avg_ticket)}
              hint={`${managerKpis.operational.active} obras ativas`}
              color="#00F0FF"
            />
            <KpiCard
              testid="kpi-completion"
              icon={<CheckCircle2 className="w-4 h-4" />}
              label="Taxa de Conclusão"
              value={`${managerKpis.operational.completion_pct.toFixed(1)}%`}
              hint={`${managerKpis.operational.completed}/${managerKpis.operational.total} obras`}
              color={managerKpis.operational.completion_pct >= 70 ? '#39FF14' : '#E0FF00'}
            />
            <KpiCard
              testid="kpi-lead-days"
              icon={<Timer className="w-4 h-4" />}
              label="Prazo Médio"
              value={`${managerKpis.operational.avg_lead_days.toFixed(0)}d`}
              hint="Início → conclusão"
              color="#A855F7"
            />
            <KpiCard
              testid="kpi-mom-delta"
              icon={managerKpis.mom.delta_pct >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              label="Produção MoM"
              value={`${managerKpis.mom.delta_pct >= 0 ? '+' : ''}${managerKpis.mom.delta_pct.toFixed(1)}%`}
              hint={`${managerKpis.mom.current_month} vs ${managerKpis.mom.previous_month}`}
              color={managerKpis.mom.delta_pct >= 0 ? '#39FF14' : '#FF003C'}
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
                />
                <AlertRow
                  testid="alert-backlog"
                  label="Paradas no faturamento (>15d)"
                  count={managerKpis.financial.backlog_count}
                  extra={managerKpis.financial.backlog_value > 0 && formatCurrency(managerKpis.financial.backlog_value)}
                  color="#FF5E00"
                />
                <AlertRow
                  testid="alert-losses"
                  label="Custo de perdas no período"
                  count={managerKpis.losses.unproductive_hours > 0 || managerKpis.losses.unavailable_days > 0 ? formatCurrency(managerKpis.losses.estimated_cost) : '—'}
                  extra={`${managerKpis.losses.unproductive_hours}h + ${managerKpis.losses.unavailable_days}d`}
                  color="#E0FF00"
                  noBadge
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
                />
                <HighlightCard
                  testid="highlight-worst-team"
                  icon={<TrendingDown className="w-3.5 h-3.5" />}
                  label="Precisa Atenção"
                  primary={managerKpis.highlights.worst_team?.name || '—'}
                  secondary={managerKpis.highlights.worst_team ? `${managerKpis.highlights.worst_team.productivity_pct}% de aderência` : 'Sem dados'}
                  color="#FF5E00"
                />
                <HighlightCard
                  testid="highlight-top-type"
                  icon={<Zap className="w-3.5 h-3.5" />}
                  label="Tipo Mais Rentável"
                  primary={managerKpis.highlights.top_type?.type || '—'}
                  secondary={managerKpis.highlights.top_type ? `${formatCurrency(managerKpis.highlights.top_type.billing)} faturado` : 'Sem dados'}
                  color="#E0FF00"
                />
              </div>
            </motion.div>
          </div>
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
            <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">Sem dados</div>
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
const KpiCard = ({ testid, icon, label, value, hint, color }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    data-testid={testid}
    className="glass-panel rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-all"
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
    {hint && <p className="text-[10px] text-zinc-500 truncate">{hint}</p>}
  </motion.div>
);

const AlertRow = ({ testid, label, count, extra, color, noBadge }) => (
  <div data-testid={testid} className="flex items-center justify-between gap-3">
    <div className="flex-1 min-w-0">
      <p className="text-xs text-zinc-300 truncate">{label}</p>
      {extra && <p className="text-[10px] font-mono text-zinc-500">{extra}</p>}
    </div>
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

const HighlightCard = ({ testid, icon, label, primary, secondary, color }) => (
  <div
    data-testid={testid}
    className="rounded-xl p-3 border transition-all"
    style={{ backgroundColor: `${color}08`, borderColor: `${color}30` }}
  >
    <div className="flex items-center gap-1.5 mb-1.5" style={{ color }}>
      {icon}
      <p className="text-[9px] tracking-[0.2em] uppercase font-bold">{label}</p>
    </div>
    <p className="text-white font-bold text-sm truncate mb-0.5" title={primary}>{primary}</p>
    <p className="text-[10px] text-zinc-400">{secondary}</p>
  </div>
);
