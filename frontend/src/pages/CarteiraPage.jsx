import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, MapPin, Calendar as CalIcon, Search } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { ProjectDrawer } from '../components/ProjectDrawer';
import { PROJECT_TYPE_LABEL, MATERIAL_STATUS_LABEL, formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const CarteiraPage = () => {
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

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
    try {
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
    } catch {
      toast.error('Erro ao salvar projeto');
    }
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

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.location.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (typeFilter && p.project_type !== typeFilter) return false;
      return true;
    });
  }, [projects, search, typeFilter]);

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

      <div className="glass-panel rounded-xl p-4 mb-6 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            data-testid="carteira-search"
            type="text"
            placeholder="Buscar por nome ou localidade..."
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
        <div className="overflow-x-auto">
          <table className="w-full">
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
        </div>
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
