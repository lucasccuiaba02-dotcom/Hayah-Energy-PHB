import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export const ProjectDrawer = ({ isOpen, onClose, onSave, project, teams }) => {
  const [formData, setFormData] = useState({
    name: '',
    team_id: '',
    team_name: '',
    start_date: '',
    end_date: '',
    programmed_value: 0,
    daily_goal: 0,
    status: 'active',
    priority: 'medium',
    actual_value: 0,
  });

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        team_id: project.team_id || '',
        team_name: project.team_name || '',
        start_date: project.start_date ? project.start_date.split('T')[0] : '',
        end_date: project.end_date ? project.end_date.split('T')[0] : '',
        programmed_value: project.programmed_value || 0,
        daily_goal: project.daily_goal || 0,
        status: project.status || 'active',
        priority: project.priority || 'medium',
        actual_value: project.actual_value || 0,
      });
    } else {
      const today = new Date().toISOString().split('T')[0];
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setFormData({
        name: '',
        team_id: '',
        team_name: '',
        start_date: today,
        end_date: nextWeek,
        programmed_value: 0,
        daily_goal: 0,
        status: 'active',
        priority: 'medium',
        actual_value: 0,
      });
    }
  }, [project, isOpen]);

  const handleTeamChange = (teamId) => {
    const team = teams.find((t) => t.id === teamId);
    setFormData({
      ...formData,
      team_id: teamId,
      team_name: team ? team.name : '',
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...formData,
      programmed_value: parseFloat(formData.programmed_value) || 0,
      daily_goal: parseFloat(formData.daily_goal) || 0,
      actual_value: parseFloat(formData.actual_value) || 0,
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            data-testid="project-drawer"
            className="fixed right-0 top-0 h-screen w-full max-w-lg bg-[#09090b] border-l border-white/10 z-50 overflow-y-auto"
          >
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="font-heading font-black text-2xl tracking-tighter text-white">
                  {project ? 'Editar Projeto' : 'Novo Projeto'}
                </h2>
                <button
                  data-testid="close-drawer-button"
                  onClick={onClose}
                  className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Nome do Projeto
                  </label>
                  <input
                    data-testid="project-name-input"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#00F0FF] focus:outline-none transition-all"
                    placeholder="Ex: Reforma Escritório"
                  />
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Equipe
                  </label>
                  <select
                    data-testid="project-team-select"
                    value={formData.team_id}
                    onChange={(e) => handleTeamChange(e.target.value)}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all"
                  >
                    <option value="">Selecione uma equipe (opcional)</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Data Início
                    </label>
                    <input
                      data-testid="project-start-date"
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                      required
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Data Fim
                    </label>
                    <input
                      data-testid="project-end-date"
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                      required
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Valor Programado (R$)
                  </label>
                  <input
                    data-testid="project-programmed-input"
                    type="number"
                    step="0.01"
                    value={formData.programmed_value}
                    onChange={(e) => setFormData({ ...formData, programmed_value: e.target.value })}
                    required
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all font-mono"
                    placeholder="0,00"
                  />
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Meta Diária (R$)
                  </label>
                  <input
                    data-testid="project-daily-goal-input"
                    type="number"
                    step="0.01"
                    value={formData.daily_goal}
                    onChange={(e) => setFormData({ ...formData, daily_goal: e.target.value })}
                    required
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all font-mono"
                    placeholder="0,00"
                  />
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Valor Realizado (R$)
                  </label>
                  <input
                    data-testid="project-actual-input"
                    type="number"
                    step="0.01"
                    value={formData.actual_value}
                    onChange={(e) => setFormData({ ...formData, actual_value: e.target.value })}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all font-mono"
                    placeholder="0,00"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Status
                    </label>
                    <select
                      data-testid="project-status-select"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all"
                    >
                      <option value="active">Ativo</option>
                      <option value="paused">Pausado</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Prioridade
                    </label>
                    <select
                      data-testid="project-priority-select"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all"
                    >
                      <option value="high">Alta</option>
                      <option value="medium">Média</option>
                      <option value="low">Baixa</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    data-testid="cancel-project-button"
                    className="flex-1 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold py-3 rounded-full transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    data-testid="save-project-button"
                    className="flex-1 bg-[#00F0FF] hover:bg-[#00D8E6] text-black font-bold py-3 rounded-full transition-all transform hover:scale-[1.02]"
                  >
                    {project ? 'Salvar' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
