import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { AlertTriangle, TrendingUp, Activity, DollarSign, Users, Briefcase, Calendar, BellRing, BellOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { formatCurrency } from '../lib/constants';
import { isPushSupported, currentPushStatus, subscribeToPush, unsubscribeFromPush } from '../lib/push';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const DashboardPage = () => {
  const [stats, setStats] = useState(null);
  const [scheduleStats, setScheduleStats] = useState(null);
  const [anexoAlerts, setAnexoAlerts] = useState([]);
  const [pushStatus, setPushStatus] = useState('unknown');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        axios.get(`${API}/dashboard/stats`),
        axios.get(`${API}/schedule/stats`),
        axios.get(`${API}/alerts/anexo-iv`),
      ]);
      if (results[0].status === 'fulfilled') setStats(results[0].value.data);
      if (results[1].status === 'fulfilled') setScheduleStats(results[1].value.data);
      if (results[2].status === 'fulfilled') setAnexoAlerts(results[2].value.data || []);
      if (await isPushSupported()) setPushStatus(await currentPushStatus());
      else setPushStatus('unsupported');
    })();
  }, []);

  const handleEnablePush = async () => {
    try {
      await subscribeToPush();
      setPushStatus('subscribed');
      toast.success('Notificações ativadas neste dispositivo!');
    } catch (err) {
      toast.error(err.message || 'Não foi possível ativar push');
    }
  };

  const handleDisablePush = async () => {
    await unsubscribeFromPush();
    setPushStatus('default');
    toast.info('Notificações desativadas neste dispositivo');
  };

  return (
    <AppLayout title="Dashboard" subtitle="Visão geral da operação">
      {anexoAlerts.length > 0 && (
        <motion.button
          data-testid="anexo-iv-banner"
          onClick={() => navigate('/programacao')}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.005 }}
          className="w-full text-left mb-6 rounded-2xl border-2 border-[#FF5E00] p-5 relative overflow-hidden group"
          style={{ background: 'linear-gradient(135deg, rgba(255,94,0,0.18), rgba(255,0,60,0.10))' }}
        >
          <div className="absolute inset-0 pointer-events-none">
            <span className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-[#FF5E00]/25 blur-3xl animate-pulse"></span>
          </div>
          <div className="relative flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#FF5E00]/25 border border-[#FF5E00] flex items-center justify-center flex-shrink-0 animate-pulse">
              <AlertTriangle className="w-7 h-7 text-[#FF5E00]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#FF5E00] mb-1">Anexo IV — Alerta D-2</p>
              <h3 className="font-heading font-black text-lg tracking-tight text-white leading-tight">
                {anexoAlerts.length} obra{anexoAlerts.length !== 1 ? 's' : ''} inicia{anexoAlerts.length === 1 ? '' : 'm'} em até 2 dias
              </h3>
              <p className="text-xs text-zinc-300 mt-1 truncate">
                {anexoAlerts.slice(0, 3).map((p) => p.project_code || p.name).join(' · ')}
                {anexoAlerts.length > 3 && ` · +${anexoAlerts.length - 3}`}
              </p>
              <p className="text-[11px] text-zinc-400 mt-1">Garanta equipe, acesso ao local e materiais. Clique para revisar a programação.</p>
            </div>
            <div className="hidden md:flex flex-col items-end gap-1">
              <span className="font-mono text-3xl font-black text-[#FF5E00]">{anexoAlerts.length}</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">urgente</span>
            </div>
          </div>
        </motion.button>
      )}

      {pushStatus !== 'unsupported' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between gap-3 mb-6 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {pushStatus === 'subscribed' ? (
              <BellRing className="w-5 h-5 text-[#E0FF00] flex-shrink-0" />
            ) : (
              <BellOff className="w-5 h-5 text-zinc-500 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white">
                {pushStatus === 'subscribed' ? 'Notificações ativas' : 'Ative notificações no celular'}
              </p>
              <p className="text-[11px] text-zinc-500 truncate">
                {pushStatus === 'subscribed'
                  ? 'Você receberá alertas de Anexo IV D-2 e agenda do dia seguinte'
                  : 'Receba lembretes D-2 para Anexo IV e programação diária direto no dispositivo'}
              </p>
            </div>
          </div>
          {pushStatus === 'subscribed' ? (
            <button
              data-testid="push-disable-btn"
              onClick={handleDisablePush}
              className="text-[11px] font-bold text-zinc-400 hover:text-white underline flex-shrink-0"
            >
              Desativar
            </button>
          ) : pushStatus === 'denied' ? (
            <span className="text-[11px] text-[#FF003C] flex-shrink-0">Bloqueado no navegador</span>
          ) : (
            <button
              data-testid="push-enable-btn"
              onClick={handleEnablePush}
              className="text-[11px] font-bold bg-[#E0FF00] text-black px-3 py-1.5 rounded-full hover:scale-105 transition-all flex-shrink-0"
            >
              Ativar
            </button>
          )}
        </motion.div>
      )}

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
