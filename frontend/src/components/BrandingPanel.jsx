import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Palette, KeyRound, Upload, Trash2, Save, Loader, BadgeCheck, Lock, Unlock } from 'lucide-react';
import { useBranding, setBrandingCache, splitName } from '../lib/branding';
import { useLicense, dateBR } from '../lib/license';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const MAX = 300 * 1024;
const inp = 'w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E0FF00]';

/** Reduz a imagem no navegador até caber em ≤ 300 KB (data URL). SVG vai direto. */
export const shrinkLogo = (file) => new Promise((resolve, reject) => {
  if (file.type === 'image/svg+xml') {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    r.readAsDataURL(file);
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    let size = 512;
    let out = '';
    do {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/png');
      if (out.length > MAX) out = c.toDataURL('image/jpeg', 0.85);
      size = Math.round(size * 0.7);
    } while (out.length > MAX && size >= 64);
    resolve(out);
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
  img.src = url;
});

const LicenseSummary = ({ lic }) => {
  const navigate = useNavigate();
  if (!lic) return null;
  const color = !lic.enabled ? '#71717a' : lic.blocked ? '#FF003C' : lic.warning ? '#FF5E00' : '#39FF14';
  const label = !lic.enabled ? 'Controle de licença desativado' : lic.blocked ? 'Expirada' : lic.warning ? `Vence em ${lic.days_left} dia(s)` : 'Ativa';
  return (
    <div data-testid="branding-license-summary" className="rounded-xl border p-3 flex items-center gap-3 flex-wrap" style={{ borderColor: `${color}55`, background: `${color}0d` }}>
      <BadgeCheck className="w-5 h-5 flex-shrink-0" style={{ color }} />
      <div className="flex-1 min-w-0 text-xs">
        <p className="font-bold text-white">Licença de uso · <span style={{ color }}>{label}</span></p>
        <p className="text-zinc-400">{lic.enabled ? `Pago até ${dateBR(lic.paid_until)} · ciclo de ${lic.ciclo_dias} dias` : 'Ative o controle na página da licença (senha-mestra).'}</p>
      </div>
      <button type="button" data-testid="branding-goto-licenca" onClick={() => navigate('/licenca')} className="px-3 py-1.5 rounded-full border border-[#E0FF00]/40 bg-[#E0FF00]/10 text-[#E0FF00] text-[11px] font-black hover:bg-[#E0FF00]/20 transition-colors">
        Ir para Licença / Pagamento
      </button>
    </div>
  );
};

const LogoPreview = ({ form }) => {
  const { first, rest } = splitName(form.app_name);
  return (
    <div data-testid="branding-preview" className="rounded-xl bg-[#050505] border border-white/10 p-4 flex items-center gap-3">
      <div className="w-12 h-12 flex items-center justify-center">
        {form.logo_data_url
          ? <img src={form.logo_data_url} alt="logo" data-testid="branding-preview-img" className="w-full h-full object-contain rounded-xl bg-white/5" />
          : <div className="w-full h-full rounded-xl" style={{ background: 'linear-gradient(135deg, #E0FF00 0%, #39FF14 50%, #00F0FF 100%)' }} />}
      </div>
      <div>
        <p className="font-heading font-black tracking-tighter text-white leading-none uppercase text-base">{first}</p>
        <p className="font-heading font-bold tracking-[0.3em] leading-none mt-1 uppercase text-[#E0FF00]" style={{ fontSize: '0.55rem' }}>{rest || form.tagline || ''}</p>
      </div>
      <p className="ml-auto text-[10px] text-zinc-500 uppercase tracking-wider">Prévia</p>
    </div>
  );
};

/** Out/2026 · Configurações › Licença & Marca branca (nome/logo protegidos pela senha-mestra). */
export const BrandingPanel = () => {
  const brand = useBranding();
  const lic = useLicense();
  const fileRef = useRef(null);
  const [key, setKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ app_name: brand.app_name, company_name: brand.company_name, tagline: brand.tagline, logo_data_url: brand.logo_data_url });
  useEffect(() => { setForm({ app_name: brand.app_name, company_name: brand.company_name, tagline: brand.tagline, logo_data_url: brand.logo_data_url }); }, [brand]);

  const unlock = async () => {
    if (!key) { toast.error('Informe a senha-mestra'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/licenca/verificar-mestra`, { master_key: key });
      setUnlocked(true);
      toast.success('Senha-mestra confirmada');
    } catch (e) { toast.error(e.response?.data?.detail || 'Senha-mestra inválida'); }
    finally { setBusy(false); }
  };

  const onLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await shrinkLogo(file);
      if (data.length > MAX) { toast.error('Logo maior que 300 KB mesmo após reduzir — use outra imagem'); return; }
      setForm((f) => ({ ...f, logo_data_url: data }));
    } catch (err) { toast.error(err.message || 'Falha ao processar imagem'); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await axios.put(`${API}/branding`, { master_key: key, ...form });
      setBrandingCache(data);
      toast.success('Marca atualizada em todas as telas e PDFs');
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao salvar marca'); if (e.response?.status === 403) setUnlocked(false); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="branding-panel" className="glass-panel rounded-2xl p-5 border border-[#A5A0FF]/25 space-y-4">
      <div className="flex items-center gap-2">
        <Palette className="w-4 h-4 text-[#A5A0FF]" />
        <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#A5A0FF]">Licença & Marca branca</p>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-zinc-500">{unlocked ? <Unlock className="w-3 h-3 text-[#39FF14]" /> : <Lock className="w-3 h-3" />} {unlocked ? 'liberado' : 'protegido'}</span>
      </div>
      <LicenseSummary lic={lic} />
      {!unlocked ? (
        <div className="rounded-xl border border-white/10 p-3 space-y-2">
          <p className="text-xs text-zinc-400">Para alterar o nome e o logotipo exibidos no sistema, informe a <strong className="text-white">senha-mestra</strong> do licenciante.</p>
          {lic && !lic.master_configured && <p className="text-[11px] text-[#FF5E00]">Senha-mestra não configurada no servidor (LICENSE_MASTER_KEY).</p>}
          <div className="flex gap-2 flex-col sm:flex-row">
            <input data-testid="branding-master-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} placeholder="Senha-mestra" className={inp} autoComplete="off" />
            <button type="button" data-testid="branding-unlock" onClick={unlock} disabled={busy} className="px-4 py-2 rounded-full bg-[#E0FF00] text-black text-xs font-black inline-flex items-center justify-center gap-1 disabled:opacity-60 whitespace-nowrap">
              {busy ? <Loader className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} Liberar
            </button>
          </div>
        </div>
      ) : (
        <div data-testid="branding-form" className="space-y-3">
          <LogoPreview form={form} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div><label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Nome do app</label><input data-testid="branding-app-name" value={form.app_name || ''} onChange={(e) => setForm({ ...form, app_name: e.target.value })} maxLength={60} placeholder="Ex.: Hayah Energy" className={`${inp} mt-1`} /></div>
            <div><label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Slogan (2ª linha)</label><input data-testid="branding-tagline" value={form.tagline || ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} maxLength={40} placeholder="Ex.: ENERGY" className={`${inp} mt-1`} /></div>
            <div className="md:col-span-2"><label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Razão social / empresa</label><input data-testid="branding-company-name" value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} maxLength={120} placeholder="Nome da empresa licenciada" className={`${inp} mt-1`} /></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} data-testid="branding-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={onLogo} />
            <button type="button" data-testid="branding-logo-upload" onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-full border border-white/15 bg-white/5 text-white text-[11px] font-bold inline-flex items-center gap-1 hover:bg-white/10"><Upload className="w-3 h-3" /> Enviar logo</button>
            {form.logo_data_url && <button type="button" data-testid="branding-logo-remove" onClick={() => setForm({ ...form, logo_data_url: '' })} className="px-3 py-1.5 rounded-full border border-[#FF003C]/40 bg-[#FF003C]/10 text-[#FF003C] text-[11px] font-bold inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Remover logo</button>}
            <span className="text-[10px] text-zinc-500">PNG/JPG/SVG · reduzido automaticamente para ≤ 300 KB</span>
          </div>
          <div className="flex justify-end">
            <button type="button" data-testid="branding-save" onClick={save} disabled={busy || !form.app_name?.trim()} className="px-5 py-2 rounded-full bg-[#E0FF00] text-black text-xs font-black inline-flex items-center gap-2 disabled:opacity-60">{busy ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar marca</button>
          </div>
        </div>
      )}
    </div>
  );
};
