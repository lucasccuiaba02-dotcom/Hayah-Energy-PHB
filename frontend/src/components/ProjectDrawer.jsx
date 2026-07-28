import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, MapPin } from 'lucide-react';
import {
  PROJECT_TYPES,
  TIPO_SERVICO,
  MUNICIPIOS,
  EXECUTION_STATUS,
  MATERIAL_STATUS,
  RESCHEDULE_REASONS,
  todayISO,
} from '../lib/constants';

export const ProjectDrawer = ({ isOpen, onClose, onSave, project, teams, defaultScheduled = false }) => {
  const initialState = () => ({
    name: '',
    project_code: '',
    project_type: 'anexo_iv',
    tipo_servico: '',
    location: '',
    utm_x: '',
    utm_y: '',
    received_date: todayISO(),
    expiry_date: '',
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
    execution_status: 'aguardando_programacao',
    is_scheduled: defaultScheduled,
    reschedule_reason: '',
  });

  const [formData, setFormData] = useState(initialState());
  const [showRescheduleReason, setShowRescheduleReason] = useState(false);

  const isScheduling = formData.is_scheduled;

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        project_code: project.project_code || '',
        project_type: project.project_type || 'anexo_iv',
        tipo_servico: project.tipo_servico || '',
        location: project.location || '',
        utm_x: project.utm_x || '',
        utm_y: project.utm_y || '',
        received_date: project.received_date || '',
        expiry_date: project.expiry_date || '',
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
        execution_status: project.execution_status || 'aguardando_programacao',
        is_scheduled: project.is_scheduled || false,
        reschedule_reason: '',
      });
    } else {
      setFormData({ ...initialState(), is_scheduled: defaultScheduled });
    }
    setShowRescheduleReason(false);
  }, [project, isOpen, defaultScheduled]);

  const handleTeamChange = (teamId) => {
    const team = teams.find((t) => t.id === teamId);
    setFormData((f) => ({ ...f, team_id: teamId, team_name: team ? team.name : '' }));
  };

  const handleDateChange = (field, value) => {
    // If editing scheduled project and date changed, ask for reason
    if (project && project.is_scheduled && project[field] && project[field] !== value) {
      setShowRescheduleReason(true);
    }
    setFormData((f) => ({ ...f, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...formData,
      labor_cost: parseFloat(formData.labor_cost) || 0,
      material_cost: parseFloat(formData.material_cost) || 0,
      programmed_value: parseFloat(formData.programmed_value) || 0,
      billing_value: parseFloat(formData.billing_value) || 0,
      daily_goal: parseFloat(formData.daily_goal) || 0,
      actual_value: parseFloat(formData.actual_value) || 0,
    };
    if (!showRescheduleReason) delete payload.reschedule_reason;
    onSave(payload);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
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
                  <p className="text-xs text-zinc-500 mt-1">{isScheduling ? 'Atribua data, equipe e tipo de serviço' : 'Cadastro na carteira'}</p>
                </div>
                <button data-testid="close-drawer-button" onClick={onClose} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

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
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Número do Projeto</label>
                  <input
                    data-testid="project-code-input"
                    type="text"
                    value={formData.project_code}
                    onChange={(e) => setFormData({ ...formData, project_code: e.target.value })}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none font-mono"
                    placeholder="Ex: 0122405016"
                  />
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Nome do Projeto</label>
                  <input
                    data-testid="project-name-input"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none"
                    placeholder="Ex: Reforma Alimentador"
                  />
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Tipo do Projeto</label>
                  <select
                    data-testid="project-type-select"
                    value={formData.project_type}
                    onChange={(e) => setFormData({ ...formData, project_type: e.target.value })}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none"
                  >
                    {PROJECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                    <MapPin className="w-3 h-3 inline mr-1" /> Localidade
                  </label>
                  <select
                    data-testid="project-location-input"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none"
                  >
                    <option value="">Selecione o município</option>
                    {MUNICIPIOS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Coord. UTM X</label>
                    <input
                      data-testid="project-utm-x-input"
                      type="text"
                      value={formData.utm_x}
                      onChange={(e) => setFormData({ ...formData, utm_x: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none font-mono"
                      placeholder="Ex: 597823"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Coord. UTM Y</label>
                    <input
                      data-testid="project-utm-y-input"
                      type="text"
                      value={formData.utm_y}
                      onChange={(e) => setFormData({ ...formData, utm_y: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none font-mono"
                      placeholder="Ex: 8283412"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Data Recebimento</label>
                    <input
                      data-testid="project-received-date"
                      type="date"
                      value={formData.received_date}
                      onChange={(e) => setFormData({ ...formData, received_date: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Data Vencimento</label>
                    <input
                      data-testid="project-expiry-date"
                      type="date"
                      value={formData.expiry_date}
                      onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Status do Projeto</label>
                  <select
                    data-testid="project-exec-status-select"
                    value={formData.execution_status}
                    onChange={(e) => setFormData({ ...formData, execution_status: e.target.value })}
                    className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none"
                  >
                    {EXECUTION_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Mão de Obra (R$)</label>
                    <input data-testid="project-labor-input" type="number" step="0.01" value={formData.labor_cost} onChange={(e) => setFormData({ ...formData, labor_cost: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white font-mono" />
                  </div>
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Material (R$)</label>
                    <input data-testid="project-material-input" type="number" step="0.01" value={formData.material_cost} onChange={(e) => setFormData({ ...formData, material_cost: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white font-mono" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Valor Programado (R$)</label>
                    <input data-testid="project-programmed-input" type="number" step="0.01" value={formData.programmed_value} onChange={(e) => setFormData({ ...formData, programmed_value: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white font-mono" />
                  </div>
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Faturamento (R$)</label>
                    <input data-testid="project-billing-input" type="number" step="0.01" value={formData.billing_value} onChange={(e) => setFormData({ ...formData, billing_value: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white font-mono" />
                  </div>
                </div>

                <div>
                  <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Status do Material</label>
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
                      <p className="text-xs tracking-[0.2em] uppercase font-bold text-[#E0FF00] mb-4">Dados da Programação</p>
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Tipo de Serviço</label>
                      <select
                        data-testid="project-tipo-servico-select"
                        value={formData.tipo_servico}
                        onChange={(e) => setFormData({ ...formData, tipo_servico: e.target.value })}
                        className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none"
                      >
                        {TIPO_SERVICO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Equipe</label>
                      <select data-testid="project-team-select" value={formData.team_id} onChange={(e) => handleTeamChange(e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none">
                        <option value="">Selecione uma equipe</option>
                        {teams.map((team) => (<option key={team.id} value={team.id}>{team.name} {team.supervisor && `(${team.supervisor})`}</option>))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Data Início</label>
                        <input data-testid="project-start-date" type="date" value={formData.start_date} onChange={(e) => handleDateChange('start_date', e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none font-mono" />
                      </div>
                      <div>
                        <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Data Fim</label>
                        <input data-testid="project-end-date" type="date" value={formData.end_date} onChange={(e) => handleDateChange('end_date', e.target.value)} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none font-mono" />
                      </div>
                    </div>

                    {showRescheduleReason && (
                      <div className="p-4 rounded-lg bg-[#FF5E00]/10 border border-[#FF5E00]/40">
                        <label className="text-xs tracking-[0.2em] uppercase font-bold text-[#FF5E00] block mb-2">Motivo do Remanejamento</label>
                        <select
                          data-testid="reschedule-reason-select"
                          value={formData.reschedule_reason}
                          onChange={(e) => setFormData({ ...formData, reschedule_reason: e.target.value })}
                          required
                          className="w-full bg-zinc-950/90 border border-[#FF5E00]/40 rounded-lg px-4 py-3 text-white focus:border-[#FF5E00] focus:outline-none"
                        >
                          <option value="">Selecione o motivo</option>
                          {RESCHEDULE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        <p className="text-[10px] text-zinc-500 mt-2">O histórico será salvo para consulta futura.</p>
                      </div>
                    )}

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Meta Diária (R$)</label>
                      <input data-testid="project-daily-goal-input" type="number" step="0.01" value={formData.daily_goal} onChange={(e) => setFormData({ ...formData, daily_goal: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white font-mono" />
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Produção Realizada (R$)</label>
                      <input data-testid="project-actual-input" type="number" step="0.01" value={formData.actual_value} onChange={(e) => setFormData({ ...formData, actual_value: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white font-mono" />
                    </div>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Desligamento</label>
                      <textarea data-testid="project-shutdown-input" value={formData.shutdown_info} onChange={(e) => setFormData({ ...formData, shutdown_info: e.target.value })} rows={2} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white" placeholder="Ex: Alim 05 - 08h às 17h" />
                    </div>

                    <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer" style={{ backgroundColor: formData.requires_hot_line ? 'rgba(255, 94, 0, 0.1)' : 'rgba(255,255,255,0.02)', borderColor: formData.requires_hot_line ? '#FF5E00' : 'rgba(255,255,255,0.1)' }}>
                      <div className="flex items-center gap-3">
                        <Zap className="w-5 h-5" style={{ color: formData.requires_hot_line ? '#FF5E00' : '#71717a' }} />
                        <div>
                          <p className="text-white font-bold text-sm">Linha Viva</p>
                          <p className="text-xs text-zinc-500">Trabalho em linha energizada</p>
                        </div>
                      </div>
                      <input data-testid="project-hotline-toggle" type="checkbox" checked={formData.requires_hot_line} onChange={(e) => setFormData({ ...formData, requires_hot_line: e.target.checked })} className="w-5 h-5 accent-[#FF5E00]" />
                    </label>

                    <div>
                      <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">Prioridade</label>
                      <select data-testid="project-priority-select" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none">
                        <option value="high">Alta</option>
                        <option value="medium">Média</option>
                        <option value="low">Baixa</option>
                      </select>
                    </div>
                  </>
                )}

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={onClose} className="flex-1 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold py-3 rounded-full transition-all">Cancelar</button>
                  <button type="submit" data-testid="save-project-button" className="flex-1 bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold py-3 rounded-full transition-all transform hover:scale-[1.02]">
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
