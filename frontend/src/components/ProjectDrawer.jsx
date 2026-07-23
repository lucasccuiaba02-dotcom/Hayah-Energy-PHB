import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, AlertTriangle } from 'lucide-react';

const PROJECT_TYPES = [
  { value: 'manutencao_preventiva', label: 'Manutenção Preventiva' },
  { value: 'manutencao_corretiva', label: 'Manutenção Corretiva' },
  { value: 'obra_nova', label: 'Obra Nova' },
  { value: 'ampliacao', label: 'Ampliação' },
  { value: 'substituicao', label: 'Substituição de Equipamento' },
  { value: 'poda', label: 'Poda de Vegetação' },
  { value: 'outro', label: 'Outro' },
];

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
    billing_value: 0,
    project_type: 'manutencao_preventiva',
    requires_hot_line: false,
    shutdown_info: '',
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
        billing_value: project.billing_value || 0,
        project_type: project.project_type || 'manutencao_preventiva',
        requires_hot_line: project.requires_hot_line || false,
        shutdown_info: project.shutdown_info || '',
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
        billing_value: 0,
        project_type: 'manutencao_preventiva',
        requires_hot_line: false,
        shutdown_info: '',
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
      billing_value: parseFloat(formData.billing_value) || 0,
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
                    placeholder="Ex: Manutenção Linha 138kV"
                  />
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Tipo do Projeto
                  </label>
                  <select
                    data-testid="project-type-select"
                    value={formData.project_type}
                    onChange={(e) => setFormData({ ...formData, project_type: e.target.value })}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all"
                  >
                    {PROJECT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
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

                <div className="grid grid-cols-2 gap-4">
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
                      Faturamento (R$)
                    </label>
                    <input
                      data-testid="project-billing-input"
                      type="number"
                      step="0.01"
                      value={formData.billing_value}
                      onChange={(e) => setFormData({ ...formData, billing_value: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#00F0FF] focus:outline-none transition-all font-mono"
                      placeholder="0,00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                      Produção (R$)
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
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Desligamento
                  </label>
                  <textarea
                    data-testid="project-shutdown-input"
                    value={formData.shutdown_info}
                    onChange={(e) => setFormData({ ...formData, shutdown_info: e.target.value })}
                    rows={3}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#00F0FF] focus:outline-none transition-all"
                    placeholder="Ex: Circuito Alimentador 05 - 08:00 às 17:00 - Sub. Central"
                  />
                </div>

                <div>
                  <label
                    htmlFor="hotline-toggle"
                    className="glass-panel rounded-lg p-4 flex items-center justify-between cursor-pointer hover:border-[#FF5E00]/40 transition-all border border-white/10"
                    style={{
                      borderColor: formData.requires_hot_line ? '#FF5E00' : undefined,
                      boxShadow: formData.requires_hot_line ? '0 0 20px rgba(255, 94, 0, 0.15)' : undefined,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{
                          backgroundColor: formData.requires_hot_line ? '#FF5E0020' : 'rgba(255,255,255,0.05)',
                        }}
                      >
                        <Zap
                          className="w-5 h-5"
                          style={{ color: formData.requires_hot_line ? '#FF5E00' : '#71717a' }}
                        />
                      </div>
                      <div>
                        <p className="text-white font-bold text-sm">Linha Viva</p>
                        <p className="text-xs text-zinc-500">Requer trabalho em linha energizada</p>
                      </div>
                    </div>
                    <input
                      id="hotline-toggle"
                      data-testid="project-hotline-toggle"
                      type="checkbox"
                      checked={formData.requires_hot_line}
                      onChange={(e) => setFormData({ ...formData, requires_hot_line: e.target.checked })}
                      className="w-5 h-5 rounded accent-[#FF5E00]"
                    />
                  </label>
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
