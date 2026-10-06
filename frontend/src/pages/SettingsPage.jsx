import React, { useState } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Shield, Lock, MonitorSmartphone, Save, Eye, EyeOff, AlertTriangle, KeyRound } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../contexts/AuthContext';
import { NotificationCenter } from '../components/NotificationCenter';
import { IntegrationsPanel } from '../components/IntegrationsPanel';
import { BrandingPanel } from '../components/BrandingPanel';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const SettingsPage = () => {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const submitChange = async (e) => {
    e.preventDefault();
    if (!current || !next) { toast.error('Preencha os campos'); return; }
    if (next.length < 8) { toast.error('A nova senha precisa ter pelo menos 8 caracteres'); return; }
    if (next !== confirm) { toast.error('A confirmação não bate com a nova senha'); return; }
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/auth/change-password`, {
        current_password: current, new_password: next,
      });
      // Backend re-issues token — persist it so the current device stays logged in
      if (data.access_token) localStorage.setItem('access_token', data.access_token);
      toast.success('Senha alterada com sucesso. Outros dispositivos foram desconectados.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao trocar senha');
    } finally { setSaving(false); }
  };

  const revokeAll = async () => {
    if (!window.confirm('Desconectar TODOS os outros dispositivos agora?')) return;
    setRevoking(true);
    try {
      const { data } = await axios.post(`${API}/auth/logout-all-devices`, {});
      if (data.access_token) localStorage.setItem('access_token', data.access_token);
      toast.success('Todas as outras sessões foram revogadas. Só este dispositivo permanece conectado.');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao revogar sessões');
    } finally { setRevoking(false); }
  };

  return (
    <AppLayout title="Configurações" subtitle="Notificações, integrações e segurança da conta">
      <div className="max-w-3xl mx-auto space-y-6">
        <NotificationCenter />
        {user?.role === 'admin' && <IntegrationsPanel />}
        {user?.role === 'admin' && <BrandingPanel />}
        {/* User summary */}
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-5 border border-[#E0FF00]/25">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-[#E0FF00]/10 border border-[#E0FF00]/40 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#E0FF00]" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Sua conta</p>
              <p className="text-white font-bold" data-testid="settings-user-email">{user?.email}</p>
            </div>
            <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-[#E0FF00]/40 bg-[#E0FF00]/10 text-[#E0FF00]">
              {user?.role === 'admin' ? 'Administrador' : 'Usuário'}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Sua senha é privada — nem o suporte técnico consegue enxergá-la depois de gravada. Use uma senha longa (12+ caracteres) misturando letras, números e símbolos.
          </p>
        </motion.div>

        {/* Password change */}
        <motion.form
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onSubmit={submitChange}
          data-testid="settings-change-form"
          className="glass-panel rounded-2xl p-5 border border-white/10"
        >
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-4 h-4 text-[#00F0FF]" />
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#00F0FF]">Trocar senha</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Senha atual</label>
              <div className="relative mt-1">
                <input
                  data-testid="settings-current-password"
                  type={showCurrent ? 'text' : 'password'}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 pr-10 text-white focus:border-[#E0FF00] focus:outline-none"
                />
                <button type="button" onClick={() => setShowCurrent((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Nova senha (mínimo 8)</label>
              <div className="relative mt-1">
                <input
                  data-testid="settings-new-password"
                  type={showNext ? 'text' : 'password'}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 pr-10 text-white focus:border-[#E0FF00] focus:outline-none"
                />
                <button type="button" onClick={() => setShowNext((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                  {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {next && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${Math.min(next.length * 8, 100)}%`,
                        backgroundColor: next.length < 8 ? '#FF003C' : next.length < 12 ? '#FF5E00' : '#39FF14',
                      }}
                    />
                  </div>
                  <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: next.length < 8 ? '#FF003C' : next.length < 12 ? '#FF5E00' : '#39FF14' }}>
                    {next.length < 8 ? 'Fraca' : next.length < 12 ? 'Média' : 'Forte'}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Confirmar nova senha</label>
              <input
                data-testid="settings-confirm-password"
                type={showNext ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className={`w-full mt-1 bg-zinc-950 border rounded-lg px-3 py-2 text-white focus:outline-none ${confirm && confirm !== next ? 'border-[#FF003C] focus:border-[#FF003C]' : 'border-white/10 focus:border-[#E0FF00]'}`}
              />
              {confirm && confirm !== next && (
                <p className="text-[10px] text-[#FF003C] mt-0.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Não bate com a nova senha</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Ao trocar, <strong className="text-white">todas as outras sessões</strong> em outros aparelhos são desconectadas.
            </p>
            <button
              type="submit"
              data-testid="settings-change-submit"
              disabled={saving || !current || !next || next !== confirm}
              className="inline-flex items-center gap-2 text-xs font-black bg-[#E0FF00] hover:bg-[#C8E600] text-black px-5 py-2 rounded-full disabled:opacity-60"
            >
              <Save className="w-4 h-4" /> {saving ? 'Salvando…' : 'Trocar senha'}
            </button>
          </div>
        </motion.form>

        {/* Revoke all devices */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          data-testid="settings-revoke-section"
          className="glass-panel rounded-2xl p-5 border border-[#FF003C]/25"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FF003C]/10 border border-[#FF003C]/40 flex items-center justify-center flex-shrink-0">
              <MonitorSmartphone className="w-5 h-5 text-[#FF003C]" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#FF003C]">Desconectar outros dispositivos</p>
              <h3 className="text-white font-bold text-lg mt-0.5">Zerar acesso em qualquer outro aparelho</h3>
              <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                Ao clicar, todas as sessões abertas <strong className="text-white">em qualquer outro celular ou computador</strong> são revogadas na hora. Só este dispositivo continua conectado.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              data-testid="settings-revoke-btn"
              onClick={revokeAll}
              disabled={revoking}
              className="inline-flex items-center gap-2 text-xs font-black bg-[#FF003C] hover:bg-[#E60036] text-white px-5 py-2 rounded-full disabled:opacity-60"
            >
              <KeyRound className="w-4 h-4" /> {revoking ? 'Revogando…' : 'Desconectar outros dispositivos'}
            </button>
          </div>
        </motion.div>
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
