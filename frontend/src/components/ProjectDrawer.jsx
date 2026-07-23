import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, MapPin, DollarSign } from 'lucide-react';
import { PROJECT_TYPES, EXECUTION_STATUS, MATERIAL_STATUS } from '../lib/constants';

export const ProjectDrawer = ({ isOpen, onClose, onSave, project, teams, defaultScheduled = false }) => {
  const initialState = {
    name: '',
    project_type: 'anexo_iv',
    location: '',
    labor_cost: 0,
    material_cost: 0,
    programmed_value: 0,
    billing_value: 0,
    daily_goal: 0,
    actual_value: 0,
    team_id: '',
    team_name: '',
    start_date: '',
    end_date: '',
    priority: 'medium',
    requires_hot_line: false,
    shutdown_info: '',
    material_status: 'pending',
    execution_status: 'aguardando_inicio',
    is_scheduled: defaultScheduled,
  };

  const [formData, setFormData] = useState(initialState);
  const isScheduling = formData.is_scheduled;

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        project_type: project.project_type || 'anexo_iv',
        location: project.location || '',
        labor_cost: project.labor_cost || 0,
        material_cost: project.material_cost || 0,
        programmed_value: project.programmed_value || 0,
        billing_value: project.billing_value || 0,
        daily_goal: project.daily_goal || 0,
        actual_value: project.actual_value || 0,
        team_id: project.team_id || '',
        team_name: project.team_name || '',
        start_date: project.start_date ? project.start_date.split('T')[0] : '',
        end_date: project.end_date ? project.end_date.split('T')[0] : '',
        priority: project.priority || 'medium',
        requires_hot_line: project.requires_hot_line || false,
        shutdown_info: project.shutdown_info || '',
        material_status: project.material_status || 'pending',
        execution_status: project.execution_status || 'aguardando_inicio',
        is_scheduled: project.is_scheduled || false,
      });
    } else {
      setFormData({ ...initialState, is_scheduled: defaultScheduled });
    }
  }, [project, isOpen, defaultScheduled]);

  const handleTeamChange = (teamId) => {
    const team = teams.find((t) => t.id === teamId);
    setFormData({ ...formData, team_id: teamId, team_name: team ? team.name : '' });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...formData,
      labor_cost: parseFloat(formData.labor_cost) || 0,
      material_cost: parseFloat(formData.material_cost) || 0,
      programmed_value: parseFloat(formData.programmed_value) || 0,
      billing_value: parseFloat(formData.billing_value) || 0,
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
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="font-heading font-black text-2xl tracking-tighter text-white">
                    {project ? 'Editar Projeto' : isScheduling ? 'Programar Projeto' : 'Nova Obra'}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-1">
                    {isScheduling ? 'Atribua data e equipe' : 'Cadastro na carteira'}
                  </p>
                </div>
                <button
                  data-testid="close-drawer-button"
                  onClick={onClose}
                  className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Toggle scheduled */}
              <div className="mb-6 flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10">
                <label className="flex items-center gap-3 cursor-pointer w-full">
                  <input
                    data-testid="project-is-scheduled-toggle"
                    type="checkbox"
                    checked={formData.is_scheduled}
                    onChange={(e) => setFormData({ ...formData, is_scheduled: e.target.checked })}
                    className="w-5 h-5 accent-[#E0FF00]"
                  />
                  <div>
                    <p className="text-white font-bold text-sm">Programar obra?</p>
                    <p className="text-xs text-zinc-500">Marque para atribuir data, equipe e disparar notificação</p>
                  </div>
                </label>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
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
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none transition-all"
                    placeholder="Ex: Extensão Rede BT Rio Branco"
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
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all"
                  >
                    {PROJECT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    <MapPin className="w-3 h-3 inline mr-1" /> Localidade
                  </label>
                  <input
                    data-testid="project-location-input"
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none transition-all"
                    placeholder="Ex: Rua X, Bairro Y - Cidade/UF"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Mão de Obra (R$)
                    </label>
                    <input
                      data-testid="project-labor-input"
                      type="number"
                      step="0.01"
                      value={formData.labor_cost}
                      onChange={(e) => setFormData({ ...formData, labor_cost: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Material (R$)
                    </label>
                    <input
                      data-testid="project-material-input"
                      type="number"
                      step="0.01"
                      value={formData.material_cost}
                      onChange={(e) => setFormData({ ...formData, material_cost: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
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
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
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
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    Status do Material
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {MATERIAL_STATUS.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        data-testid={`material-status-${s.value}`}
                        onClick={() => setFormData({ ...formData, material_status: s.value })}
                        className="px-3 py-2 rounded-lg text-xs font-bold border transition-all"
                        style={{
                          backgroundColor: formData.material_status === s.value ? `${s.color}20` : 'rgba(255,255,255,0.02)',
                          borderColor: formData.material_status === s.value ? s.color : 'rgba(255,255,255,0.1)',
                          color: formData.material_status === s.value ? s.color : '#a1a1aa',
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {isScheduling && (
                  <>
                    <div className="border-t border-white/10 pt-5">
                      <p className="text-xs tracking-[0.2em] uppercase font-bold text-[#E0FF00] mb-4">
                        Dados da Programação
                      </p>
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                        Equipe
                      </label>
                      <select
                        data-testid="project-team-select"
                        value={formData.team_id}
                        onChange={(e) => handleTeamChange(e.target.value)}
                        className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all"
                      >
                        <option value="">Selecione uma equipe</option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name} {team.supervisor && `(${team.supervisor})`}
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
                          className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
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
                          className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
                        />
                      </div>
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
                        className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                        Status de Execução
                      </label>
                      <select
                        data-testid="project-exec-status-select"
                        value={formData.execution_status}
                        onChange={(e) => setFormData({ ...formData, execution_status: e.target.value })}
                        className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all"
                      >
                        {EXECUTION_STATUS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                        Produção Realizada (R$)
                      </label>
                      <input
                        data-testid="project-actual-input"
                        type="number"
                        step="0.01"
                        value={formData.actual_value}
                        onChange={(e) => setFormData({ ...formData, actual_value: e.target.value })}
                        className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                        Desligamento
                      </label>
                      <textarea
                        data-testid="project-shutdown-input"
                        value={formData.shutdown_info}
                        onChange={(e) => setFormData({ ...formData, shutdown_info: e.target.value })}
                        rows={2}
                        className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none transition-all"
                        placeholder="Ex: Alim 05 - 08h às 17h"
                      />
                    </div>

                    <label
                      className="flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer"
                      style={{
                        backgroundColor: formData.requires_hot_line ? 'rgba(255, 94, 0, 0.1)' : 'rgba(255,255,255,0.02)',
                        borderColor: formData.requires_hot_line ? '#FF5E00' : 'rgba(255,255,255,0.1)',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <Zap className="w-5 h-5" style={{ color: formData.requires_hot_line ? '#FF5E00' : '#71717a' }} />
                        <div>
                          <p className="text-white font-bold text-sm">Linha Viva</p>
                          <p className="text-xs text-zinc-500">Trabalho em linha energizada</p>
                        </div>
                      </div>
                      <input
                        data-testid="project-hotline-toggle"
                        type="checkbox"
                        checked={formData.requires_hot_line}
                        onChange={(e) => setFormData({ ...formData, requires_hot_line: e.target.checked })}
                        className="w-5 h-5 accent-[#FF5E00]"
                      />
                    </label>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                        Prioridade
                      </label>
                      <select
                        data-testid="project-priority-select"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                        className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all"
                      >
                        <option value="high">Alta</option>
                        <option value="medium">Média</option>
                        <option value="low">Baixa</option>
                      </select>
                    </div>
                  </>
                )}

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold py-3 rounded-full transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    data-testid="save-project-button"
                    className="flex-1 bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold py-3 rounded-full transition-all transform hover:scale-[1.02]"
                  >
                    {project ? 'Salvar' : isScheduling ? 'Programar' : 'Cadastrar'}
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
