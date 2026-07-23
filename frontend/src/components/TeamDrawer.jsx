import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Edit2 } from 'lucide-react';

export const TeamDrawer = ({ isOpen, onClose, onSave, team, teams, onDelete }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [formData, setFormData] = useState({ name: '', members: [], supervisor: '', member_count: 0 });
  const [memberInput, setMemberInput] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setShowForm(false);
      setEditingTeam(null);
      setFormData({ name: '', members: [], supervisor: '', member_count: 0 });
      setMemberInput('');
    }
  }, [isOpen]);

  const startEdit = (t) => {
    setEditingTeam(t);
    setFormData({
      name: t.name,
      members: t.members || [],
      supervisor: t.supervisor || '',
      member_count: t.member_count || (t.members || []).length,
    });
    setShowForm(true);
  };

  const startCreate = () => {
    setEditingTeam(null);
    setFormData({ name: '', members: [], supervisor: '', member_count: 0 });
    setShowForm(true);
  };

  const addMember = () => {
    if (memberInput.trim()) {
      const newMembers = [...formData.members, memberInput.trim()];
      setFormData({ ...formData, members: newMembers, member_count: newMembers.length });
      setMemberInput('');
    }
  };

  const removeMember = (index) => {
    const newMembers = formData.members.filter((_, i) => i !== index);
    setFormData({ ...formData, members: newMembers, member_count: newMembers.length });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSave({
      ...formData,
      member_count: parseInt(formData.member_count) || formData.members.length,
    }, editingTeam);
    setShowForm(false);
    setEditingTeam(null);
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
            data-testid="team-drawer"
            className="fixed right-0 top-0 h-screen w-full max-w-lg bg-[#09090b] border-l border-white/10 z-50 overflow-y-auto"
          >
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="font-heading font-black text-2xl tracking-tighter text-white">
                  Gerenciar Equipes
                </h2>
                <button
                  onClick={onClose}
                  data-testid="close-team-drawer"
                  className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!showForm ? (
                <>
                  <button
                    data-testid="add-team-button"
                    onClick={startCreate}
                    className="w-full bg-[#39FF14] hover:bg-[#32E012] text-black font-bold py-3 rounded-full transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2 mb-6"
                  >
                    <Plus className="w-5 h-5" />
                    Nova Equipe
                  </button>

                  <div className="space-y-3">
                    {teams.length === 0 ? (
                      <div className="text-center py-8 text-zinc-500">
                        <p>Nenhuma equipe cadastrada.</p>
                      </div>
                    ) : (
                      teams.map((t, index) => (
                        <div key={t.id} data-testid={`team-item-${index}`} className="glass-panel rounded-xl p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="text-white font-bold">{t.name}</h3>
                              {t.supervisor && (
                                <p className="text-xs text-[#E0FF00] mt-1">
                                  <span className="text-zinc-500">Encarregado: </span>{t.supervisor}
                                </p>
                              )}
                              <p className="text-xs text-zinc-500 mt-1">
                                {t.member_count || (t.members || []).length} {(t.member_count || (t.members || []).length) === 1 ? 'membro' : 'membros'}
                              </p>
                              {t.members.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {t.members.map((m, i) => (
                                    <span
                                      key={i}
                                      className="text-xs px-2 py-1 rounded-full bg-white/5 text-zinc-300 border border-white/10"
                                    >
                                      {m}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                data-testid={`edit-team-${index}`}
                                onClick={() => startEdit(t)}
                                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#00F0FF] transition-all"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                data-testid={`delete-team-${index}`}
                                onClick={() => {
                                  if (window.confirm('Excluir esta equipe?')) {
                                    onDelete(t.id);
                                  }
                                }}
                                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C] transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Nome da Equipe
                    </label>
                    <input
                      data-testid="team-name-input"
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none transition-all"
                      placeholder="Ex: Equipe A"
                    />
                  </div>

                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Encarregado
                    </label>
                    <input
                      data-testid="team-supervisor-input"
                      type="text"
                      value={formData.supervisor}
                      onChange={(e) => setFormData({ ...formData, supervisor: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none transition-all"
                      placeholder="Nome do encarregado"
                    />
                  </div>

                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Quantidade de Membros
                    </label>
                    <input
                      data-testid="team-member-count-input"
                      type="number"
                      min="0"
                      value={formData.member_count}
                      onChange={(e) => setFormData({ ...formData, member_count: e.target.value })}
                      className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                      Membros
                    </label>
                    <div className="flex gap-2 mb-3">
                      <input
                        data-testid="team-member-input"
                        type="text"
                        value={memberInput}
                        onChange={(e) => setMemberInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addMember();
                          }
                        }}
                        className="flex-1 bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-zinc-600 focus:border-[#00F0FF] focus:outline-none transition-all"
                        placeholder="Nome do membro"
                      />
                      <button
                        type="button"
                        data-testid="add-member-button"
                        onClick={addMember}
                        className="px-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-lg transition-all"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {formData.members.map((m, i) => (
                        <span
                          key={i}
                          className="text-sm px-3 py-1 rounded-full bg-white/5 text-white border border-white/10 flex items-center gap-2"
                        >
                          {m}
                          <button
                            type="button"
                            onClick={() => removeMember(i)}
                            className="text-zinc-500 hover:text-[#FF003C]"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingTeam(null);
                      }}
                      className="flex-1 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold py-3 rounded-full transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      data-testid="save-team-button"
                      className="flex-1 bg-[#00F0FF] hover:bg-[#00D8E6] text-black font-bold py-3 rounded-full transition-all"
                    >
                      {editingTeam ? 'Salvar' : 'Criar'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
