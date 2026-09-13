// Fev/2026 · Admin: Meta Contratual Mensal editável com histórico
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { Target, History, Save, Trash2, DollarSign, Calendar } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const ContractTargetSection = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState('');
  const [month, setMonth] = useState('default');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchData = async () => {
    try {
      const { data: d } = await axios.get(`${API}/admin/contract-target`);
      setData(d);
    } catch { toast.error('Erro ao carregar meta contratual'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const save = async () => {
    const num = parseFloat(target);
    if (!num || num <= 0) { toast.error('Digite um valor válido'); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/admin/contract-target`, { target: num, month, note });
      toast.success(month === 'default' ? 'Meta padrão atualizada!' : `Meta de ${month} atualizada!`);
      setTarget('');
      setNote('');
      await fetchData();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Remover este registro? A meta anterior volta a valer.')) return;
    try {
      await axios.delete(`${API}/admin/contract-target/${id}`);
      toast.info('Registro removido');
      await fetchData();
    } catch { toast.error('Erro'); }
  };

  if (loading) return <div className="glass-panel rounded-2xl p-4 text-zinc-500 text-sm">Carregando meta...</div>;
  if (!data) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="contract-target-section"
      className="glass-panel rounded-2xl p-5 border border-[#E0FF00]/30"
    >
      <div className="flex items-center gap-2 mb-4">
        <Target className="w-4 h-4 text-[#E0FF00]" />
        <h2 className="font-heading font-black text-lg text-white">Meta Contratual Mensal</h2>
        <button
          data-testid="toggle-history"
          onClick={() => setShowHistory((s) => !s)}
          className="ml-auto flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-white px-3 py-1 rounded-full border border-white/10 hover:bg-white/5"
        >
          <History className="w-3 h-3" />
          Histórico ({data.history.length})
        </button>
      </div>

      {/* Meta vigente */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl p-4 bg-[#E0FF00]/5 border border-[#E0FF00]/30" data-testid="active-target-card">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#E0FF00] mb-1">Meta Vigente</p>
          <p className="font-heading font-black text-2xl tracking-tighter text-white leading-none mb-1" data-testid="active-target-value">
            {fmt(data.active_target)}
          </p>
          <p className="text-[10px] text-zinc-500">
            {data.active_source === 'month' ? `Definida para ${data.current_month}` :
             data.active_source === 'default' ? 'Meta padrão global' :
             'Default do sistema (R$ 336k)'}
          </p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.03] border border-white/10">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Mês Atual</p>
          <p className="font-heading font-black text-2xl tracking-tighter text-white leading-none mb-1">{data.current_month}</p>
          <p className="text-[10px] text-zinc-500">Aplica meta específica se existir</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.03] border border-white/10">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Sistema</p>
          <p className="font-heading font-black text-2xl tracking-tighter text-zinc-400 leading-none mb-1">{fmt(data.system_default)}</p>
          <p className="text-[10px] text-zinc-500">Fallback quando nada configurado</p>
        </div>
      </div>

      {/* Form de edição */}
      <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10">
        <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Definir Nova Meta</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-1">
            <label className="text-[10px] font-bold text-zinc-500 block mb-1">Mês</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
              <select
                data-testid="target-month-select"
                value={month === 'default' ? 'default' : 'specific'}
                onChange={(e) => setMonth(e.target.value === 'default' ? 'default' : data.current_month)}
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none"
              >
                <option value="default">Padrão (todos os meses)</option>
                <option value="specific">Somente {data.current_month}</option>
              </select>
            </div>
          </div>
          {month !== 'default' && (
            <div>
              <label className="text-[10px] font-bold text-zinc-500 block mb-1">YYYY-MM</label>
              <input
                data-testid="target-month-input"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none"
              />
            </div>
          )}
          <div className={month === 'default' ? 'md:col-span-2' : 'md:col-span-1'}>
            <label className="text-[10px] font-bold text-zinc-500 block mb-1">Valor da Meta</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
              <input
                data-testid="target-value-input"
                type="number"
                min="0"
                step="1000"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="336000"
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-zinc-500 block mb-1">Nota</label>
            <input
              data-testid="target-note-input"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: aditivo contratual"
              className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            data-testid="save-target-btn"
            onClick={save}
            disabled={saving || !target}
            className="flex items-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] disabled:opacity-50 text-black text-xs font-bold px-5 py-2 rounded-full"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Salvando…' : 'Salvar Meta'}
          </button>
        </div>
      </div>

      {/* Histórico */}
      {showHistory && (
        <div className="mt-4 pt-4 border-t border-white/10" data-testid="target-history-panel">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Histórico de Alterações</p>
          {data.history.length === 0 ? (
            <p className="text-xs text-zinc-600 py-4 text-center">Nenhum registro. A meta padrão do sistema está em vigor.</p>
          ) : (
            <div className="space-y-2">
              {data.history.map((h) => (
                <div
                  key={h.id}
                  data-testid={`history-item-${h.month}`}
                  className="flex items-center justify-between gap-3 rounded-lg p-3 bg-white/[0.02] border border-white/10"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                        h.month === 'default'
                          ? 'bg-[#00F0FF]/15 border-[#00F0FF]/40 text-[#00F0FF]'
                          : 'bg-[#E0FF00]/15 border-[#E0FF00]/40 text-[#E0FF00]'
                      }`}>
                        {h.month === 'default' ? 'Padrão' : h.month}
                      </span>
                      <span className="text-white font-mono font-bold text-sm">{fmt(h.target)}</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                      {h.note && <span className="text-zinc-400">{h.note} · </span>}
                      Por {h.updated_by || '—'} · {h.updated_at.slice(0, 16).replace('T', ' ')}
                    </p>
                  </div>
                  <button
                    data-testid={`delete-target-${h.id}`}
                    onClick={() => remove(h.id)}
                    className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-[#FF003C] hover:bg-[#FF003C]/10 flex items-center justify-center"
                    title="Remover este registro"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
};
