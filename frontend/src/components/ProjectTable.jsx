import React from 'react';
import { motion } from 'framer-motion';
import { Edit2, Trash2, Zap, AlertCircle } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const PROJECT_TYPE_LABELS = {
  manutencao_preventiva: 'Manut. Preventiva',
  manutencao_corretiva: 'Manut. Corretiva',
  obra_nova: 'Obra Nova',
  ampliacao: 'Ampliação',
  substituicao: 'Substituição',
  poda: 'Poda',
  outro: 'Outro',
};

export const ProjectTable = ({ projects, teams, onEdit, onDelete }) => {
  const getProgressColor = (project) => {
    const startDate = parseISO(project.start_date);
    const today = new Date();
    const daysElapsed = Math.max(differenceInDays(today, startDate) + 1, 1);
    const expectedValue = project.daily_goal * daysElapsed;
    const actualValue = project.actual_value || 0;

    if (actualValue >= expectedValue * 1.1) return '#00F0FF';
    if (actualValue >= expectedValue) return '#39FF14';
    return '#FF003C';
  };

  const getStatusColor = (status) => (status === 'active' ? '#E0FF00' : '#94A3B8');

  const getPriorityColor = (priority) => {
    if (priority === 'high') return '#FF003C';
    if (priority === 'medium') return '#FF5E00';
    return '#6366F1';
  };

  const getPriorityLabel = (priority) => {
    if (priority === 'high') return 'Alta';
    if (priority === 'medium') return 'Média';
    return 'Baixa';
  };

  const getStatusLabel = (status) => (status === 'active' ? 'Ativo' : 'Pausado');

  if (projects.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-12 text-center">
        <p className="text-zinc-400 text-lg">Nenhum projeto cadastrado.</p>
        <p className="text-zinc-600 text-sm mt-2">Clique em "Novo Projeto" para começar.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      data-testid="project-table-view"
      className="glass-panel rounded-2xl overflow-hidden"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Projeto
              </th>
              <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Tipo
              </th>
              <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Equipe
              </th>
              <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Período
              </th>
              <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Programado
              </th>
              <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Meta/dia
              </th>
              <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Produção
              </th>
              <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Faturamento
              </th>
              <th className="text-left px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Desligamento
              </th>
              <th className="text-center px-3 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                LV
              </th>
              <th className="text-center px-3 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Status
              </th>
              <th className="text-center px-3 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Prior.
              </th>
              <th className="text-center px-3 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Meta
              </th>
              <th className="text-right px-4 py-3 text-xs tracking-[0.15em] uppercase font-bold text-zinc-500">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, index) => {
              const progressColor = getProgressColor(project);
              const statusColor = getStatusColor(project.status);
              const priorityColor = getPriorityColor(project.priority);

              return (
                <motion.tr
                  key={project.id}
                  data-testid={`project-row-${index}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.03 }}
                  className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3">
                    <p className="text-white font-medium text-sm">{project.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-400">
                      {PROJECT_TYPE_LABELS[project.project_type] || project.project_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-zinc-400 text-sm">{project.team_name || '-'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-zinc-300 whitespace-nowrap">
                      {format(parseISO(project.start_date), 'dd/MM/yy', { locale: ptBR })}
                      {' → '}
                      {format(parseISO(project.end_date), 'dd/MM/yy', { locale: ptBR })}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-mono text-sm text-white font-medium">
                      R$ {project.programmed_value.toLocaleString('pt-BR')}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-mono text-sm text-zinc-300">
                      R$ {project.daily_goal.toLocaleString('pt-BR')}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-mono text-sm text-white font-medium">
                      R$ {(project.actual_value || 0).toLocaleString('pt-BR')}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-mono text-sm text-[#FF5E00] font-medium">
                      R$ {(project.billing_value || 0).toLocaleString('pt-BR')}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {project.shutdown_info ? (
                      <div
                        className="text-xs text-zinc-300 max-w-[200px] truncate flex items-center gap-1"
                        title={project.shutdown_info}
                      >
                        <AlertCircle className="w-3 h-3 text-[#E0FF00] flex-shrink-0" />
                        {project.shutdown_info}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-700">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-center">
                      {project.requires_hot_line ? (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center"
                          style={{
                            backgroundColor: '#FF5E0020',
                            border: '1px solid #FF5E00',
                            boxShadow: '0 0 10px #FF5E0040',
                          }}
                          title="Linha Viva"
                        >
                          <Zap className="w-4 h-4 text-[#FF5E00]" />
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-700">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-center">
                      <span
                        className="px-2 py-1 rounded-full text-[10px] font-bold border"
                        style={{
                          backgroundColor: `${statusColor}15`,
                          borderColor: `${statusColor}40`,
                          color: statusColor,
                        }}
                      >
                        {getStatusLabel(project.status)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-center">
                      <span
                        className="px-2 py-1 rounded-full text-[10px] font-bold border"
                        style={{
                          backgroundColor: `${priorityColor}15`,
                          borderColor: `${priorityColor}40`,
                          color: priorityColor,
                        }}
                      >
                        {getPriorityLabel(project.priority)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-center">
                      <div
                        className="w-3 h-3 rounded-full animate-glow-pulse"
                        style={{
                          backgroundColor: progressColor,
                          boxShadow: `0 0 12px ${progressColor}60`,
                        }}
                        title="Progresso da meta diária"
                      ></div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        data-testid={`edit-project-${index}`}
                        onClick={() => onEdit(project)}
                        className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#00F0FF] hover:bg-white/10 transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        data-testid={`delete-project-${index}`}
                        onClick={() => {
                          if (window.confirm('Excluir este projeto?')) {
                            onDelete(project.id);
                          }
                        }}
                        className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C] hover:bg-white/10 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};
