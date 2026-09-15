import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Calendar, MapPin, Zap, History, ClipboardCheck, Users as UsersIcon, Sun, ArrowRight, CircleDot, FileText, XCircle, CheckCircle2, DollarSign, Truck } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { ProjectDrawer } from '../components/ProjectDrawer';
import { ProjectFilters } from '../components/ProjectFilters';
import { RetornoProgramacaoModal } from '../components/RetornoProgramacaoModal';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS_LABEL, formatCurrency, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const ProgramacaoPage = () => {
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', teamId: '' });
  const [specificDate, setSpecificDate] = useState('');
  const [minProd, setMinProd] = useState('');
  const [maxProd, setMaxProd] = useState('');
  const [historyOpen, setHistoryOpen] = useState(null);
  const [retornoOpen, setRetornoOpen] = useState(false);
  const [hojeOpen, setHojeOpen] = useState(false);
  const [viewMode, setViewMode] = useState('matrix'); // 'date' | 'matrix'
  const [pendingReturnsCount, setPendingReturnsCount] = useState(0);

  useEffect(() => {
    fetchData();
    fetchPendingReturns();
  }, []);

  const fetchPendingReturns = async () => {
    try {
      const { data } = await axios.get(`${API}/programacao/pending-returns`);
      setPendingReturnsCount(Array.isArray(data) ? data.length : (data?.count || 0));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchStats();
  }, [filters]);

  const fetchData = async () => {
    try {
      const [projRes, teamRes] = await Promise.all([
        axios.get(`${API}/projects?is_scheduled=true`),
        axios.get(`${API}/teams`),
      ]);
      setProjects(projRes.data);
      setTeams(teamRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('start_date', filters.startDate);
      if (filters.endDate) params.append('end_date', filters.endDate);
      if (filters.teamId) params.append('team_id', filters.teamId);
      const { data } = await axios.get(`${API}/schedule/stats?${params.toString()}`);
      setStats(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async (data) => {
    if (editing) {
      await axios.put(`${API}/projects/${editing.id}`, data);
      toast.success('Programação atualizada!');
    } else {
      await axios.post(`${API}/projects`, data);
      toast.success('Projeto programado! Notificação enviada.');
    }
    fetchData();
    fetchStats();
    setIsDrawerOpen(false);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir esta programação?')) return;
    try {
      await axios.delete(`${API}/projects/${id}`);
      toast.success('Programação removida!');
      fetchData();
      fetchStats();
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  const filtered = useMemo(() => {
    const minP = parseFloat(minProd);
    const maxP = parseFloat(maxProd);
    return projects.filter((p) => {
      if (filters.teamId && p.team_id !== filters.teamId && p.additional_team_id !== filters.teamId) return false;
      const pStart = (p.start_date || '').slice(0, 10);
      const pEnd = (p.end_date || '').slice(0, 10);
      if (filters.startDate && pEnd && pEnd < filters.startDate) return false;
      if (filters.endDate && pStart && pStart > filters.endDate) return false;
      if (specificDate) {
        if (!pStart) return false;
        if (specificDate < pStart || (pEnd && specificDate > pEnd) || (!pEnd && specificDate !== pStart)) return false;
      }
      const val = p.programmed_value || 0;
      if (!isNaN(minP) && val < minP) return false;
      if (!isNaN(maxP) && val > maxP) return false;
      return true;
    });
  }, [projects, filters, specificDate, minProd, maxProd]);

  // Expand projects using schedule_entries when present, else fall back to legacy single-date + additional_team
  const expanded = useMemo(() => {
    const out = [];
    filtered.forEach((p) => {
      const entries = (p.schedule_entries && p.schedule_entries.length)
        ? p.schedule_entries
        : (p.start_date
          ? [{
              date: p.start_date.slice(0, 10),
              team_ids: [p.team_id, p.additional_team_id].filter(Boolean),
              team_names: [p.team_name, p.additional_team_name].filter(Boolean),
            }]
          : []);
      entries.forEach((entry) => {
        const teamIds = entry.team_ids && entry.team_ids.length ? entry.team_ids : [null];
        teamIds.forEach((tid, i) => {
          const teamName = (entry.team_names && entry.team_names[i]) || teams.find((t) => t.id === tid)?.name || '';
          out.push({
            ...p,
            _entryDate: (entry.date || '').slice(0, 10),
            _teamColId: tid || '__none__',
            _teamColName: teamName,
            _isAdditional: i > 0,
          });
        });
      });
    });
    return out;
  }, [filtered, teams]);

  const grouped = useMemo(() => {
    const map = {};
    expanded.forEach((p) => {
      const date = p._entryDate || 'Sem data';
      if (!map[date]) map[date] = [];
      map[date].push(p);
    });
    return Object.keys(map).sort().map((date) => ({ date, projects: map[date] }));
  }, [expanded]);

  // Matrix: dates x teams
  const matrix = useMemo(() => {
    const dateSet = new Set();
    const teamSet = new Set();
    const map = {}; // map[date][teamId] = [projects]
    expanded.forEach((p) => {
      const date = p._entryDate || 'Sem data';
      const tid = p._teamColId || '__none__';
      dateSet.add(date);
      teamSet.add(tid);
      map[date] = map[date] || {};
      map[date][tid] = map[date][tid] || [];
      map[date][tid].push(p);
    });
    const dateList = Array.from(dateSet).sort();
    const teamList = Array.from(teamSet);
    return { dateList, teamList, map };
  }, [expanded]);
  const todayStr = todayISO();

  return (
    <AppLayout
      title="Programação"
      subtitle="Matriz de obras programadas"
      actions={
        <>
          <button
            data-testid="open-hoje-button"
            onClick={() => setHojeOpen(true)}
            className="bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 border border-[#00F0FF]/50 text-[#00F0FF] font-bold px-4 py-2 rounded-full transition-all flex items-center gap-2"
          >
            <Sun className="w-4 h-4" />
            Hoje
          </button>
          <button
            data-testid="open-retorno-button"
            onClick={() => setRetornoOpen(true)}
            className="relative bg-[#E0FF00]/15 hover:bg-[#E0FF00]/25 border border-[#E0FF00]/50 text-[#E0FF00] font-bold px-4 py-2 rounded-full transition-all flex items-center gap-2"
          >
            <ClipboardCheck className="w-4 h-4" />
            Retorno de Programação
            {pendingReturnsCount > 0 && (
              <span data-testid="pending-returns-badge" className="ml-1 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#FF003C] text-white text-[10px] font-black">
                {pendingReturnsCount}
              </span>
            )}
          </button>
          <div className="flex items-center bg-white/5 border border-white/10 rounded-full p-1">
            <button
              data-testid="view-mode-matrix"
              onClick={() => setViewMode('matrix')}
              className={`text-[11px] font-bold px-3 py-1 rounded-full ${viewMode === 'matrix' ? 'bg-[#E0FF00] text-black' : 'text-zinc-400'}`}
            >
              Matriz
            </button>
            <button
              data-testid="view-mode-date"
              onClick={() => setViewMode('date')}
              className={`text-[11px] font-bold px-3 py-1 rounded-full ${viewMode === 'date' ? 'bg-[#E0FF00] text-black' : 'text-zinc-400'}`}
            >
              Cards
            </button>
          </div>
          <button
            data-testid="add-programacao-button"
            onClick={() => { setEditing(null); setIsDrawerOpen(true); }}
            className="bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold px-6 py-2 rounded-full transition-all transform hover:scale-105 flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Programar Obra
          </button>
        </>
      }
    >
      {stats && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <div data-testid="prog-stat-total" className="glass-panel rounded-xl p-4">
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Total</p>
            <p className="font-mono text-2xl font-bold text-white">{stats.total_projects}</p>
            <p className="text-[10px] text-zinc-600 mt-1 font-mono">{formatCurrency(stats.total_programmed)}</p>
          </div>
          {Object.entries(stats.counts || {}).map(([label, count]) => {
            const st = Object.values(EXECUTION_STATUS_LABEL).find((s) => s.label === label);
            return (
              <div key={label} data-testid={`prog-stat-${label}`} className="glass-panel rounded-xl p-4">
                <p className="text-[10px] tracking-[0.2em] uppercase font-bold" style={{ color: st?.color || '#a1a1aa' }}>
                  {label}
                </p>
                <p className="font-mono text-2xl font-bold text-white mt-1">{count}</p>
              </div>
            );
          })}
        </motion.div>
      )}

      <ProjectFilters filters={filters} onChange={setFilters} teams={teams} onReset={() => setFilters({ startDate: '', endDate: '', teamId: '' })} />

      <div className="glass-panel rounded-xl p-4 mb-6 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Data específica</label>
          <input
            data-testid="prog-specific-date"
            type="date"
            value={specificDate}
            onChange={(e) => setSpecificDate(e.target.value)}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1 text-sm text-white focus:border-[#E0FF00] focus:outline-none font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Prog. mín (R$)</label>
          <input
            data-testid="prog-min-input"
            type="number"
            placeholder="0"
            value={minProd}
            onChange={(e) => setMinProd(e.target.value)}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1 text-sm text-white w-28 focus:border-[#E0FF00] focus:outline-none font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Prog. máx (R$)</label>
          <input
            data-testid="prog-max-input"
            type="number"
            placeholder="∞"
            value={maxProd}
            onChange={(e) => setMaxProd(e.target.value)}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1 text-sm text-white w-28 focus:border-[#E0FF00] focus:outline-none font-mono"
          />
        </div>
        <button
          data-testid="prog-reset-extra"
          onClick={() => { setSpecificDate(''); setMinProd(''); setMaxProd(''); }}
          className="ml-auto text-xs text-zinc-400 hover:text-white underline"
        >
          Limpar filtros extra
        </button>
      </div>

      <div data-testid="programacao-matrix" className="space-y-4">
        {grouped.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <p className="text-zinc-400 text-lg">Nenhuma obra programada.</p>
            <p className="text-zinc-600 text-sm mt-2">Clique em "Programar Obra" para começar.</p>
          </div>
        ) : viewMode === 'matrix' ? (
          <div data-testid="prog-matrix-view" className="glass-panel rounded-2xl overflow-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02]">
                  <th className="sticky left-0 bg-[#09090b] text-left px-3 py-2 text-[10px] tracking-[0.15em] uppercase font-bold text-zinc-500 w-40 z-10">Equipe</th>
                  {matrix.dateList.map((date) => {
                    const isToday = date === todayStr;
                    const isPast = date !== 'Sem data' && date < todayStr;
                    return (
                      <th
                        key={date}
                        data-testid={`matrix-date-${date}`}
                        data-today={isToday ? 'true' : undefined}
                        className={`text-left px-3 py-2 text-[10px] tracking-[0.15em] uppercase font-bold min-w-[220px] ${isToday ? 'text-black bg-[#E0FF00]' : isPast ? 'text-zinc-500' : 'text-[#E0FF00]'}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {date === 'Sem data' ? date : new Date(date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                          {isToday && <span className="ml-1 px-1.5 py-0 rounded-full bg-black text-[#E0FF00] text-[9px] font-black">HOJE</span>}
                          {isPast && <span className="ml-1 text-[9px] font-bold text-zinc-600 normal-case tracking-normal">passado</span>}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matrix.teamList.map((tid) => {
                  const t = teams.find((x) => x.id === tid);
                  return (
                    <tr key={tid} data-testid={`matrix-team-row-${tid}`} className="border-b border-white/5 align-top">
                      <td className="sticky left-0 bg-[#09090b] px-3 py-3 text-xs text-white z-10">
                        <div className="flex items-center gap-1.5">
                          <UsersIcon className="w-3 h-3 text-[#E0FF00]" />
                          <div>
                            <p className="font-bold">{t?.name || 'Sem equipe'}</p>
                            {t?.supervisor && <p className="text-[10px] text-zinc-500">{t.supervisor}</p>}
                          </div>
                        </div>
                      </td>
                      {matrix.dateList.map((date) => {
                        const cellProjects = (matrix.map[date] || {})[tid] || [];
                        const isToday = date === todayStr;
                        const isPast = date !== 'Sem data' && date < todayStr;
                        return (
                          <td key={date} className={`px-2 py-2 ${isToday ? 'bg-[#E0FF00]/[0.06]' : ''} ${isPast ? 'opacity-60 grayscale-[35%]' : ''}`}>
                            <div className="space-y-2">
                              {cellProjects.length === 0 ? (
                                <span className="text-[10px] text-zinc-700">—</span>
                              ) : cellProjects.map((p) => {
                                const execStatus = EXECUTION_STATUS_LABEL[p.execution_status || 'aguardando_programacao'];
                                const bgColor = p.requires_hot_line ? '#FF5E00' : execStatus?.color || '#94A3B8';
                                const hasShutdown = (p.shutdown_dates || []).includes(date) || (!(p.shutdown_dates || []).length && !!p.shutdown_info);
                                return (
                                  <div
                                    key={`${p.id}-${p._teamColId}`}
                                    data-testid={`matrix-cell-${p.id}-${p._teamColId}`}
                                    className="rounded-lg p-2.5 border text-[11px] cursor-pointer hover:brightness-125 transition"
                                    style={{ backgroundColor: `${bgColor}12`, borderColor: `${bgColor}50`, borderLeftWidth: 3, borderLeftColor: bgColor }}
                                    onClick={() => { setEditing(p); setIsDrawerOpen(true); }}
                                  >
                                    <div className="flex items-center gap-1 mb-1 flex-wrap">
                                      <span className="font-mono text-white font-bold">{p.project_code || p.name.slice(0, 12)}</span>
                                      {p._isAdditional && (
                                        <span title="Equipe adicional" className="px-1.5 py-0 rounded-full text-[9px] font-bold bg-[#00F0FF]/20 border border-[#00F0FF]/50 text-[#00F0FF]">2ª</span>
                                      )}
                                      {p.requires_hot_line && (
                                        <span title="Linha Viva" className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-bold bg-[#FF5E00]/20 border border-[#FF5E00] text-[#FF5E00]"><Zap className="w-2.5 h-2.5" />LV</span>
                                      )}
                                      {hasShutdown && (
                                        <span title={p.shutdown_info || 'Desligamento programado'} className="px-1.5 py-0 rounded-full text-[9px] font-bold bg-[#E0FF00]/20 border border-[#E0FF00] text-[#E0FF00]">DESL.</span>
                                      )}
                                    </div>
                                    <p className="text-white font-medium truncate" title={p.name}>{p.name}</p>
                                    {p.location && (
                                      <p className="text-[10px] text-zinc-400 flex items-center gap-1 truncate" title={p.location}>
                                        <MapPin className="w-2.5 h-2.5 flex-shrink-0" />{p.location}
                                      </p>
                                    )}
                                    <p className="text-[10px] text-zinc-400 flex items-center gap-1 truncate">
                                      <UsersIcon className="w-2.5 h-2.5 flex-shrink-0" />{p._teamColName || t?.name || 'Sem equipe'}{p.additional_team_name && !p._isAdditional ? ` + ${p.additional_team_name}` : ''}
                                    </p>
                                    <div className="flex items-center justify-between gap-1 mt-1.5">
                                      <span
                                        className="px-1.5 py-0.5 rounded-full text-[9px] font-bold border whitespace-nowrap"
                                        style={{ backgroundColor: `${execStatus?.color}20`, borderColor: `${execStatus?.color}60`, color: execStatus?.color }}
                                      >
                                        {execStatus?.label}
                                      </span>
                                      <span className="font-mono text-[10px] text-zinc-300 font-bold">{formatCurrency(p.programmed_value)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          grouped.map(({ date, projects }) => (
            <motion.div
              key={date}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel rounded-2xl overflow-hidden"
            >
              <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 bg-white/[0.02]">
                <Calendar className="w-4 h-4 text-[#E0FF00]" />
                <p className="font-mono text-sm font-bold text-white">
                  {date === 'Sem data' ? date : new Date(date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                </p>
                <p className="text-xs text-zinc-500 ml-auto">
                  {projects.length} obra{projects.length !== 1 ? 's' : ''} · {formatCurrency(projects.reduce((s, p) => s + (p.programmed_value || 0), 0))}
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
                {projects.map((p, i) => {
                  const execStatus = EXECUTION_STATUS_LABEL[p.execution_status];
                  const bgColor = p.requires_hot_line ? '#FF5E00' : execStatus?.color || '#94A3B8';
                  return (
                    <div
                      key={`${p.id}-${p._teamColId || 'x'}`}
                      data-testid={`prog-project-${p.id}${p._isAdditional ? '-add' : ''}`}
                      className="rounded-xl p-4 border relative overflow-hidden"
                      style={{
                        backgroundColor: `${bgColor}0D`,
                        borderColor: `${bgColor}40`,
                        boxShadow: `0 0 20px ${bgColor}20`,
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="text-white font-bold text-sm">{p.name}</h3>
                            {p._isAdditional && (
                              <span title="Equipe adicional" className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00F0FF]/20 border border-[#00F0FF]/50 text-[#00F0FF]">
                                2ª EQUIPE
                              </span>
                            )}
                            {p.requires_hot_line && (
                              <span title="Linha Viva" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF5E00]/20 border border-[#FF5E00] text-[#FF5E00]">
                                <Zap className="w-3 h-3" /> LV
                              </span>
                            )}
                            {p.shutdown_info && (
                              <span title={p.shutdown_info} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E0FF00]/20 border border-[#E0FF00] text-[#E0FF00]">
                                DESL.
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
                            <span>{PROJECT_TYPE_LABEL[p.project_type]}</span>
                            {p._teamColName && <span>• {p._teamColName}</span>}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {(() => {
                            const mvCount = (p.movement_history || []).length || (p.reschedule_history || []).length;
                            return (
                              <button
                                data-testid={`prog-history-${p.id}`}
                                onClick={() => setHistoryOpen(p)}
                                disabled={mvCount === 0}
                                title="Timeline · histórico de movimentações"
                                className="w-7 h-7 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#E0FF00] disabled:opacity-30 relative"
                              >
                                <History className="w-3 h-3" />
                                {mvCount > 0 && (
                                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FF5E00] text-[9px] text-white font-bold flex items-center justify-center">
                                    {mvCount}
                                  </span>
                                )}
                              </button>
                            );
                          })()}
                          <button
                            data-testid={`prog-edit-${p.id}`}
                            onClick={() => { setEditing(p); setIsDrawerOpen(true); }}
                            className="w-7 h-7 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#00F0FF]"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            data-testid={`prog-delete-${p.id}`}
                            onClick={() => handleDelete(p.id)}
                            className="w-7 h-7 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C]"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {p.location && (
                        <p className="text-xs text-zinc-300 mt-2 flex items-start gap-1">
                          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-zinc-500" />
                          <span>{p.location}</span>
                        </p>
                      )}
                      {p.shutdown_info && (
                        <p className="text-[10px] text-[#E0FF00]/80 mt-2 italic">"{p.shutdown_info}"</p>
                      )}

                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                        <div>
                          <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500">Programado</p>
                          <p className="font-mono text-sm font-bold text-white">{formatCurrency(p.programmed_value)}</p>
                        </div>
                        <span
                          className="px-2 py-1 rounded-full text-[10px] font-bold border"
                          style={{
                            backgroundColor: `${execStatus?.color}15`,
                            borderColor: `${execStatus?.color}40`,
                            color: execStatus?.color,
                          }}
                        >
                          {execStatus?.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))
        )}
      </div>

      <ProjectDrawer
        isOpen={isDrawerOpen}
        onClose={() => { setIsDrawerOpen(false); setEditing(null); }}
        onSave={handleSave}
        project={editing}
        teams={teams}
        defaultScheduled={true}
      />

      <RetornoProgramacaoModal
        isOpen={retornoOpen}
        onClose={() => setRetornoOpen(false)}
        onDone={() => { fetchData(); fetchStats(); }}
      />

      {hojeOpen && (() => {
        const today = todayISO();
        const hojeList = projects.filter((p) => {
          const s = (p.start_date || '').slice(0, 10);
          const e = (p.end_date || '').slice(0, 10);
          if (!s) return false;
          if (e) return today >= s && today <= e;
          return today === s;
        });
        const totalProg = hojeList.reduce((sum, p) => sum + (p.programmed_value || 0), 0);
        return (
          <div data-testid="hoje-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setHojeOpen(false)}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel rounded-2xl border border-[#00F0FF]/40 max-w-5xl w-full p-6 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="w-10 h-10 rounded-full bg-[#00F0FF]/20 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-[#00F0FF]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-bold text-lg">Programação de Hoje</h3>
                  <p className="text-xs text-zinc-500">{new Date(today + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Total</p>
                  <p className="font-mono text-lg font-bold text-white">{hojeList.length} obra{hojeList.length !== 1 ? 's' : ''}</p>
                  <p className="font-mono text-[10px] text-[#E0FF00]">{formatCurrency(totalProg)}</p>
                </div>
                <button data-testid="hoje-close" onClick={() => setHojeOpen(false)} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white">✕</button>
              </div>

              {hojeList.length === 0 ? (
                <div className="glass-panel rounded-xl p-8 text-center">
                  <p className="text-zinc-400 text-sm">Nenhuma obra programada para hoje.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {hojeList.map((p) => {
                    const execStatus = EXECUTION_STATUS_LABEL[p.execution_status];
                    const bgColor = p.requires_hot_line ? '#FF5E00' : execStatus?.color || '#94A3B8';
                    return (
                      <div
                        key={p.id}
                        data-testid={`hoje-item-${p.id}`}
                        className="rounded-xl p-4 border"
                        style={{ backgroundColor: `${bgColor}10`, borderColor: `${bgColor}40` }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 flex-wrap mb-1">
                              <span className="font-mono text-[11px] text-[#E0FF00] font-bold">{p.project_code || '—'}</span>
                              {p.requires_hot_line && (
                                <span className="px-1.5 py-0 rounded-full text-[9px] font-bold bg-[#FF5E00]/20 border border-[#FF5E00] text-[#FF5E00] inline-flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" />LV</span>
                              )}
                            </div>
                            <h4 className="text-white text-sm font-bold">{p.name}</h4>
                            <p className="text-[10px] text-zinc-500 mt-0.5">{PROJECT_TYPE_LABEL[p.project_type]} · {p.team_name || 'sem equipe'}{p.additional_team_name ? ` + ${p.additional_team_name}` : ''}</p>
                          </div>
                          <button
                            data-testid={`hoje-apr-${p.id}`}
                            onClick={() => window.open(`/obras/${p.id}?apr=1`, '_blank', 'noopener,noreferrer')}
                            className="w-7 h-7 rounded-md bg-[#FF003C]/15 border border-[#FF003C]/50 text-[#FF003C] flex items-center justify-center hover:bg-[#FF003C]/25"
                            title="Abrir APR desta equipe"
                          >
                            <Truck className="w-3 h-3" />
                          </button>
                          <button
                            data-testid={`hoje-edit-${p.id}`}
                            onClick={() => { setEditing(p); setIsDrawerOpen(true); setHojeOpen(false); }}
                            className="w-7 h-7 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#00F0FF]"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                        {p.location && (
                          <p className="text-[11px] text-zinc-300 flex items-start gap-1 mt-2">
                            <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-zinc-500" />
                            <span className="line-clamp-2">{p.location}</span>
                          </p>
                        )}
                        {p.shutdown_info && (
                          <p className="text-[10px] text-[#E0FF00]/80 italic mt-1">Desligamento: {p.shutdown_info}</p>
                        )}
                        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/5">
                          <div>
                            <p className="text-[9px] tracking-[0.15em] uppercase text-zinc-500">Prog.</p>
                            <p className="font-mono text-[11px] text-white font-bold">{formatCurrency(p.programmed_value)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] tracking-[0.15em] uppercase text-zinc-500">Postes</p>
                            <p className="font-mono text-[11px] text-white font-bold">{p.postes_qty || 0}</p>
                          </div>
                          <div>
                            <p className="text-[9px] tracking-[0.15em] uppercase text-zinc-500">Trafos</p>
                            <p className="font-mono text-[11px] text-white font-bold">{p.transformadores_qty || 0}</p>
                          </div>
                        </div>
                        <span
                          className="inline-block mt-2 px-2 py-0.5 rounded-full text-[9px] font-bold border"
                          style={{ backgroundColor: `${execStatus?.color}15`, borderColor: `${execStatus?.color}40`, color: execStatus?.color }}
                        >
                          {execStatus?.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </div>
        );
      })()}


      {historyOpen && (
        <TimelineHistoryModal project={historyOpen} onClose={() => setHistoryOpen(null)} />
      )}
    </AppLayout>
  );
};

// ==================== Timeline / Histórico Consolidado (Fev/2026) ====================
const EVENT_META = {
  created:                { color: '#39FF14', icon: CircleDot, label: 'Obra criada' },
  date_changed:           { color: '#00F0FF', icon: Calendar, label: 'Datas' },
  team_changed:           { color: '#E0FF00', icon: UsersIcon, label: 'Equipe' },
  status_changed:         { color: '#FF5E00', icon: CheckCircle2, label: 'Status' },
  billing_stage_changed:  { color: '#B8FF00', icon: DollarSign, label: 'Faturamento' },
  shutdown_info:          { color: '#E0FF00', icon: Zap, label: 'Desligamento' },
  cancel_reason:          { color: '#FF003C', icon: XCircle, label: 'Motivo cancelamento' },
  team_splits_changed:    { color: '#00F0FF', icon: UsersIcon, label: 'Split por equipe' },
  reschedule:             { color: '#FF5E00', icon: Calendar, label: 'Remanejamento' },
};

const renderEventValues = (ev) => {
  if (ev.event_type === 'date_changed') {
    const oldS = ev.old?.start || '—', newS = ev.new?.start || '—';
    const oldE = ev.old?.end || '', newE = ev.new?.end || '';
    return (
      <div className="text-xs text-zinc-300 font-mono">
        <span className="text-zinc-500">{oldS}{oldE && oldE !== oldS ? ` → ${oldE}` : ''}</span>
        <ArrowRight className="w-3 h-3 inline mx-1 text-[#E0FF00]" />
        <span className="text-white">{newS}{newE && newE !== newS ? ` → ${newE}` : ''}</span>
      </div>
    );
  }
  if (ev.event_type === 'team_changed') {
    const oldT = [ev.old?.team, ev.old?.additional].filter(Boolean).join(' + ') || '—';
    const newT = [ev.new?.team, ev.new?.additional].filter(Boolean).join(' + ') || '—';
    return (
      <div className="text-xs text-zinc-300">
        <span className="text-zinc-500">{oldT}</span>
        <ArrowRight className="w-3 h-3 inline mx-1 text-[#E0FF00]" />
        <span className="text-white">{newT}</span>
      </div>
    );
  }
  if (['status_changed', 'billing_stage_changed'].includes(ev.event_type)) {
    return (
      <div className="text-xs text-zinc-300 font-mono">
        <span className="text-zinc-500">{ev.old || '—'}</span>
        <ArrowRight className="w-3 h-3 inline mx-1 text-[#E0FF00]" />
        <span className="text-white">{ev.new || '—'}</span>
      </div>
    );
  }
  if (ev.event_type === 'team_splits_changed') {
    const n = Array.isArray(ev.new) ? ev.new.length : 0;
    return <div className="text-xs text-zinc-300">{n} equipe(s) no split de produção</div>;
  }
  if (ev.event_type === 'created') {
    return (
      <div className="text-xs text-zinc-300">
        Código: <span className="font-mono text-[#39FF14]">{ev.new?.project_code || '—'}</span>
        {ev.new?.team && <span> · Equipe: <span className="text-white">{ev.new.team}</span></span>}
      </div>
    );
  }
  if (['shutdown_info', 'cancel_reason'].includes(ev.event_type)) {
    return (
      <div className="text-xs text-zinc-300 italic">"{ev.new || ev.old || '—'}"</div>
    );
  }
  return null;
};

const TimelineHistoryModal = ({ project, onClose }) => {
  // Consolidar movement_history + reschedule_history (legado). movement_history já cobre tudo em obras novas.
  const events = useMemo(() => {
    const mv = (project.movement_history || []).map((h) => ({ ...h }));
    // Legado: reschedule_history antigos que não estão no movement_history
    (project.reschedule_history || []).forEach((r) => {
      const already = mv.some((m) => m.event_type === 'date_changed' && m.changed_at === r.changed_at);
      if (!already) {
        mv.push({
          event_type: 'reschedule',
          changed_at: r.changed_at,
          changed_by: r.changed_by || '',
          old: { start: (r.old_start || '').slice(0, 10), end: (r.old_end || '').slice(0, 10) },
          new: { start: (r.new_start || '').slice(0, 10), end: (r.new_end || '').slice(0, 10) },
          reason: r.reason || '',
          notes: '',
        });
      }
    });
    // Legado: billing_history entries que não vieram como movement_history
    (project.billing_history || []).forEach((b) => {
      const already = mv.some((m) => m.event_type === 'billing_stage_changed' && m.changed_at === b.changed_at);
      if (!already) {
        mv.push({
          event_type: 'billing_stage_changed',
          changed_at: b.changed_at,
          changed_by: b.changed_by || '',
          old: '',
          new: b.stage || '',
          reason: '',
          notes: b.notes || '',
        });
      }
    });
    return mv.sort((a, b) => (b.changed_at || '').localeCompare(a.changed_at || ''));
  }, [project]);

  return (
    <div data-testid="reschedule-history-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel rounded-2xl border border-[#E0FF00]/40 max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-[#E0FF00]/20 flex items-center justify-center">
            <History className="w-5 h-5 text-[#E0FF00]" />
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">Timeline · Histórico da Obra</h3>
            <p className="text-xs text-zinc-500">{project.name}{project.project_code ? ` · ${project.project_code}` : ''}</p>
          </div>
          <button data-testid="close-history-modal" onClick={onClose} className="ml-auto w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white">✕</button>
        </div>

        {events.length === 0 ? (
          <p className="text-center text-zinc-500 py-8 text-sm">Sem movimentações registradas.</p>
        ) : (
          <div data-testid="timeline-container" className="relative pl-6">
            <div className="absolute left-2 top-2 bottom-2 w-px bg-white/10" />
            {events.map((ev, i) => {
              const meta = EVENT_META[ev.event_type] || { color: '#94A3B8', icon: FileText, label: ev.event_type };
              const Icon = meta.icon;
              return (
                <div key={i} data-testid={`timeline-entry-${i}`} className="relative mb-4">
                  <div
                    className="absolute -left-6 top-1 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}80` }}
                  >
                    <Icon className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                  </div>
                  <div className="rounded-lg p-3 bg-white/[0.02] border border-white/10 hover:border-white/20 transition">
                    <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase"
                        style={{ background: `${meta.color}20`, borderColor: `${meta.color}60`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {ev.changed_at ? new Date(ev.changed_at).toLocaleString('pt-BR') : ''}
                      </span>
                    </div>
                    {renderEventValues(ev)}
                    {ev.reason && (
                      <p className="text-[10px] text-[#FF5E00] mt-1">
                        Motivo: <span className="font-bold uppercase">{ev.reason}</span>
                      </p>
                    )}
                    {ev.notes && (
                      <p className="text-[11px] text-zinc-400 mt-1 italic">"{ev.notes}"</p>
                    )}
                    {ev.changed_by && (
                      <p className="text-[10px] text-zinc-600 mt-1">por {ev.changed_by}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
};
