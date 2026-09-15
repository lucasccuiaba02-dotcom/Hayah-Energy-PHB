import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, MapPin, Calendar as CalIcon, Search, Copy, X, Camera } from 'lucide-react';
import { SearchBar } from '../components/SearchBar';
import { AppLayout } from '../components/AppLayout';
import { ProjectDrawer } from '../components/ProjectDrawer';
import { HScroller } from '../components/HScroller';
import { PROJECT_TYPE_LABEL, MATERIAL_STATUS_LABEL, formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const CarteiraPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || '');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  // Fev/2026 · Drill-down: filtros vindos por URL da aba Análise
  const [statusFilter, setStatusFilter] = useState(searchParams.get('filter') || ''); // '' | 'vencidas' | 'completed' | 'active'
  const [teamNameFilter, setTeamNameFilter] = useState(searchParams.get('team_name') || '');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [projRes, teamRes] = await Promise.all([
        axios.get(`${API}/projects`),
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

  const handleSave = async (data) => {
    if (editing) {
      await axios.put(`${API}/projects/${editing.id}`, data);
      toast.success('Projeto atualizado!');
    } else {
      await axios.post(`${API}/projects`, data);
      toast.success('Projeto cadastrado na carteira!');
    }
    fetchData();
    setIsDrawerOpen(false);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este projeto da carteira?')) return;
    try {
      await axios.delete(`${API}/projects/${id}`);
      toast.success('Projeto excluído!');
      fetchData();
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  const handleDuplicate = async (id) => {
    try {
      await axios.post(`${API}/projects/${id}/duplicate`);
      toast.success('Obra duplicada — abra e ajuste o código!');
      fetchData();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao duplicar');
    }
  };

  const filtered = useMemo(() => {
    const q = (search || '').toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const INACTIVE = ['executada', 'concluido', 'cancelado', 'suspenso'];
    return projects.filter((p) => {
      if (q && !(p.name || '').toLowerCase().includes(q) && !(p.location || '').toLowerCase().includes(q) && !(p.project_code || '').toLowerCase().includes(q)) {
        return false;
      }
      if (typeFilter && p.project_type !== typeFilter) return false;
      const ps = (p.start_date || '').slice(0, 10);
      if (startDateFilter && ps && ps < startDateFilter) return false;
      if (endDateFilter && ps && ps > endDateFilter) return false;
      // Drill-down filters (URL params)
      if (teamNameFilter && (p.team_name || '') !== teamNameFilter) return false;
      const st = p.execution_status || 'aguardando_programacao';
      const xd = (p.expiry_date || '').slice(0, 10);
      if (statusFilter === 'vencidas') {
        if (!(xd && xd < today && !INACTIVE.includes(st))) return false;
      } else if (statusFilter === 'vencendo') {
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        if (!(xd === tomorrow && !INACTIVE.includes(st))) return false;
      } else if (statusFilter === 'completed') {
        if (!['executada', 'concluido'].includes(st)) return false;
      } else if (statusFilter === 'active') {
        if (INACTIVE.includes(st)) return false;
      } else if (statusFilter === 'apta') {
        if (!['aguardando_programacao', 'a_reprogramar', 'em_execucao'].includes(st)) return false;
      } else if (statusFilter === 'nao_apta') {
        if (!['cancelado', 'suspenso'].includes(st)) return false;
      } else if (statusFilter === 'programadas') {
        if (st !== 'programado') return false;
      }
      return true;
    });
  }, [projects, search, typeFilter, startDateFilter, endDateFilter, statusFilter, teamNameFilter]);

  const clearDrillDown = () => {
    setStatusFilter('');
    setTeamNameFilter('');
    setTypeFilter('');
    const next = new URLSearchParams(searchParams);
    ['filter', 'type', 'team_name'].forEach((k) => next.delete(k));
    setSearchParams(next);
  };
  const hasDrillDown = statusFilter || teamNameFilter || (searchParams.get('type') && typeFilter);
  const drillDownLabel = useMemo(() => {
    const parts = [];
    if (statusFilter === 'vencidas') parts.push('Obras vencidas');
    else if (statusFilter === 'vencendo') parts.push('Vencendo amanhã');
    else if (statusFilter === 'completed') parts.push('Obras concluídas');
    else if (statusFilter === 'active') parts.push('Obras ativas');
    else if (statusFilter === 'apta') parts.push('Carteira Apta');
    else if (statusFilter === 'nao_apta') parts.push('Carteira Não Apta');
    else if (statusFilter === 'programadas') parts.push('Obras programadas');
    if (teamNameFilter) parts.push(`Equipe: ${teamNameFilter}`);
    if (typeFilter && searchParams.get('type')) parts.push(`Tipo: ${PROJECT_TYPE_LABEL[typeFilter] || typeFilter}`);
    return parts.join(' · ');
  }, [statusFilter, teamNameFilter, typeFilter, searchParams]);

  const vencidas = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const INACTIVE = ['executada', 'concluido', 'cancelado', 'suspenso'];
    return projects.filter((p) => p.expiry_date && p.expiry_date.slice(0, 10) < today && !INACTIVE.includes(p.execution_status || 'aguardando_programacao'));
  }, [projects]);

  const vencendoAmanha = useMemo(() => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const INACTIVE = ['executada', 'concluido', 'cancelado', 'suspenso'];
    return projects.filter((p) => (p.expiry_date || '').slice(0, 10) === tomorrow && !INACTIVE.includes(p.execution_status || 'aguardando_programacao'));
  }, [projects]);

  const totalLabor = filtered.reduce((s, p) => s + (p.labor_cost || 0), 0);
  const totalMaterial = filtered.reduce((s, p) => s + (p.material_cost || 0), 0);
  const totalProgrammed = filtered.reduce((s, p) => s + (p.programmed_value || 0), 0);
  const byType = useMemo(() => {
    const map = {};
    filtered.forEach((p) => {
      const label = PROJECT_TYPE_LABEL[p.project_type] || p.project_type;
      map[label] = (map[label] || 0) + 1;
    });
    return map;
  }, [filtered]);

  return (
    <AppLayout
      title="Carteira de Obras"
      subtitle="Cadastro completo dos projetos"
      actions={
        <button
          data-testid="add-carteira-button"
          onClick={() => {
            setEditing(null);
            setIsDrawerOpen(true);
          }}
          className="bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold px-6 py-2 rounded-full transition-all transform hover:scale-105 flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Nova Obra
        </button>
      }
    >
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div data-testid="carteira-stat-total" className="glass-panel rounded-xl p-5">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Total Obras</p>
          <p className="font-mono text-2xl font-bold text-white">{filtered.length}</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Mão de Obra</p>
          <p className="font-mono text-xl font-bold text-[#00F0FF]">{formatCurrency(totalLabor)}</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Material</p>
          <p className="font-mono text-xl font-bold text-[#FF5E00]">{formatCurrency(totalMaterial)}</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Total Programado</p>
          <p className="font-mono text-xl font-bold text-[#E0FF00]">{formatCurrency(totalProgrammed)}</p>
        </div>
      </motion.div>

      {(vencidas.length > 0 || vencendoAmanha.length > 0) && (
        <div data-testid="carteira-alerts" className="grid grid-cols-2 gap-3 mb-4">
          <div className="glass-panel rounded-xl p-4 border-l-4 border-[#FF003C]">
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF003C] mb-1">Obras Vencidas</p>
            <p className="font-mono text-3xl font-black text-white">{vencidas.length}</p>
          </div>
          <div className="glass-panel rounded-xl p-4 border-l-4 border-[#FF5E00]">
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF5E00] mb-1">Vencendo Amanhã</p>
            <p className="font-mono text-3xl font-black text-white">{vencendoAmanha.length}</p>
          </div>
        </div>
      )}

      {hasDrillDown && (
        <div
          data-testid="carteira-drilldown-banner"
          className="mb-4 flex items-center gap-3 flex-wrap glass-panel rounded-xl px-4 py-3 border border-[#00F0FF]/40 bg-[#00F0FF]/[0.04]"
        >
          <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#00F0FF]">Drill-down ativo</span>
          <span className="text-sm text-white font-bold">{drillDownLabel}</span>
          <span className="ml-auto text-[11px] text-zinc-400 font-mono">{filtered.length} obra(s)</span>
          <button
            data-testid="carteira-drilldown-clear"
            onClick={clearDrillDown}
            className="text-[11px] font-bold px-3 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-white inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Limpar
          </button>
        </div>
      )}

      <div className="glass-panel rounded-xl p-4 mb-6 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            data-testid="carteira-search"
            type="text"
            placeholder="Buscar por código, nome ou localidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-white placeholder-zinc-600 focus:outline-none text-sm"
          />
        </div>
        <select
          data-testid="carteira-type-filter"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(PROJECT_TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1">
          <CalIcon className="w-3.5 h-3.5 text-zinc-500" />
          <input
            data-testid="carteira-start-date"
            type="date"
            value={startDateFilter}
            onChange={(e) => setStartDateFilter(e.target.value)}
            className="bg-transparent text-xs text-white font-mono focus:outline-none"
            title="Data início a partir de"
          />
          <span className="text-zinc-600 text-xs">→</span>
          <input
            data-testid="carteira-end-date"
            type="date"
            value={endDateFilter}
            onChange={(e) => setEndDateFilter(e.target.value)}
            className="bg-transparent text-xs text-white font-mono focus:outline-none"
            title="Data início até"
          />
          {(startDateFilter || endDateFilter) && (
            <button
              data-testid="carteira-clear-date"
              onClick={() => { setStartDateFilter(''); setEndDateFilter(''); }}
              className="text-[10px] text-[#FF003C] ml-1"
              title="Limpar filtro de data"
            >×</button>
          )}
        </div>
      </div>

      {Object.keys(byType).length > 0 && (
        <div className="glass-panel rounded-xl p-4 mb-6">
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Distribuição por Tipo</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byType).map(([label, count]) => (
              <span key={label} className="px-3 py-1 rounded-full text-xs bg-white/5 border border-white/10 text-zinc-300">
                {label} <span className="font-mono text-[#E0FF00] ml-1">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel rounded-2xl overflow-hidden">
        <HScroller step={400} testid="carteira-hscroll">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Nome</th>
                <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Tipo</th>
                <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Localidade</th>
                <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Mão Obra</th>
                <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Material</th>
                <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Programado</th>
                <th className="text-center px-3 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Material</th>
                <th className="text-center px-3 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Prog.</th>
                <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-zinc-500">Nenhum projeto na carteira.</td>
                </tr>
              ) : (
                filtered.map((p, i) => {
                  const mStatus = MATERIAL_STATUS_LABEL[p.material_status];
                  return (
                    <tr key={p.id} data-testid={`carteira-row-${i}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-white text-sm">{p.name}</td>
                      <td className="px-4 py-3 text-xs text-zinc-400">{PROJECT_TYPE_LABEL[p.project_type] || p.project_type}</td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          {p.location && <MapPin className="w-3 h-3" />}
                          {p.location || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-[#00F0FF]">{formatCurrency(p.labor_cost)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-[#FF5E00]">{formatCurrency(p.material_cost)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-white">{formatCurrency(p.programmed_value)}</td>
                      <td className="px-3 py-3 text-center">
                        <span className="px-2 py-1 rounded-full text-[10px] font-bold border" style={{
                          backgroundColor: `${mStatus?.color}15`,
                          borderColor: `${mStatus?.color}40`,
                          color: mStatus?.color,
                        }}>
                          {mStatus?.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {p.is_scheduled ? (
                          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00]">
                            Programada
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-700">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/obras/${p.id}?camera=1`}
                            data-testid={`carteira-photo-${i}`}
                            title="Tirar foto (abre câmera do celular)"
                            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#E0FF00]"
                          >
                            <Camera className="w-4 h-4" />
                          </Link>
                          <button
                            data-testid={`duplicate-carteira-${i}`}
                            onClick={() => handleDuplicate(p.id)}
                            title="Duplicar obra"
                            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#E0FF00]"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            data-testid={`edit-carteira-${i}`}
                            onClick={() => { setEditing(p); setIsDrawerOpen(true); }}
                            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#00F0FF]"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            data-testid={`delete-carteira-${i}`}
                            onClick={() => handleDelete(p.id)}
                            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </HScroller>
      </div>

      <ProjectDrawer
        isOpen={isDrawerOpen}
        onClose={() => { setIsDrawerOpen(false); setEditing(null); }}
        onSave={handleSave}
        project={editing}
        teams={teams}
        defaultScheduled={false}
      />
    </AppLayout>
  );
};
