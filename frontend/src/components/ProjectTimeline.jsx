import React from 'react';
import { motion } from 'framer-motion';
import { format, parseISO, differenceInDays, min, max, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const ProjectTimeline = ({ projects, onEdit }) => {
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

  const getPriorityColor = (priority) => {
    if (priority === 'high') return '#FF003C';
    if (priority === 'medium') return '#FF5E00';
    return '#6366F1';
  };

  if (projects.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-12 text-center">
        <p className="text-zinc-400 text-lg">Nenhum projeto cadastrado ainda.</p>
        <p className="text-zinc-600 text-sm mt-2">Clique em "Novo Projeto" para começar.</p>
      </div>
    );
  }

  const allDates = projects.flatMap((p) => [parseISO(p.start_date), parseISO(p.end_date)]);
  const minDate = min(allDates);
  const maxDate = max(allDates);
  const days = eachDayOfInterval({ start: minDate, end: maxDate });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      data-testid="project-timeline-view"
      className="glass-panel rounded-2xl overflow-hidden"
    >
      <div className="overflow-x-auto">
        <div className="min-w-max">
          <div className="flex border-b border-white/5">
            <div className="w-64 flex-shrink-0 px-6 py-4 text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 border-r border-white/5">
              Projeto / Equipe
            </div>
            <div className="flex-1 flex">
              {days.map((day, i) => (
                <div key={i} className="flex-shrink-0 w-14 py-4 text-center border-r border-white/5">
                  <p className="text-xs font-mono text-zinc-500">{format(day, 'dd/MM', { locale: ptBR })}</p>
                  <p className="text-[10px] text-zinc-700 mt-1 uppercase">{format(day, 'EEE', { locale: ptBR })}</p>
                </div>
              ))}
            </div>
          </div>

          {projects.map((project, index) => {
            const startDate = parseISO(project.start_date);
            const endDate = parseISO(project.end_date);
            const offsetDays = differenceInDays(startDate, minDate);
            const durationDays = differenceInDays(endDate, startDate) + 1;
            const progressColor = getProgressColor(project);
            const priorityColor = getPriorityColor(project.priority);

            return (
              <motion.div
                key={project.id}
                data-testid={`timeline-row-${index}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex border-b border-white/5 hover:bg-white/[0.02] transition-colors"
              >
                <div className="w-64 flex-shrink-0 px-6 py-4 border-r border-white/5">
                  <p className="text-white font-medium text-sm truncate">{project.name}</p>
                  <p className="text-zinc-500 text-xs mt-1">{project.team_name || '-'}</p>
                  <p className="font-mono text-xs text-zinc-600 mt-1">
                    R$ {project.programmed_value.toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="flex-1 flex relative py-4" style={{ height: '80px' }}>
                  {days.map((_, i) => (
                    <div key={i} className="flex-shrink-0 w-14 border-r border-white/5"></div>
                  ))}
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${durationDays * 56 - 8}px` }}
                    transition={{ delay: 0.2 + index * 0.05, duration: 0.5 }}
                    onClick={() => onEdit(project)}
                    className="absolute top-1/2 -translate-y-1/2 h-12 rounded-full flex items-center px-4 cursor-pointer transition-transform hover:scale-[1.02]"
                    style={{
                      left: `${offsetDays * 56 + 4}px`,
                      backgroundColor: `${progressColor}20`,
                      border: `1px solid ${progressColor}60`,
                      boxShadow: `0 0 20px ${progressColor}30`,
                    }}
                  >
                    <div
                      className="w-2 h-2 rounded-full mr-2 animate-glow-pulse"
                      style={{ backgroundColor: progressColor, boxShadow: `0 0 8px ${progressColor}` }}
                    ></div>
                    <span className="text-xs font-bold truncate" style={{ color: progressColor }}>
                      {project.name}
                    </span>
                    <div
                      className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: priorityColor }}
                      title="Prioridade"
                    ></div>
                  </motion.div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-4 border-t border-white/5 flex flex-wrap gap-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#00F0FF', boxShadow: '0 0 8px #00F0FF' }}></div>
          <span className="text-xs text-zinc-400">Superando a meta</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#39FF14', boxShadow: '0 0 8px #39FF14' }}></div>
          <span className="text-xs text-zinc-400">No prazo</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FF003C', boxShadow: '0 0 8px #FF003C' }}></div>
          <span className="text-xs text-zinc-400">Atrasado</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-zinc-500 tracking-[0.2em] uppercase font-bold">Prioridade:</span>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#FF003C' }}></div>
            <span className="text-xs text-zinc-400">Alta</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#FF5E00' }}></div>
            <span className="text-xs text-zinc-400">Média</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6366F1' }}></div>
            <span className="text-xs text-zinc-400">Baixa</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
