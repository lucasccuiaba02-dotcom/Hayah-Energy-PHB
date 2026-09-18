import axios from 'axios';
import { toast } from 'sonner';

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const STATUS = [
  { key: 'rascunho', label: 'Rascunho', color: '#94A3B8' },
  { key: 'enviado', label: 'Enviado', color: '#00F0FF' },
  { key: 'aprovado', label: 'Aprovado', color: '#E0FF00' },
  { key: 'em_execucao', label: 'Em execução', color: '#FF5E00' },
  { key: 'concluido', label: 'Concluído', color: '#39FF14' },
  { key: 'cancelado', label: 'Cancelado', color: '#FF003C' },
];
export const statusOf = (k) => STATUS.find((s) => s.key === k) || STATUS[0];

export const PHOTO_KINDS = [
  { key: 'servico', label: 'Serviço', color: '#00F0FF' },
  { key: 'antes', label: 'Antes', color: '#FF5E00' },
  { key: 'depois', label: 'Depois', color: '#39FF14' },
  { key: 'croqui', label: 'Croqui', color: '#E0FF00' },
];
export const kindOf = (k) => PHOTO_KINDS.find((p) => p.key === k) || PHOTO_KINDS[0];

export const inputCls = 'w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none';
export const labelCls = 'text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block';
export const btnPrimary = 'inline-flex items-center justify-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600] disabled:opacity-40 disabled:cursor-not-allowed';
export const btnGhost = 'inline-flex items-center justify-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15 text-zinc-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed';

export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
};

export const fmtDate = (iso) => (iso && iso.length >= 10 ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export const calcTotals = (form) => {
  const markup = num(form.material_markup_pct);
  const labor_total = (form.labor_items || []).reduce((s, i) => s + num(i.qty) * num(i.unit_price), 0);
  const material_total = (form.material_items || []).reduce((s, i) => s + num(i.qty) * num(i.unit_cost) * (1 + markup / 100), 0);
  return { labor_total, material_total, grand_total: labor_total + material_total };
};

export async function downloadPdf(url, filename) {
  try {
    const { data } = await axios.get(url, { responseType: 'blob' });
    const href = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(href);
    toast.success('PDF gerado');
  } catch (e) {
    toast.error('Falha ao gerar PDF');
  }
}

export const Field = ({ label, testid, textarea, className = '', ...props }) => (
  <div className={className}>
    <label className={labelCls}>{label}</label>
    {textarea ? (
      <textarea data-testid={testid} className={`${inputCls} min-h-[72px] resize-y`} {...props} />
    ) : (
      <input data-testid={testid} className={inputCls} {...props} />
    )}
  </div>
);
