import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { AppLayout } from '../components/AppLayout';
import { ProjectFilters } from '../components/ProjectFilters';
import { PROJECT_TYPE_LABEL, formatCurrency } from '../lib/constants';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line, ComposedChart, Area, AreaChart,
} from 'recharts';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const COLORS = ['#00F0FF', '#39FF14', '#E0FF00', '#FF5E00', '#6366F1', '#FF003C', '#94A3B8', '#22D3EE', '#A855F7', '#EC4899', '#10B981', '#F59E0B'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="glass-panel rounded-lg p-3 border border-white/20">
      <p className="text-white text-sm font-bold mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs font-mono" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? formatCurrency(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
};

export const AnalisePage = () => {
  const [analytics, setAnalytics] = useState(null);
  const [advanced, setAdvanced] = useState(null);
  const [teams, setTeams] = useState([]);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', teamId: '', minValue: '', maxValue: '' });
  const [topExpensive, setTopExpensive] = useState([]);

  useEffect(() => {
    axios.get(`${API}/teams`).then(({ data }) => setTeams(data));
    axios.get(`${API}/analytics/advanced`).then(({ data }) => setAdvanced(data));
    axios.get(`${API}/analytics/top-expensive`).then(({ data }) => setTopExpensive(data)).catch(() => {});
  }, []);

  const filteredTop = useMemo(() => {
    const minV = parseFloat(filters.minValue);
    const maxV = parseFloat(filters.maxValue);
    return topExpensive.filter((p) => {
      if (filters.teamId && p.team_id !== filters.teamId) return false;
      const ps = (p.start_date || '').slice(0, 10);
      if (filters.startDate && ps && ps < filters.startDate) return false;
      if (filters.endDate && ps && ps > filters.endDate) return false;
      const v = p.programmed_value || 0;
      if (!isNaN(minV) && v < minV) return false;
      if (!isNaN(maxV) && v > maxV) return false;
      return true;
    });
  }, [topExpensive, filters]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    if (filters.teamId) params.append('team_id', filters.teamId);
    axios.get(`${API}/analytics/production?${params.toString()}`).then(({ data }) => setAnalytics(data));
  }, [filters]);

  return (
    <AppLayout title="Análise" subtitle="Visão completa da operação">
      <ProjectFilters
        filters={filters}
        onChange={setFilters}
        teams={teams}
        onReset={() => setFilters({ startDate: '', endDate: '', teamId: '', minValue: '', maxValue: '' })}
        showValueFilter={true}
      />

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
              <BarChart data={advanced.team_performance} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#71717a" style={{ fontSize: '11px' }} tickFormatter={(v) => `${v}%`} />
                <YAxis dataKey="team" type="category" stroke="#71717a" style={{ fontSize: '11px' }} width={100} />
                <Tooltip
                  contentStyle={{ background: '#09090b', border: '1px solid rgba(255,255,255,0.2)' }}
                  formatter={(v) => `${v}%`}
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
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Oportunidades</p>
            <h3 className="font-heading font-black text-xl tracking-tighter text-white">Top 10 Obras Mais Caras</h3>
            <p className="text-xs text-zinc-500 mt-1">Ativas (excluindo concluídas e canceladas)</p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00]">
            {filteredTop.length} obra{filteredTop.length !== 1 ? 's' : ''}
          </span>
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
