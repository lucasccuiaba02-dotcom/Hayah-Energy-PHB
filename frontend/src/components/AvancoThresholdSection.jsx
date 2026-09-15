import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Gauge, Save } from 'lucide-react';
import { formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const AvancoThresholdSection = () => {
  const [current, setCurrent] = useState(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => axios.get(`${API}/avanco/threshold`).then(({ data }) => { setCurrent(data); setValue(String(data.threshold)); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    const v = parseFloat(value);
    if (!v || v <= 0) { toast.error('Informe um valor maior que zero'); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/avanco/threshold`, { threshold: v });
      toast.success(`Limite do Avanço Físico: ${formatCurrency(v)}`);
      load();
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao salvar'); } finally { setSaving(false); }
  };

  return (
    <div data-testid="avanco-threshold-section" className="glass-panel rounded-2xl p-5 border border-[#39FF14]/30">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#39FF14]/15 border border-[#39FF14]/40 flex items-center justify-center"><Gauge className="w-5 h-5 text-[#39FF14]" /></div>
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#39FF14]">Avanço Físico · Ticket grande</p>
          <p className="text-xs text-zinc-400">Obras com Valor Programado a partir deste limite entram na aba Avanço Físico</p>
        </div>
        {current && <span data-testid="avanco-threshold-active" className="ml-auto font-mono text-sm font-bold text-white">{formatCurrency(current.threshold)}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input data-testid="avanco-threshold-input" type="number" step="1000" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono w-44 focus:border-[#39FF14] focus:outline-none" />
        <button data-testid="avanco-threshold-save" disabled={saving} onClick={save} className="inline-flex items-center gap-1 bg-[#39FF14] text-black text-xs font-bold px-4 py-2 rounded-full hover:scale-105 transition disabled:opacity-50"><Save className="w-3.5 h-3.5" /> {saving ? 'Salvando…' : 'Salvar limite'}</button>
        <span className="text-[11px] text-zinc-500">padrão do sistema: {formatCurrency(current?.default || 45000)}</span>
      </div>
    </div>
  );
};
