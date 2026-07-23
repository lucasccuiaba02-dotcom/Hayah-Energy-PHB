import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Calendar, MapPin, Zap } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { ProjectDrawer } from '../components/ProjectDrawer';
import { ProjectFilters } from '../components/ProjectFilters';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS_LABEL, formatCurrency } from '../lib/constants';

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

  useEffect(() => {
    fetchData();
  }, []);

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
    try {
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
    } catch {
      toast.error('Erro ao salvar programação');
    }
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
    return projects.filter((p) => {
      if (filters.teamId && p.team_id !== filters.teamId) return false;
      const pStart = (p.start_date || '').slice(0, 10);
      const pEnd = (p.end_date || '').slice(0, 10);
      if (filters.startDate && pEnd && pEnd < filters.startDate) return false;
      if (filters.endDate && pStart && pStart > filters.endDate) return false;
      return true;
    });
  }, [projects, filters]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach((p) => {
      const date = (p.start_date || '').slice(0, 10) || 'Sem data';
      if (!map[date]) map[date] = [];
      map[date].push(p);
    });
    return Object.keys(map).sort().map((date) => ({ date, projects: map[date] }));
  }, [filtered]);

  return (
    <AppLayout
      title="Programação"
      subtitle="Matriz de obras programadas"
      actions={
        <button
          data-testid="add-programacao-button"
          onClick={() => { setEditing(null); setIsDrawerOpen(true); }}
          className="bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold px-6 py-2 rounded-full transition-all transform hover:scale-105 flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Programar Obra
        </button>
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

      <div data-testid="programacao-matrix" className="space-y-4">
        {grouped.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <p className="text-zinc-400 text-lg">Nenhuma obra programada.</p>
            <p className="text-zinc-600 text-sm mt-2">Clique em "Programar Obra" para começar.</p>
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
                      key={p.id}
                      data-testid={`prog-project-${p.id}`}
                      className="rounded-xl p-4 border relative overflow-hidden"
                      style={{
                        backgroundColor: `${bgColor}0D`,
                        borderColor: `${bgColor}40`,
                        boxShadow: `0 0 20px ${bgColor}20`,
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-white font-bold text-sm">{p.name}</h3>
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
                            {p.team_name && <span>• {p.team_name}</span>}
                          </div>
                        </div>
                        <div className="flex gap-1">
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
    </AppLayout>
  );
};
