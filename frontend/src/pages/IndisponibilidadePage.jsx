import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Users, Plus, X, CalendarX, TrendingDown, DollarSign, AlertCircle, Filter,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, LineChart, Line, Legend,
} from 'recharts';
import { AppLayout } from '../components/AppLayout';
import { UNAVAILABILITY_REASONS, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Custo/dia por equipe indisponível (8h × R$ 100/h + veículo). Ajustável.
const COST_PER_DAY_UNAVAILABLE = 800;

const REASON_COLOR = {
  frota: '#FF5E00',
  chuva: '#00F0FF',
  temporal: '#B4009E',
  seguranca: '#FF003C',
  acesso: '#E0FF00',
  ferias: '#39FF14',
  treinamento: '#00A050',
  manutencao_veiculo: '#FFB800',
  outro: '#94A3B8',
};

const REASON_LABEL = UNAVAILABILITY_REASONS.reduce((acc, r) => { acc[r.value] = r.label; return acc; }, {});

const fmtBR = (n) => Number(n || 0).toLocaleString('pt-BR');
const fmtCurrency = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KpiCard = ({ icon: Icon, label, value, hint, color = '#E0FF00', testid }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
    data-testid={testid}
    className="glass-panel rounded-2xl p-4 border"
    style={{ borderColor: `${color}30` }}
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

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg p-3 border border-white/20" style={{ background: '#09090b' }}>
      <p className="text-white text-sm font-bold mb-1">{label}</p>
      {payload.map((e, i) => (
        <p key={i} className="text-xs font-mono" style={{ color: e.color }}>
          {e.name}: {typeof e.value === 'number' ? fmtBR(e.value) : e.value}
        </p>
      ))}
    </div>
  );
};

export const IndisponibilidadePage = () => {
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('chuva');
  const [notes, setNotes] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterReason, setFilterReason] = useState('');

  const fetchAll = async () => {
    try {
      const [t, u] = await Promise.all([
        axios.get(`${API}/teams`),
        axios.get(`${API}/team-unavailability`),
      ]);
      setTeams(t.data);
      setItems(u.data);
    } catch (err) {
      console.error('indisp fetch', err);
      toast.error('Erro ao carregar dados');
    }
  };
  useEffect(() => { fetchAll(); }, []);

  const add = async () => {
    if (!teamId || !date) { toast.error('Escolha equipe e data'); return; }
    try {
      await axios.post(`${API}/team-unavailability`, { team_id: teamId, date, reason, notes });
      toast.success('Indisponibilidade registrada');
      setNotes('');
      fetchAll();
    } catch (err) {
      console.error('indisp add', err);
      toast.error('Erro');
    }
  };

  const remove = async (id) => {
    try {
      await axios.delete(`${API}/team-unavailability/${id}`);
      toast.info('Removido');
      fetchAll();
    } catch (err) {
      console.error('indisp remove', err);
    }
  };

  // Filtros
  const filtered = useMemo(() => items.filter((it) => {
    if (filterStart && it.date < filterStart) return false;
    if (filterEnd && it.date > filterEnd) return false;
    if (filterReason && it.reason !== filterReason) return false;
    return true;
  }), [items, filterStart, filterEnd, filterReason]);

  // KPIs
  const kpis = useMemo(() => {
    const total_days = filtered.length;
    const byReason = {};
    const byTeam = {};
    filtered.forEach((it) => {
      byReason[it.reason] = (byReason[it.reason] || 0) + 1;
      const tname = it.team_name || '—';
      byTeam[tname] = (byTeam[tname] || 0) + 1;
    });
    const topReason = Object.keys(byReason).sort((a, b) => byReason[b] - byReason[a])[0];
    const topTeam = Object.keys(byTeam).sort((a, b) => byTeam[b] - byTeam[a])[0];
    return {
      total_days,
      top_reason: topReason ? { key: topReason, label: REASON_LABEL[topReason] || topReason, count: byReason[topReason] } : null,
      top_team: topTeam ? { name: topTeam, count: byTeam[topTeam] } : null,
      cost_estimate: total_days * COST_PER_DAY_UNAVAILABLE,
    };
  }, [filtered]);

  // Chart data: barras por motivo
  const byReasonData = useMemo(() => {
    const g = {};
    filtered.forEach((it) => { g[it.reason] = (g[it.reason] || 0) + 1; });
    return Object.keys(g).map((k) => ({
      motivo: REASON_LABEL[k] || k,
      dias: g[k],
      color: REASON_COLOR[k] || '#94A3B8',
    })).sort((a, b) => b.dias - a.dias);
  }, [filtered]);

  // Pizza por tipo (agrupa motivos similares em categorias)
  const byTeamPie = useMemo(() => {
    const g = {};
    filtered.forEach((it) => {
      const t = it.team_name || '—';
      g[t] = (g[t] || 0) + 1;
    });
    const colors = ['#00F0FF', '#39FF14', '#E0FF00', '#FF5E00', '#FF003C', '#B4009E', '#FFB800', '#00A050'];
    return Object.keys(g).map((k, i) => ({ name: k, value: g[k], color: colors[i % colors.length] }));
  }, [filtered]);

  // Linha temporal por dia
  const timelineData = useMemo(() => {
    const g = {};
    filtered.forEach((it) => { g[it.date] = (g[it.date] || 0) + 1; });
    return Object.keys(g).sort().map((d) => ({ data: d.slice(5), dias: g[d] }));
  }, [filtered]);

  return (
    <AppLayout title="Indisponibilidade" subtitle="Bloqueie datas em que uma equipe não vai produzir">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard testid="indisp-kpi-total" icon={CalendarX} label="Total dias parados" value={fmtBR(kpis.total_days)} hint="período filtrado" color="#FF5E00" />
        <KpiCard testid="indisp-kpi-motivo" icon={AlertCircle} label="Top motivo" value={kpis.top_reason ? kpis.top_reason.label : '—'} hint={kpis.top_reason ? `${kpis.top_reason.count} dias` : 'sem dados'} color="#FF003C" />
        <KpiCard testid="indisp-kpi-equipe" icon={Users} label="Top equipe afetada" value={kpis.top_team ? kpis.top_team.name : '—'} hint={kpis.top_team ? `${kpis.top_team.count} dias` : 'sem dados'} color="#00F0FF" />
        <KpiCard testid="indisp-kpi-custo" icon={DollarSign} label="Custo estimado" value={fmtCurrency(kpis.cost_estimate)} hint={`${fmtCurrency(COST_PER_DAY_UNAVAILABLE)}/dia`} color="#E0FF00" />
      </div>

      {/* Form de registro */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Equipe</label>
            <select data-testid="unav-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[200px]">
              <option value="">— Selecione —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Data</label>
            <input data-testid="unav-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Motivo</label>
            <select data-testid="unav-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
              {UNAVAILABILITY_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Observações</label>
            <input data-testid="unav-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <button data-testid="unav-add" onClick={add} className="flex items-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-xs font-bold px-4 py-2 rounded-full">
            <Plus className="w-3 h-3" /> Registrar
          </button>
        </div>
      </motion.div>

      {/* Filtros */}
      <div className="glass-panel rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-[#E0FF00]" />
        <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Filtros</span>
        <input data-testid="indisp-filter-start" type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono" />
        <span className="text-zinc-500 text-xs">→</span>
        <input data-testid="indisp-filter-end" type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono" />
        <select data-testid="indisp-filter-reason" value={filterReason} onChange={(e) => setFilterReason(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
          <option value="">Todos os motivos</option>
          {UNAVAILABILITY_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        {/* Barras por motivo */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-2xl p-4" data-testid="indisp-chart-motivo">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Dias parados por Motivo</p>
          {byReasonData.length === 0 ? (
            <p className="text-center text-zinc-500 py-10 text-sm">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byReasonData} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#71717a" style={{ fontSize: '11px' }} />
                <YAxis dataKey="motivo" type="category" stroke="#71717a" style={{ fontSize: '11px' }} width={130} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="dias" radius={[0, 4, 4, 0]}>
                  {byReasonData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Pizza por equipe */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-2xl p-4" data-testid="indisp-chart-equipe">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Distribuição por Equipe</p>
          {byTeamPie.length === 0 ? (
            <p className="text-center text-zinc-500 py-10 text-sm">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={byTeamPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {byTeamPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Timeline */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-2xl p-4 lg:col-span-2" data-testid="indisp-chart-timeline">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Ocorrências no tempo</p>
          {timelineData.length === 0 ? (
            <p className="text-center text-zinc-500 py-10 text-sm">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="data" stroke="#71717a" style={{ fontSize: '11px' }} />
                <YAxis stroke="#71717a" style={{ fontSize: '11px' }} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="dias" name="Ocorrências" stroke="#FF5E00" strokeWidth={2} dot={{ fill: '#FF5E00', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      {/* Tabela detalhada */}
      <div className="glass-panel rounded-2xl overflow-hidden" data-testid="indisp-table">
        <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500">Registros ({filtered.length})</p>
        </div>
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-zinc-500 text-sm">Nenhuma indisponibilidade no período.</div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {filtered.map((it) => (
              <div key={it.id} data-testid={`unav-item-${it.id}`} className="p-3 flex items-center gap-3 flex-wrap border-b border-white/5 hover:bg-white/[0.02]">
                <CalendarX className="w-4 h-4 text-[#FF5E00]" />
                <span className="font-mono text-xs text-white">{it.date}</span>
                <span className="text-xs text-white font-bold">{it.team_name}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase"
                      style={{ background: `${REASON_COLOR[it.reason] || '#94A3B8'}20`, borderColor: `${REASON_COLOR[it.reason] || '#94A3B8'}60`, color: REASON_COLOR[it.reason] || '#94A3B8' }}>
                  {REASON_LABEL[it.reason] || it.reason}
                </span>
                {it.notes && <span className="text-[11px] text-zinc-500 italic">{it.notes}</span>}
                <button data-testid={`unav-del-${it.id}`} onClick={() => remove(it.id)} className="ml-auto w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-[#FF003C] flex items-center justify-center">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};
