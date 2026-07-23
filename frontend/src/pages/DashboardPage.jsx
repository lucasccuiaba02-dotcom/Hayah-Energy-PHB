import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Target, TrendingUp, Activity, DollarSign, Users, Zap, Briefcase, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const DashboardPage = () => {
  const [stats, setStats] = useState(null);
  const [scheduleStats, setScheduleStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const results = await Promise.allSettled([
        axios.get(`${API}/dashboard/stats`),
        axios.get(`${API}/schedule/stats`),
      ]);
      if (results[0].status === 'fulfilled') setStats(results[0].value.data);
      if (results[1].status === 'fulfilled') setScheduleStats(results[1].value.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout title="Dashboard" subtitle="Visão geral da operação">
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8"
        >
          <div data-testid="stat-card-projects" className="glass-panel rounded-xl p-5">
            <div className="w-9 h-9 bg-[#00F0FF]/10 rounded-lg flex items-center justify-center mb-3">
              <Briefcase className="w-4 h-4 text-[#00F0FF]" />
            </div>
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Carteira</p>
            <p className="font-mono text-2xl font-bold text-white">{stats.total_projects}</p>
            <p className="text-xs text-zinc-600 mt-1">obras cadastradas</p>
          </div>
          <div data-testid="stat-card-programmed" className="glass-panel rounded-xl p-5">
            <div className="w-9 h-9 bg-[#39FF14]/10 rounded-lg flex items-center justify-center mb-3">
              <TrendingUp className="w-4 h-4 text-[#39FF14]" />
            </div>
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Programado</p>
            <p className="font-mono text-xl font-bold text-white">{formatCurrency(stats.total_programmed)}</p>
          </div>
          <div data-testid="stat-card-actual" className="glass-panel rounded-xl p-5">
            <div className="w-9 h-9 bg-[#E0FF00]/10 rounded-lg flex items-center justify-center mb-3">
              <Activity className="w-4 h-4 text-[#E0FF00]" />
            </div>
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Produção</p>
            <p className="font-mono text-xl font-bold text-white">{formatCurrency(stats.total_actual)}</p>
          </div>
          <div data-testid="stat-card-billing" className="glass-panel rounded-xl p-5">
            <div className="w-9 h-9 bg-[#FF5E00]/10 rounded-lg flex items-center justify-center mb-3">
              <DollarSign className="w-4 h-4 text-[#FF5E00]" />
            </div>
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Faturamento</p>
            <p className="font-mono text-xl font-bold text-white">{formatCurrency(stats.total_billing)}</p>
          </div>
          <div data-testid="stat-card-teams" className="glass-panel rounded-xl p-5">
            <div className="w-9 h-9 bg-[#6366F1]/10 rounded-lg flex items-center justify-center mb-3">
              <Users className="w-4 h-4 text-[#6366F1]" />
            </div>
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Equipes</p>
            <p className="font-mono text-2xl font-bold text-white">{stats.total_teams}</p>
          </div>
        </motion.div>
      )}

      {scheduleStats && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Programação</p>
              <h2 className="font-heading font-black text-2xl tracking-tighter text-white">Status de Execução</h2>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(scheduleStats.counts || {}).map(([label, count]) => (
              <div key={label} className="glass-panel rounded-xl p-5">
                <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">{label}</p>
                <p className="font-mono text-3xl font-bold text-white">{count}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <button
          data-testid="quick-carteira"
          onClick={() => navigate('/carteira')}
          className="glass-panel rounded-2xl p-6 text-left hover:border-[#00F0FF]/40 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-[#00F0FF]/10 border border-[#00F0FF]/40 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Briefcase className="w-6 h-6 text-[#00F0FF]" />
          </div>
          <h3 className="font-heading font-black text-lg tracking-tighter text-white">Carteira de Obras</h3>
          <p className="text-xs text-zinc-500 mt-2">Cadastre novos projetos com localidade, mão de obra e material</p>
        </button>

        <button
          data-testid="quick-programacao"
          onClick={() => navigate('/programacao')}
          className="glass-panel rounded-2xl p-6 text-left hover:border-[#E0FF00]/40 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-[#E0FF00]/10 border border-[#E0FF00]/40 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Calendar className="w-6 h-6 text-[#E0FF00]" />
          </div>
          <h3 className="font-heading font-black text-lg tracking-tighter text-white">Programação</h3>
          <p className="text-xs text-zinc-500 mt-2">Atribua data, equipe e envie notificação por e-mail</p>
        </button>

        <button
          data-testid="quick-analise"
          onClick={() => navigate('/analise')}
          className="glass-panel rounded-2xl p-6 text-left hover:border-[#39FF14]/40 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-[#39FF14]/10 border border-[#39FF14]/40 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <TrendingUp className="w-6 h-6 text-[#39FF14]" />
          </div>
          <h3 className="font-heading font-black text-lg tracking-tighter text-white">Análise</h3>
          <p className="text-xs text-zinc-500 mt-2">Produtividade, performance e ciclo mensal</p>
        </button>
      </motion.div>
    </AppLayout>
  );
};
