import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, User, Users as UsersIcon } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { TeamDrawer } from '../components/TeamDrawer';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const EquipesPage = () => {
  const [teams, setTeams] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetchTeams();
  }, []);

  const fetchTeams = async () => {
    const { data } = await axios.get(`${API}/teams`);
    setTeams(data);
  };

  const handleSave = async (teamData, editing) => {
    try {
      if (editing) {
        await axios.put(`${API}/teams/${editing.id}`, teamData);
        toast.success('Equipe atualizada!');
      } else {
        await axios.post(`${API}/teams`, teamData);
        toast.success('Equipe criada!');
      }
      fetchTeams();
    } catch {
      toast.error('Erro ao salvar equipe');
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/teams/${id}`);
      toast.success('Equipe excluída!');
      fetchTeams();
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  return (
    <AppLayout
      title="Equipes"
      subtitle="Gerencie encarregados e composição"
      actions={
        <button
          data-testid="open-teams-drawer"
          onClick={() => setIsOpen(true)}
          className="bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold px-6 py-2 rounded-full transition-all transform hover:scale-105 flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Nova Equipe
        </button>
      }
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {teams.length === 0 ? (
          <div className="col-span-full glass-panel rounded-2xl p-12 text-center">
            <UsersIcon className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 text-lg">Nenhuma equipe cadastrada.</p>
            <p className="text-zinc-600 text-sm mt-2">Clique em "Nova Equipe" para começar.</p>
          </div>
        ) : (
          teams.map((t, i) => (
            <motion.div
              key={t.id}
              data-testid={`team-card-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-panel rounded-2xl p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-[#E0FF00]/10 border border-[#E0FF00]/30 flex items-center justify-center">
                    <UsersIcon className="w-5 h-5 text-[#E0FF00]" />
                  </div>
                  <div>
                    <h3 className="font-heading font-black text-lg tracking-tighter text-white">{t.name}</h3>
                    <p className="text-xs text-zinc-500">{t.member_count || (t.members || []).length} {(t.member_count || (t.members || []).length) === 1 ? 'membro' : 'membros'}</p>
                  </div>
                </div>
                <button
                  data-testid={`delete-team-card-${i}`}
                  onClick={() => {
                    if (window.confirm(`Excluir equipe ${t.name}?`)) handleDelete(t.id);
                  }}
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C]"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {t.supervisor && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/5 mb-3">
                  <User className="w-4 h-4 text-[#E0FF00]" />
                  <div>
                    <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Encarregado</p>
                    <p className="text-sm text-white font-bold">{t.supervisor}</p>
                  </div>
                </div>
              )}

              {t.members && t.members.length > 0 && (
                <div>
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Membros</p>
                  <div className="flex flex-wrap gap-1">
                    {t.members.map((m, mi) => (
                      <span key={mi} className="text-xs px-2 py-1 rounded-full bg-white/5 text-zinc-300 border border-white/10">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ))
        )}
      </motion.div>

      <TeamDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSave={handleSave}
        teams={teams}
        onDelete={handleDelete}
      />
    </AppLayout>
  );
};
