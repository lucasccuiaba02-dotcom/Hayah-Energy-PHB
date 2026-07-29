import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Search, Edit2, MapPin, Zap, Copy, Trash2 } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { ProjectDrawer } from '../components/ProjectDrawer';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS_LABEL, formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const BuscarObrasPage = () => {
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/projects`),
      axios.get(`${API}/teams`),
    ]).then(([p, t]) => {
      setProjects(p.data);
      setTeams(t.data);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    return projects.filter((p) => {
      if (q) {
        const haystack = [p.name, p.project_code, p.location, p.team_name, p.shutdown_info, p.tipo_servico].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (statusFilter && p.execution_status !== statusFilter) return false;
      if (teamFilter && p.team_id !== teamFilter && p.additional_team_id !== teamFilter) return false;
      return true;
    }).sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
  }, [projects, search, statusFilter, teamFilter]);

  const reload = async () => {
    const { data } = await axios.get(`${API}/projects`);
    setProjects(data);
  };

  const handleSave = async (data) => {
    if (editing) {
      await axios.put(`${API}/projects/${editing.id}`, data);
      toast.success('Obra atualizada!');
    } else {
      await axios.post(`${API}/projects`, data);
      toast.success('Obra cadastrada!');
    }
    await reload();
    setIsDrawerOpen(false);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir esta obra?')) return;
    try {
      await axios.delete(`${API}/projects/${id}`);
      toast.success('Obra excluída');
      reload();
    } catch { toast.error('Erro ao excluir'); }
  };

  const handleDuplicate = async (id) => {
    try {
      await axios.post(`${API}/projects/${id}/duplicate`);
      toast.success('Obra duplicada!');
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Erro ao duplicar'); }
  };

  return (
    <AppLayout title="Buscar Obras" subtitle="Encontre, edite e gerencie qualquer obra da carteira">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-5 h-5 text-[#E0FF00]" />
          <input
            data-testid="buscar-input"
            autoFocus
            type="text"
            placeholder="Buscar por código, nome, local, equipe, desligamento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent border-none text-white placeholder-zinc-600 focus:outline-none text-lg"
          />
          {search && (
            <button data-testid="buscar-clear" onClick={() => setSearch('')} className="text-xs text-zinc-500 hover:text-white">limpar</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            data-testid="buscar-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">Todos os status</option>
            {Object.entries(EXECUTION_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            data-testid="buscar-team-filter"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">Todas as equipes</option>
            {teams.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
          <span className="ml-auto text-xs text-zinc-500 self-center font-mono">
            {filtered.length} de {projects.length} obra{projects.length !== 1 ? 's' : ''}
          </span>
        </div>
      </motion.div>

      {loading ? (
        <p className="text-center text-zinc-500 py-8 text-sm">Carregando…</p>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <Search className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-400">Nenhuma obra encontrada.</p>
          <p className="text-zinc-600 text-sm mt-1">Tente ajustar sua busca ou filtros.</p>
        </div>
      ) : (
        <div data-testid="buscar-results" className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[10px] tracking-[0.15em] uppercase font-bold text-zinc-500">
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2">Obra</th>
                <th className="text-left px-4 py-2 hidden md:table-cell">Equipe</th>
                <th className="text-left px-4 py-2 hidden lg:table-cell">Local</th>
                <th className="text-left px-4 py-2">Data</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const execStatus = EXECUTION_STATUS_LABEL[p.execution_status];
                return (
                  <tr key={p.id} data-testid={`buscar-row-${p.id}`} className="border-b border-white/5 hover:bg-white/[0.03] text-xs">
                    <td className="px-4 py-3 font-mono text-[#E0FF00]">{p.project_code || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        <p className="text-white font-bold">{p.name}</p>
                        {p.requires_hot_line && <Zap className="w-3 h-3 text-[#FF5E00]" title="Linha viva" />}
                      </div>
                      <p className="text-[10px] text-zinc-500">{PROJECT_TYPE_LABEL[p.project_type]}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-zinc-300">
                      {p.team_name || '—'}
                      {p.additional_team_name && <span className="ml-1 text-[9px] text-[#00F0FF]">+{p.additional_team_name}</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-zinc-300">
                      {p.location ? (
                        <span className="inline-flex items-start gap-1"><MapPin className="w-3 h-3 mt-0.5 text-zinc-500" /><span className="line-clamp-1">{p.location}</span></span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-300">{(p.start_date || '').slice(0, 10) || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-white">{formatCurrency(p.programmed_value)}</td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                        style={{ backgroundColor: `${execStatus?.color}15`, borderColor: `${execStatus?.color}40`, color: execStatus?.color }}
                      >
                        {execStatus?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          data-testid={`buscar-edit-${p.id}`}
                          onClick={() => { setEditing(p); setIsDrawerOpen(true); }}
                          title="Editar"
                          className="w-7 h-7 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#00F0FF]"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          data-testid={`buscar-duplicate-${p.id}`}
                          onClick={() => handleDuplicate(p.id)}
                          title="Duplicar"
                          className="w-7 h-7 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#E0FF00]"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          data-testid={`buscar-delete-${p.id}`}
                          onClick={() => handleDelete(p.id)}
                          title="Excluir"
                          className="w-7 h-7 rounded-md bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C]"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProjectDrawer
        isOpen={isDrawerOpen}
        onClose={() => { setIsDrawerOpen(false); setEditing(null); }}
        onSave={handleSave}
        project={editing}
        teams={teams}
      />
    </AppLayout>
  );
};
