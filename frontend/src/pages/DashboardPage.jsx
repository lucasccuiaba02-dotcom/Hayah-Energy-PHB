import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { AlertTriangle, TrendingUp, Activity, DollarSign, Users, Briefcase, Calendar, BellRing, BellOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ProjectFilters } from '../components/ProjectFilters';
import { SearchBar } from '../components/SearchBar';
import { formatCurrency } from '../lib/constants';
import { isPushSupported, currentPushStatus, subscribeToPush, unsubscribeFromPush } from '../lib/push';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const DashboardPage = () => {
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [scheduleStats, setScheduleStats] = useState(null);
  const [anexoAlerts, setAnexoAlerts] = useState([]);
  const [pushStatus, setPushStatus] = useState('unknown');
  const [filters, setFilters] = useState({ startDate: '', endDate: '', teamId: '', minValue: '', maxValue: '' });
  const [search, setSearch] = useState('');
  const [kpis, setKpis] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        axios.get(`${API}/projects`),
        axios.get(`${API}/teams`),
        axios.get(`${API}/schedule/stats`),
        axios.get(`${API}/alerts/anexo-iv`),
        axios.get(`${API}/dashboard/kpis`),
      ]);
      if (results[0].status === 'fulfilled') setProjects(results[0].value.data);
      if (results[1].status === 'fulfilled') setTeams(results[1].value.data);
      if (results[2].status === 'fulfilled') setScheduleStats(results[2].value.data);
      if (results[3].status === 'fulfilled') setAnexoAlerts(results[3].value.data || []);
      if (results[4].status === 'fulfilled') setKpis(results[4].value.data);
      if (await isPushSupported()) setPushStatus(await currentPushStatus());
      else setPushStatus('unsupported');
    })();
  }, []);

  const filtered = useMemo(() => {
    const minV = parseFloat(filters.minValue);
    const maxV = parseFloat(filters.maxValue);
    const q = (search || '').toLowerCase().trim();
    return projects.filter((p) => {
      if (filters.teamId && p.team_id !== filters.teamId) return false;
      const ps = (p.start_date || '').slice(0, 10);
      const pe = (p.end_date || '').slice(0, 10);
      if (filters.startDate && pe && pe < filters.startDate) return false;
      if (filters.endDate && ps && ps > filters.endDate) return false;
      const v = p.programmed_value || 0;
      if (!isNaN(minV) && v < minV) return false;
      if (!isNaN(maxV) && v > maxV) return false;
      if (q && !((p.project_code || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [projects, filters, search]);

  const stats = useMemo(() => ({
    total_projects: filtered.length,
    total_programmed: filtered.reduce((s, p) => s + (p.programmed_value || 0), 0),
    total_actual: filtered.reduce((s, p) => s + (p.actual_value || 0), 0),
    total_billing: filtered.reduce((s, p) => s + (p.billing_value || 0), 0),
    total_teams: teams.length,
  }), [filtered, teams]);

  const filteredScheduleCounts = useMemo(() => {
    const map = {};
    filtered.filter((p) => p.is_scheduled).forEach((p) => {
      const k = p.execution_status || 'aguardando_programacao';
      map[k] = (map[k] || 0) + 1;
    });
    return map;
  }, [filtered]);

  const hasActiveFilters = filters.startDate || filters.endDate || filters.teamId || filters.minValue || filters.maxValue;

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
            <button data-testid="push-disable-btn" onClick={handleDisablePush} className="text-[11px] font-bold text-zinc-400 hover:text-white underline flex-shrink-0">Desativar</button>
          ) : pushStatus === 'denied' ? (
            <span className="text-[11px] text-[#FF003C] flex-shrink-0">Bloqueado no navegador</span>
          ) : (
            <button data-testid="push-enable-btn" onClick={handleEnablePush} className="text-[11px] font-bold bg-[#E0FF00] text-black px-3 py-1.5 rounded-full hover:scale-105 transition-all flex-shrink-0">Ativar</button>
          )}
        </motion.div>
      )}

      <div className="mb-4"><SearchBar value={search} onChange={setSearch} testid="dashboard-search" /></div>

      <ProjectFilters
        filters={filters}
        onChange={setFilters}
        teams={teams}
        onReset={() => setFilters({ startDate: '', endDate: '', teamId: '', minValue: '', maxValue: '' })}
        showValueFilter={true}
      />

      {hasActiveFilters && (
        <div className="mb-4 flex items-center gap-2 text-[11px]">
          <span className="px-2 py-1 rounded-full bg-[#E0FF00]/10 border border-[#E0FF00]/30 text-[#E0FF00] font-bold uppercase tracking-widest">Filtros ativos</span>
          <span className="text-zinc-400">Exibindo {filtered.length} de {projects.length} obras</span>
        </div>
      )}

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
          <p className="text-xs text-zinc-600 mt-1">obras {hasActiveFilters ? 'filtradas' : 'cadastradas'}</p>
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

      {kpis && (
        <>
          <div data-testid="kpi-critical-row" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <button onClick={() => navigate('/carteira?filter=vencidas')} className="glass-panel rounded-xl p-4 text-left border-l-4 border-[#FF003C] hover:border-[#FF003C]">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF003C] mb-1">Vencidas</p>
              <p className="font-mono text-3xl font-black text-white">{kpis.counts.vencidas}</p>
              <p className="text-[10px] text-zinc-500 mt-1">passaram do prazo</p>
            </button>
            <button onClick={() => navigate('/carteira?filter=vencendo')} className="glass-panel rounded-xl p-4 text-left border-l-4 border-[#FF5E00]">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF5E00] mb-1">Vencendo Amanhã</p>
              <p className="font-mono text-3xl font-black text-white">{kpis.counts.vencendo_amanha}</p>
              <p className="text-[10px] text-zinc-500 mt-1">agenda apertada</p>
            </button>
            <div className="glass-panel rounded-xl p-4 border-l-4 border-[#E0FF00]">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#E0FF00] mb-1">Em Andamento</p>
              <p className="font-mono text-3xl font-black text-white">{kpis.counts.em_andamento}</p>
              <p className="text-[10px] text-zinc-500 mt-1">programado/em execução</p>
            </div>
            <div className="glass-panel rounded-xl p-4 border-l-4 border-[#39FF14]">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#39FF14] mb-1">No Prazo</p>
              <p className="font-mono text-3xl font-black text-white">{kpis.counts.no_prazo}</p>
              <p className="text-[10px] text-zinc-500 mt-1">dentro do combinado</p>
            </div>
          </div>

          <div data-testid="kpi-financial-row" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="glass-panel rounded-xl p-4">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">% Conclusão</p>
              <p className="font-mono text-2xl font-bold text-[#39FF14]">{kpis.financeiro.perc_conclusao}%</p>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Valor Faturado</p>
              <p className="font-mono text-lg font-bold text-white">{formatCurrency(kpis.financeiro.valor_faturado)}</p>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Pendente Faturamento</p>
              <p className="font-mono text-lg font-bold text-[#FF5E00]">{formatCurrency(kpis.financeiro.valor_pendente_faturamento)}</p>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Receita Mês (prev./real.)</p>
              <p className="font-mono text-xs text-zinc-400"><span className="text-white text-sm font-bold">{formatCurrency(kpis.financeiro.receita_realizada)}</span> / {formatCurrency(kpis.financeiro.receita_prevista_mes)}</p>
              <div className="mt-1 h-1 rounded bg-white/5 overflow-hidden">
                <div className="h-full bg-[#39FF14]" style={{ width: `${Math.min(100, (kpis.financeiro.receita_realizada / Math.max(1, kpis.financeiro.receita_prevista_mes)) * 100).toFixed(0)}%` }}></div>
              </div>
            </div>
          </div>

          <div data-testid="kpi-operational-row" className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
            {[
              ['Postes', kpis.operacional.postes],
              ['Trafos', kpis.operacional.transformadores],
              ['Km Rede', kpis.operacional.km_rede],
              ['Ligações', kpis.operacional.ligacoes_novas],
              ['Religações', kpis.operacional.religacoes],
              ['Desligamentos', kpis.operacional.desligamentos],
              ['Concluídas Mês', kpis.counts.concluidas_mes],
              ['Dias Adiantados', kpis.operacional.dias_adiantados],
            ].map(([label, value]) => (
              <div key={label} className="glass-panel rounded-xl p-3">
                <p className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 mb-1">{label}</p>
                <p className="font-mono text-xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>

          <div data-testid="kpi-tempo-medio" className="glass-panel rounded-2xl p-4 mb-6">
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Tempo Médio (dias)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['Recebimento → Programação', kpis.tempo_medio.recebimento_programacao, '#00F0FF'],
                ['Programação → Execução', kpis.tempo_medio.programacao_execucao, '#E0FF00'],
                ['Execução → Fechamento', kpis.tempo_medio.execucao_fechamento, '#39FF14'],
                ['Fechamento → Faturamento', kpis.tempo_medio.fechamento_faturamento, '#FF5E00'],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-lg p-3 bg-white/[0.02] border-l-2" style={{ borderColor: color }}>
                  <p className="text-[10px] text-zinc-400">{label}</p>
                  <p className="font-mono text-xl font-bold" style={{ color }}>{value}<span className="text-xs text-zinc-500 ml-1">d</span></p>
                </div>
              ))}
            </div>
          </div>

          {kpis.vencidas.length > 0 && (
            <div data-testid="kpi-vencidas-list" className="glass-panel rounded-2xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#FF003C]" />
                <h3 className="font-heading font-black text-lg tracking-tighter text-white">Obras Vencidas</h3>
                <span className="text-xs text-zinc-500">({kpis.vencidas.length})</span>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {kpis.vencidas.map((p) => (
                  <button key={p.id} onClick={() => navigate(`/projeto/${p.id}`)} className="w-full text-left flex items-center gap-3 rounded-lg p-2 bg-[#FF003C]/5 border border-[#FF003C]/20 hover:bg-[#FF003C]/10 transition">
                    <span className="font-mono text-[10px] text-[#FF003C]">{p.project_code || '—'}</span>
                    <span className="text-xs text-white flex-1 truncate">{p.name}</span>
                    <span className="text-[10px] text-zinc-500">venceu {(p.end_date || '').slice(0, 10)}</span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-white/5 text-zinc-400">
                      programada {(p.reschedule_history?.length || 0) + 1}x
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

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
          {Object.entries(hasActiveFilters ? filteredScheduleCounts : (scheduleStats?.counts || {})).map(([label, count]) => (
            <div key={label} className="glass-panel rounded-xl p-5">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">{label.replace(/_/g, ' ')}</p>
              <p className="font-mono text-3xl font-bold text-white">{count}</p>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <button data-testid="quick-carteira" onClick={() => navigate('/carteira')} className="glass-panel rounded-2xl p-6 text-left hover:border-[#00F0FF]/40 transition-all group">
          <div className="w-12 h-12 rounded-xl bg-[#00F0FF]/10 border border-[#00F0FF]/40 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Briefcase className="w-6 h-6 text-[#00F0FF]" />
          </div>
          <h3 className="font-heading font-black text-lg tracking-tighter text-white">Carteira de Obras</h3>
          <p className="text-xs text-zinc-500 mt-2">Cadastre novos projetos com localidade, mão de obra e material</p>
        </button>
        <button data-testid="quick-programacao" onClick={() => navigate('/programacao')} className="glass-panel rounded-2xl p-6 text-left hover:border-[#E0FF00]/40 transition-all group">
          <div className="w-12 h-12 rounded-xl bg-[#E0FF00]/10 border border-[#E0FF00]/40 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Calendar className="w-6 h-6 text-[#E0FF00]" />
          </div>
          <h3 className="font-heading font-black text-lg tracking-tighter text-white">Programação</h3>
          <p className="text-xs text-zinc-500 mt-2">Atribua data, equipe e envie notificação por e-mail</p>
        </button>
        <button data-testid="quick-analise" onClick={() => navigate('/analise')} className="glass-panel rounded-2xl p-6 text-left hover:border-[#39FF14]/40 transition-all group">
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
