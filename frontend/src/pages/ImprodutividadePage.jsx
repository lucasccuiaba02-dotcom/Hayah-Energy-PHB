import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Plus, X, TrendingDown, Filter, DollarSign, AlertCircle, Users, Clock,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, LineChart, Line, Legend,
} from 'recharts';
import { AppLayout } from '../components/AppLayout';
import { IMPRODUTIVIDADE_REASONS, IMPRODUTIVIDADE_REASON_LABEL, todayISO, IMPROD_REASON_COLOR, OP_COLOR_LEGEND, teamHourCost } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Set/2026 · cores operacionais + custo/hora = meta diária da equipe ÷ 8h (jornada comercial)
const REASON_COLOR = IMPROD_REASON_COLOR;

const fmtBR = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtCurrency = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KpiCard = ({ icon: Icon, label, value, hint, color = '#E0FF00', testid }) => (
  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid={testid}
    className="glass-panel rounded-2xl p-4 border" style={{ borderColor: `${color}30` }}>
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

export const ImprodutividadePage = () => {
  const [teams, setTeams] = useState([]);
  const [items, setItems] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('chuva');
  const [hoursLost, setHoursLost] = useState('');
  const [notes, setNotes] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterReason, setFilterReason] = useState('');

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (filterStart) params.append('start', filterStart);
      if (filterEnd) params.append('end', filterEnd);
      const [t, u] = await Promise.all([
        axios.get(`${API}/teams`),
        axios.get(`${API}/team-unproductivity?${params.toString()}`),
      ]);
      setTeams(t.data);
      setItems(u.data);
    } catch (err) {
      console.error('improd load', err);
      toast.error('Erro ao carregar');
    }
  };

  useEffect(() => { load(); }, [filterStart, filterEnd]);

  const add = async () => {
    if (!teamId || !date) { toast.error('Escolha equipe e data'); return; }
    try {
      await axios.post(`${API}/team-unproductivity`, {
        team_id: teamId, date, reason, notes,
        hours_lost: parseFloat(hoursLost) || 0,
      });
      toast.success('Improdutividade registrada');
      setNotes(''); setHoursLost('');
      load();
    } catch (err) {
      console.error('improd add', err);
      toast.error('Erro ao registrar');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Remover este registro?')) return;
    try {
      await axios.delete(`${API}/team-unproductivity/${id}`);
      toast.info('Removido');
      load();
    } catch (err) {
      console.error('improd remove', err);
    }
  };

  const filtered = useMemo(() => items.filter((it) => !filterReason || it.reason === filterReason), [items, filterReason]);
  const totalHours = useMemo(() => filtered.reduce((s, i) => s + (i.hours_lost || 0), 0), [filtered]);
  const teamById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);
  const costOf = (it) => (it.hours_lost || 0) * teamHourCost(teamById[it.team_id] || teams.find((t) => t.name === it.team_name));
  const avgHourCost = useMemo(() => (teams.length ? teams.reduce((s, t) => s + teamHourCost(t), 0) / teams.length : teamHourCost(null)), [teams]);

  // KPIs
  const kpis = useMemo(() => {
    const total_hours = totalHours;
    const byReason = {};
    const byTeam = {};
    filtered.forEach((it) => {
      byReason[it.reason] = (byReason[it.reason] || 0) + (it.hours_lost || 0);
      const tname = it.team_name || '—';
      byTeam[tname] = (byTeam[tname] || 0) + (it.hours_lost || 0);
    });
    const topReason = Object.keys(byReason).sort((a, b) => byReason[b] - byReason[a])[0];
    const topTeam = Object.keys(byTeam).sort((a, b) => byTeam[b] - byTeam[a])[0];
    return {
      total_hours,
      top_reason: topReason ? { key: topReason, label: IMPRODUTIVIDADE_REASON_LABEL[topReason] || topReason, hours: byReason[topReason] } : null,
      top_team: topTeam ? { name: topTeam, hours: byTeam[topTeam] } : null,
      cost_estimate: filtered.reduce((s, it) => s + costOf(it), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, totalHours, teamById]);

  const byReasonData = useMemo(() => {
    const g = {};
    filtered.forEach((it) => { g[it.reason] = (g[it.reason] || 0) + (it.hours_lost || 0); });
    return Object.keys(g).map((k) => ({
      motivo: IMPRODUTIVIDADE_REASON_LABEL[k] || k,
      horas: parseFloat(g[k].toFixed(1)),
      color: REASON_COLOR[k] || '#94A3B8',
    })).sort((a, b) => b.horas - a.horas);
  }, [filtered]);

  const byTeamPie = useMemo(() => {
    const g = {};
    filtered.forEach((it) => {
      const t = it.team_name || '—';
      g[t] = (g[t] || 0) + (it.hours_lost || 0);
    });
    const colors = ['#3B82F6', '#39FF14', '#FF5E00', '#FF003C', '#A855F7', '#00F0FF', '#E0FF00', '#94A3B8'];
    return Object.keys(g).map((k, i) => ({ name: k, value: parseFloat(g[k].toFixed(1)), color: colors[i % colors.length] }));
  }, [filtered]);

  const timelineData = useMemo(() => {
    const g = {};
    filtered.forEach((it) => { g[it.date] = (g[it.date] || 0) + (it.hours_lost || 0); });
    return Object.keys(g).sort().map((d) => ({ data: d.slice(5), horas: parseFloat(g[d].toFixed(1)) }));
  }, [filtered]);

  return (
    <AppLayout title="Improdutividade" subtitle="Registre e visualize horas perdidas por motivos operacionais">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard testid="improd-kpi-total" icon={Clock} label="Total horas perdidas" value={`${fmtBR(kpis.total_hours)}h`} hint={`${filtered.length} ocorrências`} color="#FF5E00" />
        <KpiCard testid="improd-kpi-motivo" icon={AlertCircle} label="Top motivo" value={kpis.top_reason ? kpis.top_reason.label : '—'} hint={kpis.top_reason ? `${fmtBR(kpis.top_reason.hours)}h` : 'sem dados'} color="#FF003C" />
        <KpiCard testid="improd-kpi-equipe" icon={Users} label="Top equipe afetada" value={kpis.top_team ? kpis.top_team.name : '—'} hint={kpis.top_team ? `${fmtBR(kpis.top_team.hours)}h` : 'sem dados'} color="#3B82F6" />
        <KpiCard testid="improd-kpi-custo" icon={DollarSign} label="Custo estimado" value={fmtCurrency(kpis.cost_estimate)} hint={`meta diária da equipe ÷ 8h (média ${fmtCurrency(avgHourCost)}/h)`} color="#E0FF00" />
      </div>
      <div data-testid="improd-color-legend" className="flex flex-wrap items-center gap-3 mb-4 text-[10px] text-zinc-400">
        <span className="tracking-[0.2em] uppercase font-bold text-zinc-500">Cores:</span>
        {OP_COLOR_LEGEND.map((l) => <span key={l.label} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} /> {l.label}</span>)}
      </div>

      {/* Form */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Equipe</label>
            <select data-testid="improd-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[200px]">
              <option value="">— Selecione —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Data</label>
            <input data-testid="improd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Motivo</label>
            <select data-testid="improd-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white min-w-[220px]">
              {IMPRODUTIVIDADE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Horas perdidas</label>
            <input data-testid="improd-hours" type="number" step="0.5" min="0" value={hoursLost} onChange={(e) => setHoursLost(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono w-28" placeholder="0" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-1">Observação</label>
            <input data-testid="improd-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Detalhes do imprevisto..." />
          </div>
          <button data-testid="improd-add" onClick={add} className="bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold px-5 py-2 rounded-full transition-all inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Registrar
          </button>
        </div>
      </motion.div>

      {/* Filtros */}
      <div className="glass-panel rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-[#E0FF00]" />
        <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Filtros</span>
        <input data-testid="improd-filter-start" type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono" />
        <span className="text-zinc-500 text-xs">→</span>
        <input data-testid="improd-filter-end" type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono" />
        <select data-testid="improd-filter-reason" value={filterReason} onChange={(e) => setFilterReason(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
          <option value="">Todos os motivos</option>
          {IMPRODUTIVIDADE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <div className="ml-auto text-[11px] text-zinc-400">
          <span className="text-[#FF5E00] font-bold">{filtered.length}</span> registros ·
          <span className="text-white font-bold ml-2">{fmtBR(totalHours)}h</span> perdidas
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-2xl p-4" data-testid="improd-chart-motivo">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Horas Perdidas por Motivo</p>
          {byReasonData.length === 0 ? <p className="text-center text-zinc-500 py-10 text-sm">Sem dados</p> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byReasonData} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="#71717a" style={{ fontSize: '11px' }} />
                <YAxis dataKey="motivo" type="category" stroke="#71717a" style={{ fontSize: '11px' }} width={140} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="horas" radius={[0, 4, 4, 0]}>
                  {byReasonData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-2xl p-4" data-testid="improd-chart-equipe">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Distribuição por Equipe (horas)</p>
          {byTeamPie.length === 0 ? <p className="text-center text-zinc-500 py-10 text-sm">Sem dados</p> : (
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

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-2xl p-4 lg:col-span-2" data-testid="improd-chart-timeline">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Evolução de Horas no Tempo</p>
          {timelineData.length === 0 ? <p className="text-center text-zinc-500 py-10 text-sm">Sem dados</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="data" stroke="#71717a" style={{ fontSize: '11px' }} />
                <YAxis stroke="#71717a" style={{ fontSize: '11px' }} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="horas" name="Horas perdidas" stroke="#FF003C" strokeWidth={2} dot={{ fill: '#FF003C', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      {/* Tabela */}
      <div className="glass-panel rounded-2xl overflow-hidden" data-testid="improd-list">
        {filtered.length === 0 ? (
          <p className="text-center text-zinc-500 py-10 text-sm">Nenhum registro no período selecionado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[10px] tracking-[0.15em] uppercase text-zinc-500">
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-left px-4 py-2">Equipe</th>
                <th className="text-left px-4 py-2">Motivo</th>
                <th className="text-right px-4 py-2">Horas</th>
                <th className="text-right px-4 py-2">Custo</th>
                <th className="text-left px-4 py-2">Observação</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} data-testid={`improd-item-${it.id}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2 font-mono text-xs text-white">{it.date}</td>
                  <td className="px-4 py-2 text-white">{it.team_name || '—'}</td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                          style={{ background: `${REASON_COLOR[it.reason] || '#94A3B8'}20`, borderColor: `${REASON_COLOR[it.reason] || '#94A3B8'}60`, color: REASON_COLOR[it.reason] || '#94A3B8' }}>
                      {IMPRODUTIVIDADE_REASON_LABEL[it.reason] || it.reason}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sm text-white">{(it.hours_lost || 0).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right font-mono text-[11px] text-[#E0FF00]" data-testid={`improd-cost-${it.id}`}>{fmtCurrency(costOf(it))}</td>
                  <td className="px-4 py-2 text-zinc-400 text-xs">{it.notes || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button data-testid={`improd-delete-${it.id}`} onClick={() => remove(it.id)} className="w-7 h-7 rounded-md bg-white/5 hover:bg-[#FF003C]/20 flex items-center justify-center text-zinc-500 hover:text-[#FF003C]">
                      <X className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
};
