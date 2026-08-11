import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { AppLayout } from '../components/AppLayout';
import { ProjectFilters } from '../components/ProjectFilters';
import { FileSpreadsheet, Download, TrendingUp, Briefcase, Activity, DollarSign, Mail, Users, CalendarX, TrendingDown, ClipboardCheck } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const REPORTS = [
  { key: 'programacao', title: 'Programação', description: 'Obras programadas no período selecionado', icon: Briefcase, color: '#E0FF00', extra: false },
  { key: 'carteira', title: 'Carteira de Obras', description: 'Todas as obras cadastradas na carteira', icon: FileSpreadsheet, color: '#00F0FF', extra: false },
  { key: 'producao', title: 'Produção', description: 'Produção realizada por equipe/tipo', icon: Activity, color: '#39FF14', extra: false },
  { key: 'faturamento', title: 'Faturamento', description: 'Faturamento consolidado do ciclo', icon: DollarSign, color: '#FF5E00', extra: false },
];

const EXTRA_REPORTS = [
  { key: 'teams', title: 'Equipes', description: 'Produção e financeiro por equipe (obras, valor, % pago)', icon: Users, color: '#A855F7', endpoint: '/reports/teams', filename: 'rel_equipes' },
  { key: 'unavailability', title: 'Indisponibilidade', description: 'Registros de indisponibilidade de equipes (dia, motivo)', icon: CalendarX, color: '#00F0FF', endpoint: '/reports/unavailability', filename: 'rel_indisponibilidade' },
  { key: 'unproductivity', title: 'Improdutividade', description: 'Horas perdidas por motivo operacional (chuva, quebra, etc.)', icon: TrendingDown, color: '#FF5E00', endpoint: '/reports/unproductivity', filename: 'rel_improdutividade' },
  { key: 'returns', title: 'Retorno da Programação', description: 'Executadas · A reprogramar · Motivos de cancelamento', icon: ClipboardCheck, color: '#39FF14', endpoint: '/reports/returns', filename: 'rel_retorno' },
];

export const RelatoriosPage = () => {
  const [teams, setTeams] = useState([]);
  const [filters, setFilters] = useState({ startDate: '', endDate: '', teamId: '' });
  const [downloading, setDownloading] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    axios.get(`${API}/teams`).then(({ data }) => setTeams(data));
  }, []);

  const downloadReport = async (reportKey) => {
    setDownloading(reportKey);
    try {
      const params = new URLSearchParams();
      params.append('report_type', reportKey);
      if (filters.startDate) params.append('start_date', filters.startDate);
      if (filters.endDate) params.append('end_date', filters.endDate);
      if (filters.teamId) params.append('team_id', filters.teamId);

      const response = await axios.get(`${API}/reports/excel?${params.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hayah_${reportKey}_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Relatório de ${reportKey} baixado!`);
    } catch (err) {
      toast.error('Erro ao gerar relatório');
    } finally {
      setDownloading('');
    }
  };

  const downloadExtraReport = async (r) => {
    setDownloading(r.key);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('start', filters.startDate);
      if (filters.endDate) params.append('end', filters.endDate);
      const response = await axios.get(`${API}${r.endpoint}?${params.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.filename}_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Relatório de ${r.title} baixado!`);
    } catch (err) {
      toast.error('Erro ao gerar relatório');
    } finally {
      setDownloading('');
    }
  };

  const triggerTomorrowEmail = async () => {
    setSendingEmail(true);
    try {
      await axios.post(`${API}/schedule/notify-tomorrow`);
      toast.success('E-mail de programação do dia seguinte disparado!');
    } catch {
      toast.error('Erro ao disparar e-mail');
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <AppLayout title="Relatórios" subtitle="Extração de dados em Excel">
      <ProjectFilters
        filters={filters}
        onChange={setFilters}
        teams={teams}
        onReset={() => setFilters({ startDate: '', endDate: '', teamId: '' })}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"
      >
        {REPORTS.map((r) => (
          <div
            key={r.key}
            data-testid={`report-card-${r.key}`}
            className="glass-panel rounded-2xl p-6 flex items-center justify-between hover:border-white/20 transition-all"
            style={{
              borderColor: `${r.color}20`,
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${r.color}15`, border: `1px solid ${r.color}40` }}
              >
                <r.icon className="w-6 h-6" style={{ color: r.color }} />
              </div>
              <div>
                <h3 className="font-heading font-black text-xl tracking-tighter text-white">
                  {r.title}
                </h3>
                <p className="text-xs text-zinc-500 mt-1">{r.description}</p>
              </div>
            </div>
            <button
              data-testid={`download-${r.key}`}
              onClick={() => downloadReport(r.key)}
              disabled={downloading === r.key}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all transform hover:scale-105 disabled:opacity-50"
              style={{ backgroundColor: r.color, color: '#000' }}
            >
              <Download className="w-4 h-4" />
              {downloading === r.key ? 'Baixando...' : 'Excel'}
            </button>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="mb-6"
      >
        <div className="mb-3 flex items-center gap-2">
          <p className="text-[11px] tracking-[0.25em] uppercase font-bold text-zinc-500">Relatórios Operacionais (CSV)</p>
          <div className="flex-1 h-px bg-white/5" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {EXTRA_REPORTS.map((r) => (
            <div
              key={r.key}
              data-testid={`report-card-${r.key}`}
              className="glass-panel rounded-2xl p-6 flex items-center justify-between hover:border-white/20 transition-all"
              style={{ borderColor: `${r.color}20` }}
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${r.color}15`, border: `1px solid ${r.color}40` }}>
                  <r.icon className="w-6 h-6" style={{ color: r.color }} />
                </div>
                <div>
                  <h3 className="font-heading font-black text-xl tracking-tighter text-white">{r.title}</h3>
                  <p className="text-xs text-zinc-500 mt-1">{r.description}</p>
                </div>
              </div>
              <button
                data-testid={`download-${r.key}`}
                onClick={() => downloadExtraReport(r)}
                disabled={downloading === r.key}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all transform hover:scale-105 disabled:opacity-50"
                style={{ backgroundColor: r.color, color: '#000' }}
              >
                <Download className="w-4 h-4" />
                {downloading === r.key ? 'Baixando...' : 'CSV'}
              </button>
            </div>
          ))}
        </div>
      </motion.div>


      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-panel rounded-2xl p-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#00F0FF]/15 border border-[#00F0FF]/40">
              <Mail className="w-6 h-6 text-[#00F0FF]" />
            </div>
            <div>
              <h3 className="font-heading font-black text-xl tracking-tighter text-white">
                Notificação de Amanhã
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Disparar manualmente o e-mail com programação do dia seguinte (envio automático diário às 18h)
              </p>
            </div>
          </div>
          <button
            data-testid="trigger-tomorrow-email"
            onClick={triggerTomorrowEmail}
            disabled={sendingEmail}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-[#00F0FF] text-black transition-all transform hover:scale-105 disabled:opacity-50"
          >
            <Mail className="w-4 h-4" />
            {sendingEmail ? 'Enviando...' : 'Disparar Agora'}
          </button>
        </div>
      </motion.div>
    </AppLayout>
  );
};
