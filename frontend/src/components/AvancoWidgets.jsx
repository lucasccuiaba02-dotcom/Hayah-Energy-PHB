import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const effColor = (e) => (e === null || e === undefined ? '#94A3B8' : e >= 1 ? '#39FF14' : e >= 0.8 ? '#E0FF00' : '#FF003C');

export const ProgressBar = ({ pct, color = '#39FF14', h = 'h-2' }) => (
  <div className={`${h} rounded bg-white/5 overflow-hidden`}>
    <div className={`h-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%`, background: color }}></div>
  </div>
);

export const AvancoQuickEntry = ({ projectId, items, onSaved, compact = false }) => {
  const [itemKey, setItemKey] = useState(items?.[0]?.key || '');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const usable = (items || []).filter((i) => i.planned_qty > 0);
  const sel = usable.find((i) => i.key === (itemKey || usable[0]?.key));

  const save = async () => {
    const k = itemKey || usable[0]?.key;
    const q = parseFloat(qty);
    if (!k) { toast.error('Cadastre quantitativos ou etapas para esta obra'); return; }
    if (!q) { toast.error('Informe a quantidade executada'); return; }
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/projects/${projectId}/avanco/entries`, { date, item_key: k, qty: q, notes });
      toast.success(`Avanço lançado · ${data.pct_fisico}% físico`);
      setQty(''); setNotes('');
      onSaved && onSaved(data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao lançar avanço');
    } finally { setSaving(false); }
  };

  if (usable.length === 0) {
    return <p data-testid="avanco-entry-empty" className="text-[11px] text-zinc-500 italic">Nenhum item com quantidade planejada. Cadastre os quantitativos da obra (postes, trafos, km…) ou adicione etapas.</p>;
  }
  return (
    <div data-testid="avanco-quick-entry" className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-5'}`}>
      <select data-testid="avanco-entry-item" value={itemKey || usable[0]?.key} onChange={(e) => setItemKey(e.target.value)} className="col-span-2 md:col-span-1 bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none">
        {usable.map((i) => <option key={i.key} value={i.key} data-testid={`avanco-entry-item-${i.key}`}>{i.label} ({i.executed_qty}/{i.planned_qty} {i.unit})</option>)}
      </select>
      <input data-testid="avanco-entry-qty" type="number" step="any" placeholder={`Qtd (${sel?.unit || 'un'})`} value={qty} onChange={(e) => setQty(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
      <input data-testid="avanco-entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
      <input data-testid="avanco-entry-notes" type="text" placeholder="Observação" value={notes} onChange={(e) => setNotes(e.target.value)} className="col-span-2 md:col-span-1 bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none" />
      <button data-testid="avanco-entry-save" disabled={saving} onClick={save} className="col-span-2 md:col-span-1 inline-flex items-center justify-center gap-1 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-xs font-bold px-4 py-2 rounded-full disabled:opacity-50">
        <Plus className="w-4 h-4" /> {saving ? 'Lançando…' : 'Lançar avanço'}
      </button>
    </div>
  );
};

export const AvancoItemsTable = ({ items }) => (
  <div className="space-y-2">
    {items.map((i) => (
      <div key={i.key} data-testid={`avanco-item-${i.key}`} className="rounded-lg p-2.5 bg-white/[0.02] border border-white/5">
        <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
          <span className="text-white font-bold">{i.label}{i.custom && <span className="ml-1 text-[9px] text-[#00F0FF] uppercase">etapa</span>}</span>
          <span className="font-mono text-zinc-300">{i.executed_qty} / {i.planned_qty} {i.unit} · peso {i.weight}</span>
          <span className="font-mono font-bold" style={{ color: i.pct >= 100 ? '#39FF14' : i.pct >= 50 ? '#E0FF00' : '#FF5E00' }}>{i.pct}%</span>
        </div>
        <div className="mt-1.5"><ProgressBar pct={i.pct} color={i.pct >= 100 ? '#39FF14' : i.pct >= 50 ? '#E0FF00' : '#FF5E00'} h="h-1.5" /></div>
      </div>
    ))}
  </div>
);

export const AvancoTimeline = ({ entries, items, onDelete }) => {
  const label = (k) => items.find((i) => i.key === k)?.label || k;
  const unit = (k) => items.find((i) => i.key === k)?.unit || '';
  if (!entries.length) return <p className="text-[11px] text-zinc-500 italic">Nenhum lançamento ainda.</p>;
  return (
    <div className="relative pl-5 space-y-2 max-h-72 overflow-y-auto">
      <div className="absolute left-1.5 top-1 bottom-1 w-px bg-white/10" />
      {entries.map((e) => (
        <div key={e.id} data-testid={`avanco-entry-${e.id}`} className="relative rounded-lg p-2.5 bg-white/[0.02] border border-white/5">
          <div className="absolute -left-[15px] top-3 w-2.5 h-2.5 rounded-full bg-[#E0FF00]" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-zinc-400">{(e.date || '').split('-').reverse().join('/')}</span>
            <span className="text-xs text-white font-bold">{label(e.item_key)}</span>
            <span className="font-mono text-xs text-[#39FF14] font-bold">+{e.qty} {unit(e.item_key)}</span>
            {onDelete && (
              <button data-testid={`avanco-entry-del-${e.id}`} onClick={() => onDelete(e.id)} className="text-zinc-500 hover:text-[#FF003C]"><Trash2 className="w-3 h-3" /></button>
            )}
          </div>
          {e.notes && <p className="text-[11px] text-zinc-400 italic mt-0.5">"{e.notes}"</p>}
          <p className="text-[10px] text-zinc-600">por {e.registered_by || '—'}</p>
        </div>
      ))}
    </div>
  );
};
