import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Shield, CheckCircle2, XCircle, Trash2, Save, Clock, LogOut, KeyRound, Smartphone } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { PERMISSION_TABS } from '../lib/constants';
import { ContractTargetSection } from '../components/ContractTargetSection';
import { AvancoThresholdSection } from '../components/AvancoThresholdSection';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const TEAM_TIPO = { linha_morta: 'Linha Morta', linha_viva: 'Linha Viva', mista: 'Mista' };

export const AdminUsuariosPage = () => {
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // user id
  const [editedPerms, setEditedPerms] = useState({}); // { userId: [perms] }
  const [editedRole, setEditedRole] = useState({});
  const [editedEnc, setEditedEnc] = useState({}); // Set/2026 · { userId: bool } encarregado de campo
  const [editedTeams, setEditedTeams] = useState({}); // { userId: [team_ids] }

  const fetch = async () => {
    try {
      const { data } = await axios.get(`${API}/admin/users`);
      setUsers(data);
    } catch { toast.error('Sem permissão de admin'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetch(); axios.get(`${API}/teams`).then(({ data }) => setTeams(data || [])).catch(() => {}); }, []);

  const startEdit = (u) => {
    setExpanded(u.id);
    setEditedPerms({ ...editedPerms, [u.id]: [...(u.permissions || [])] });
    setEditedRole({ ...editedRole, [u.id]: u.role });
    setEditedEnc({ ...editedEnc, [u.id]: !!u.is_encarregado });
    setEditedTeams({ ...editedTeams, [u.id]: [...(u.team_ids || [])] });
  };

  const togglePerm = (uid, perm) => {
    const list = editedPerms[uid] || [];
    setEditedPerms({ ...editedPerms, [uid]: list.includes(perm) ? list.filter((p) => p !== perm) : [...list, perm] });
  };

  const toggleTeam = (uid, tid) => {
    const list = editedTeams[uid] || [];
    setEditedTeams({ ...editedTeams, [uid]: list.includes(tid) ? list.filter((t) => t !== tid) : [...list, tid] });
  };

  const bodyFor = (u) => ({
    permissions: editedPerms[u.id] || [],
    role: editedRole[u.id] || 'user',
    is_encarregado: !!editedEnc[u.id],
    team_ids: editedTeams[u.id] || [],
  });

  const approve = async (u) => {
    try {
      await axios.post(`${API}/admin/users/${u.id}/approve`, bodyFor(u));
      toast.success(`${u.name} aprovado!`);
      fetch();
    } catch { toast.error('Erro ao aprovar'); }
  };

  const savePerms = async (u) => {
    if (editedEnc[u.id] && (editedTeams[u.id] || []).length === 0) { toast.error('Selecione ao menos uma equipe para o encarregado'); return; }
    try {
      await axios.put(`${API}/admin/users/${u.id}/permissions`, bodyFor(u));
      toast.success(`Permissões atualizadas!`);
      fetch();
    } catch { toast.error('Erro'); }
  };

  const reject = async (u) => {
    if (!window.confirm(`Rejeitar ${u.email}?`)) return;
    await axios.post(`${API}/admin/users/${u.id}/reject`);
    toast.info('Usuário rejeitado');
    fetch();
  };

  const remove = async (u) => {
    if (!window.confirm(`Excluir ${u.email}? Ação irreversível.`)) return;
    try {
      await axios.delete(`${API}/admin/users/${u.id}`);
      toast.success('Removido');
      fetch();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };

  const forceLogout = async (u) => {
    if (!window.confirm(`Desconectar ${u.email} de todos os dispositivos?`)) return;
    try {
      await axios.post(`${API}/admin/users/${u.id}/force-logout`);
      toast.success(`Sessões de ${u.email} revogadas.`);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };

  const resetPassword = async (u) => {
    const newPass = window.prompt(`Nova senha temporária para ${u.email} (mínimo 8):`, '');
    if (!newPass) return;
    if (newPass.length < 8) { toast.error('Mínimo 8 caracteres'); return; }
    try {
      await axios.post(`${API}/admin/users/${u.id}/reset-password`, { new_password: newPass });
      toast.success(`Senha de ${u.email} redefinida. Sessões antigas foram revogadas.`);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };

  const pending = users.filter((u) => u.status === 'pending');
  const approved = users.filter((u) => u.status === 'approved');
  const rejected = users.filter((u) => u.status === 'rejected');

  const renderUser = (u) => {
    const isEdit = expanded === u.id;
    const perms = editedPerms[u.id] || u.permissions || [];
    return (
      <div key={u.id} data-testid={`admin-user-${u.id}`} className="glass-panel rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#00F0FF]/10 border border-[#00F0FF]/30 flex items-center justify-center text-[#00F0FF] font-bold">
              {u.name?.[0]?.toUpperCase() || u.email[0].toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-white text-sm">{u.name}</p>
              <p className="text-[11px] text-zinc-500">{u.email}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
              u.status === 'pending' ? 'bg-[#FF5E00]/15 border-[#FF5E00]/40 text-[#FF5E00]' :
              u.status === 'approved' ? 'bg-[#39FF14]/15 border-[#39FF14]/40 text-[#39FF14]' :
              'bg-[#FF003C]/15 border-[#FF003C]/40 text-[#FF003C]'
            }`}>
              {u.status === 'pending' ? 'Pendente' : u.status === 'approved' ? 'Aprovado' : 'Rejeitado'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-white/5 border border-white/10 text-zinc-400">
              {u.role}
            </span>
            {u.is_encarregado && (
              <span data-testid={`admin-enc-badge-${u.id}`} className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00] inline-flex items-center gap-1">
                <Smartphone className="w-3 h-3" /> Encarregado · {(u.team_ids || []).map((tid) => teams.find((t) => t.id === tid)?.name).filter(Boolean).join(', ') || 'sem equipe'}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button data-testid={`admin-edit-${u.id}`} onClick={() => isEdit ? setExpanded(null) : startEdit(u)} className="text-xs font-bold px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-white">
              {isEdit ? 'Fechar' : 'Permissões'}
            </button>
            {u.status === 'pending' && (
              <>
                <button data-testid={`admin-approve-${u.id}`} onClick={() => approve(u)} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600]">
                  <CheckCircle2 className="w-3 h-3" /> Aprovar
                </button>
                <button data-testid={`admin-reject-${u.id}`} onClick={() => reject(u)} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-[#FF003C]/15 border border-[#FF003C]/40 text-[#FF003C] hover:bg-[#FF003C]/25">
                  <XCircle className="w-3 h-3" /> Rejeitar
                </button>
              </>
            )}
            <button data-testid={`admin-force-logout-${u.id}`} onClick={() => forceLogout(u)} title="Desconectar de todos os dispositivos" className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-[#FF003C] flex items-center justify-center">
              <LogOut className="w-3 h-3" />
            </button>
            <button data-testid={`admin-reset-pass-${u.id}`} onClick={() => resetPassword(u)} title="Resetar senha (define senha temporária + revoga sessões)" className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-[#E0FF00] flex items-center justify-center">
              <KeyRound className="w-3 h-3" />
            </button>
            <button data-testid={`admin-delete-${u.id}`} onClick={() => remove(u)} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-[#FF003C] flex items-center justify-center">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {isEdit && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Perfil</label>
              <select
                data-testid={`admin-role-${u.id}`}
                value={editedRole[u.id] || u.role}
                onChange={(e) => setEditedRole({ ...editedRole, [u.id]: e.target.value })}
                className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-1 text-sm text-white"
              >
                <option value="user">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Abas permitidas</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PERMISSION_TABS.map((tab) => (
                <label key={tab.value} className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-white/[0.02] border border-white/10 hover:border-white/20 cursor-pointer">
                  <input
                    data-testid={`admin-perm-${u.id}-${tab.value}`}
                    type="checkbox"
                    checked={perms.includes(tab.value)}
                    onChange={() => togglePerm(u.id, tab.value)}
                    className="accent-[#E0FF00]"
                  />
                  <span className="text-xs text-white">{tab.label}</span>
                </label>
              ))}
            </div>

            {/* Set/2026 · Modo Campo — encarregado + equipes */}
            <div data-testid={`admin-campo-${u.id}`} className="mt-4 rounded-xl border border-[#E0FF00]/25 bg-[#E0FF00]/[0.03] p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  data-testid={`admin-encarregado-${u.id}`}
                  type="checkbox"
                  checked={!!editedEnc[u.id]}
                  onChange={() => setEditedEnc({ ...editedEnc, [u.id]: !editedEnc[u.id] })}
                  className="w-5 h-5 accent-[#E0FF00]"
                />
                <Smartphone className="w-4 h-4 text-[#E0FF00]" />
                <div>
                  <p className="text-sm font-bold text-white">Encarregado de campo</p>
                  <p className="text-[10px] text-zinc-500">Ao logar cai no Modo Campo (obras do dia da equipe, câmera, APR e documentos offline). Menu enxuto: só as abas marcadas acima.</p>
                </div>
              </label>
              {editedEnc[u.id] && (
                <div className="mt-3">
                  <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Equipes do encarregado</p>
                  {teams.length === 0 ? <p className="text-xs text-zinc-500 italic">Nenhuma equipe cadastrada (aba Equipes).</p> : (
                    <div className="flex flex-wrap gap-2">
                      {teams.map((t) => {
                        const on = (editedTeams[u.id] || []).includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            data-testid={`admin-team-${u.id}-${t.id}`}
                            onClick={() => toggleTeam(u.id, t.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${on ? 'bg-[#E0FF00] text-black border-[#E0FF00]' : 'bg-white/5 text-zinc-300 border-white/10 hover:border-white/30'}`}
                          >
                            {t.name} <span className="opacity-60 font-normal">· {TEAM_TIPO[t.tipo] || 'Linha Morta'}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button data-testid={`admin-save-${u.id}`} onClick={() => (u.status === 'pending' ? approve(u) : savePerms(u))} className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600]">
                <Save className="w-3 h-3" /> Salvar
              </button>
            </div>
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <AppLayout title="Administração" subtitle="Aprovação e permissões de usuários">
      {loading ? (
        <p className="text-zinc-500">Carregando...</p>
      ) : (
        <div className="space-y-6">
          {/* Meta Contratual configurável (Fev/2026) */}
          <ContractTargetSection />
          {/* Limite Avanço Físico (Set/2026) */}
          <AvancoThresholdSection />

          {pending.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-[#FF5E00]" />
                <h2 className="font-heading font-black text-lg text-white">Pendentes ({pending.length})</h2>
              </div>
              <div className="space-y-2">{pending.map(renderUser)}</div>
            </section>
          )}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-[#39FF14]" />
              <h2 className="font-heading font-black text-lg text-white">Aprovados ({approved.length})</h2>
            </div>
            <div className="space-y-2">{approved.map(renderUser)}</div>
          </section>
          {rejected.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <XCircle className="w-4 h-4 text-[#FF003C]" />
                <h2 className="font-heading font-black text-lg text-white">Rejeitados ({rejected.length})</h2>
              </div>
              <div className="space-y-2">{rejected.map(renderUser)}</div>
            </section>
          )}
        </div>
      )}
    </AppLayout>
  );
};
