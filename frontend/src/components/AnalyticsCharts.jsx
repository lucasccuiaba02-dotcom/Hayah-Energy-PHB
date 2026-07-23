import React from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const COLORS = ['#00F0FF', '#39FF14', '#E0FF00', '#FF5E00', '#6366F1', '#FF003C', '#94A3B8'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="glass-panel rounded-lg p-3 border border-white/20">
      <p className="text-white text-sm font-bold mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs font-mono" style={{ color: entry.color }}>
          {entry.name}: R$ {(entry.value || 0).toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  );
};

export const AnalyticsCharts = ({ analytics }) => {
  if (!analytics) return null;

  const teamData = analytics.by_team || [];
  const typeData = analytics.by_type || [];

  const pieData = typeData.map((t) => ({ name: t.type, value: t.programmed }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="analytics-charts"
      className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"
    >
      <div className="glass-panel rounded-2xl p-6">
        <div className="mb-4">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">
            Produção por Equipe
          </p>
          <h3 className="font-heading font-black text-xl tracking-tighter text-white">
            Meta vs Realizado
          </h3>
        </div>
        {teamData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">
            Sem dados para exibir
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={teamData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="team" stroke="#71717a" style={{ fontSize: '11px' }} />
              <YAxis
                stroke="#71717a"
                style={{ fontSize: '11px' }}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '12px', color: '#a1a1aa' }} />
              <Bar dataKey="programmed" name="Programado" fill="#00F0FF" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Produção" fill="#39FF14" radius={[4, 4, 0, 0]} />
              <Bar dataKey="billing" name="Faturamento" fill="#E0FF00" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-6">
        <div className="mb-4">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">
            Distribuição
          </p>
          <h3 className="font-heading font-black text-xl tracking-tighter text-white">
            Projetos por Tipo
          </h3>
        </div>
        {pieData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-zinc-600 text-sm">
            Sem dados para exibir
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={90}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#050505" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  );
};
