import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { LayoutGrid, Calendar, Plus, LogOut, Users, Target, TrendingUp, Activity } from 'lucide-react';
import { ProjectTable } from '../components/ProjectTable';
import { ProjectTimeline } from '../components/ProjectTimeline';
import { ProjectDrawer } from '../components/ProjectDrawer';
import { TeamDrawer } from '../components/TeamDrawer';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const DashboardPage = () => {
  const { user, logout } = useAuth();
  const [viewMode, setViewMode] = useState('table');
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isProjectDrawerOpen, setIsProjectDrawerOpen] = useState(false);
  const [isTeamDrawerOpen, setIsTeamDrawerOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editingTeam, setEditingTeam] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [projectsRes, teamsRes, statsRes] = await Promise.allSettled([
        axios.get(`${API}/projects`, { withCredentials: true }),
        axios.get(`${API}/teams`, { withCredentials: true }),
        axios.get(`${API}/dashboard/stats`, { withCredentials: true }),
      ]);
      if (projectsRes.status === 'fulfilled') setProjects(projectsRes.value.data);
      if (teamsRes.status === 'fulfilled') setTeams(teamsRes.value.data);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (projectsRes.status === 'rejected' || teamsRes.status === 'rejected' || statsRes.status === 'rejected') {
        console.error('Some data failed to load');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handleProjectSave = async (projectData) => {
    try {
      if (editingProject) {
        await axios.put(`${API}/projects/${editingProject.id}`, projectData, {
          withCredentials: true,
        });
        toast.success('Projeto atualizado!');
      } else {
        await axios.post(`${API}/projects`, projectData, { withCredentials: true });
        toast.success('Projeto criado!');
      }
      fetchData();
      setIsProjectDrawerOpen(false);
      setEditingProject(null);
    } catch (error) {
      toast.error('Erro ao salvar projeto');
    }
  };

  const handleProjectDelete = async (projectId) => {
    try {
      await axios.delete(`${API}/projects/${projectId}`, { withCredentials: true });
      toast.success('Projeto excluído!');
      fetchData();
    } catch (error) {
      toast.error('Erro ao excluir projeto');
    }
  };

  const handleTeamSave = async (teamData, editingTeamArg) => {
    try {
      const target = editingTeamArg || editingTeam;
      if (target) {
        await axios.put(`${API}/teams/${target.id}`, teamData, {
          withCredentials: true,
        });
        toast.success('Equipe atualizada!');
      } else {
        await axios.post(`${API}/teams`, teamData, { withCredentials: true });
        toast.success('Equipe criada!');
      }
      fetchData();
      setEditingTeam(null);
    } catch (error) {
      toast.error('Erro ao salvar equipe');
    }
  };

  const handleTeamDelete = async (teamId) => {
    try {
      await axios.delete(`${API}/teams/${teamId}`, { withCredentials: true });
      toast.success('Equipe excluída!');
      fetchData();
    } catch (error) {
      toast.error('Erro ao excluir equipe');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#00F0FF] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-zinc-400">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="dashboard-page" className="min-h-screen bg-[#050505] pb-8">
      <div className="flex">
        <aside className="w-20 h-screen bg-[#09090b] border-r border-white/8 fixed left-0 top-0 flex flex-col items-center py-6 z-20">
          <div className="w-12 h-12 bg-gradient-to-br from-[#00F0FF] to-[#39FF14] rounded-xl mb-8 flex items-center justify-center font-heading font-black text-black text-xl">
            PM
          </div>

          <nav className="flex-1 flex flex-col gap-4">
            <button
              data-testid="sidebar-dashboard-button"
              className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[#00F0FF] hover:bg-white/10 transition-all"
              title="Dashboard"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button
              data-testid="sidebar-teams-button"
              onClick={() => setIsTeamDrawerOpen(true)}
              className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
              title="Equipes"
            >
              <Users className="w-5 h-5" />
            </button>
          </nav>

          <button
            data-testid="sidebar-logout-button"
            onClick={logout}
            className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C] hover:bg-white/10 transition-all"
            title="Sair"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </aside>

        <main className="flex-1 ml-20">
          <div className="border-b border-white/8 bg-[#09090b]/50 backdrop-blur-xl sticky top-0 z-10">
            <div className="px-8 py-4 flex items-center justify-between">
              <div>
                <h1 data-testid="dashboard-welcome" className="font-heading font-black text-2xl tracking-tighter text-white">
                  Olá, {user?.name}
                </h1>
                <p className="text-sm text-zinc-500">Visão estratégica dos seus projetos</p>
              </div>

              <div className="flex items-center gap-4">
                <div className="glass-panel rounded-full p-1 flex items-center gap-1">
                  <button
                    data-testid="view-toggle-table"
                    onClick={() => setViewMode('table')}
                    className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                      viewMode === 'table'
                        ? 'bg-[#00F0FF] text-black'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4 inline mr-2" />
                    Tabela
                  </button>
                  <button
                    data-testid="view-toggle-timeline"
                    onClick={() => setViewMode('timeline')}
                    className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                      viewMode === 'timeline'
                        ? 'bg-[#00F0FF] text-black'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Calendar className="w-4 h-4 inline mr-2" />
                    Timeline
                  </button>
                </div>

                <button
                  data-testid="add-project-button"
                  onClick={() => {
                    setEditingProject(null);
                    setIsProjectDrawerOpen(true);
                  }}
                  className="bg-[#39FF14] hover:bg-[#32E012] text-black font-bold px-6 py-2 rounded-full transition-all transform hover:scale-105 flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Novo Projeto
                </button>
              </div>
            </div>
          </div>

          <div className="px-8 py-6">
            {stats && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
              >
                <div data-testid="stat-card-projects" className="glass-panel rounded-xl p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-[#00F0FF]/10 rounded-lg flex items-center justify-center">
                      <Target className="w-5 h-5 text-[#00F0FF]" />
                    </div>
                  </div>
                  <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">
                    Total Projetos
                  </p>
                  <p className="font-mono text-3xl font-bold text-white">{stats.total_projects}</p>
                  <p className="text-xs text-zinc-600 mt-2">
                    {stats.active_projects} ativos
                  </p>
                </div>

                <div data-testid="stat-card-programmed" className="glass-panel rounded-xl p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-[#39FF14]/10 rounded-lg flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-[#39FF14]" />
                    </div>
                  </div>
                  <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">
                    Valor Programado
                  </p>
                  <p className="font-mono text-3xl font-bold text-white">
                    R$ {stats.total_programmed.toLocaleString('pt-BR')}
                  </p>
                </div>

                <div data-testid="stat-card-actual" className="glass-panel rounded-xl p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-[#E0FF00]/10 rounded-lg flex items-center justify-center">
                      <Activity className="w-5 h-5 text-[#E0FF00]" />
                    </div>
                  </div>
                  <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">
                    Valor Realizado
                  </p>
                  <p className="font-mono text-3xl font-bold text-white">
                    R$ {stats.total_actual.toLocaleString('pt-BR')}
                  </p>
                </div>

                <div data-testid="stat-card-performance" className="glass-panel rounded-xl p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-[#FF5E00]/10 rounded-lg flex items-center justify-center">
                      <Users className="w-5 h-5 text-[#FF5E00]" />
                    </div>
                  </div>
                  <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">
                    Performance
                  </p>
                  <p className="font-mono text-3xl font-bold text-white">
                    {stats.projects_on_track}/{stats.total_projects}
                  </p>
                  <p className="text-xs text-zinc-600 mt-2">projetos no prazo</p>
                </div>
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <AnimatePresence mode="wait">
                {viewMode === 'table' ? (
                  <ProjectTable
                    key="table"
                    projects={projects}
                    teams={teams}
                    onEdit={(project) => {
                      setEditingProject(project);
                      setIsProjectDrawerOpen(true);
                    }}
                    onDelete={handleProjectDelete}
                  />
                ) : (
                  <ProjectTimeline
                    key="timeline"
                    projects={projects}
                    onEdit={(project) => {
                      setEditingProject(project);
                      setIsProjectDrawerOpen(true);
                    }}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </main>
      </div>

      <ProjectDrawer
        isOpen={isProjectDrawerOpen}
        onClose={() => {
          setIsProjectDrawerOpen(false);
          setEditingProject(null);
        }}
        onSave={handleProjectSave}
        project={editingProject}
        teams={teams}
      />

      <TeamDrawer
        isOpen={isTeamDrawerOpen}
        onClose={() => {
          setIsTeamDrawerOpen(false);
          setEditingTeam(null);
        }}
        onSave={handleTeamSave}
        team={editingTeam}
        teams={teams}
        onEdit={(team) => setEditingTeam(team)}
        onDelete={handleTeamDelete}
      />
    </div>
  );
};