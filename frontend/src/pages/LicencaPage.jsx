import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, CreditCard, KeyRound, Clock, CalendarCheck, Settings2, LogOut, Loader, History } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { HayahLogo } from '../components/HayahLogo';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../lib/constants';
import { invalidateLicense } from '../lib/license';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const inp = 'w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E0FF00]';

const StatusCard = ({ st }) => {
  const color = !st.enabled ? '#71717a' : st.blocked ? '#FF003C' : st.warning ? '#FF5E00' : '#39FF14';
  const label = !st.enabled ? 'Licença não ativada (uso livre)' : st.blocked ? 'USO EXPIRADO' : st.warning ? `Vence em ${st.days_left} dia(s)` : 'Licença ativa';
  return (
    <div data-testid="licenca-status-card" className="rounded-2xl border p-5" style={{ borderColor: `${color}55`, background: `${color}0d` }}>
      <div className="flex items-center gap-3 flex-wrap">
        {st.blocked ? <ShieldAlert className="w-8 h-8" style={{ color }} /> : <ShieldCheck className="w-8 h-8" style={{ color }} />}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold" style={{ color }}>{label}</p>
          <p className="text-white font-bold text-lg truncate" data-testid="licenca-empresa">{st.empresa || 'Empresa licenciada não informada'}</p>
          {st.cnpj && <p className="text-xs text-zinc-500">CNPJ {st.cnpj}</p>}
        </div>
        <div className="text-right">
          <p className="text-[10px] tracking-widest uppercase font-bold text-zinc-500 inline-flex items-center gap-1"><CalendarCheck className="w-3 h-3" /> Pago até</p>
          <p className="font-mono text-2xl font-black text-white" data-testid="licenca-paid-until">{dateBR(st.paid_until)}</p>
          {st.days_left != null && <p className="text-[11px] font-mono" style={{ color }}>{st.days_left >= 0 ? `${st.days_left} dia(s) restantes` : `expirada há ${-st.days_left} dia(s)`}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4 text-xs">
        <div className="rounded-lg glass-panel p-2"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Ciclo</p><p className="text-white font-bold">{st.ciclo_dias} dias</p></div>
        <div className="rounded-lg glass-panel p-2"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Valor por ciclo</p><p className="text-white font-bold font-mono">{st.valor ? formatCurrency(st.valor) : '—'}</p></div>
        <div className="rounded-lg glass-panel p-2"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Contato</p><p className="text-white font-bold truncate">{st.contato_email || '—'}</p></div>
      </div>
    </div>
  );
};

const MasterPanel = ({ st, onChanged, blocked }) => {
  const [open, setOpen] = useState(!!blocked);
  const [key, setKey] = useState('');
  const [dias, setDias] = useState('');
  const [obs, setObs] = useState('');
  const [cfg, setCfg] = useState({ enabled: st.enabled, empresa: st.empresa, cnpj: st.cnpj, contato_email: st.contato_email, valor: st.valor || '', ciclo_dias: st.ciclo_dias || 30, paid_until: st.paid_until || '' });
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  useEffect(() => { setCfg({ enabled: st.enabled, empresa: st.empresa, cnpj: st.cnpj, contato_email: st.contato_email, valor: st.valor || '', ciclo_dias: st.ciclo_dias || 30, paid_until: st.paid_until || '' }); }, [st]);

  const payOnline = async () => {
    if (!key) { toast.error('Informe a senha-mestra'); return; }
    setPaying(true);
    try {
      const { data } = await axios.post(`${API}/licenca/checkout`, { origin_url: window.location.origin, master_key: key });
      window.location.href = data.checkout_url;
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao iniciar pagamento'); setPaying(false); }
  };
  const pay = async () => {
    if (!key) { toast.error('Informe a senha-mestra'); return; }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/licenca/pagamento-manual`, { master_key: key, dias: dias ? Number(dias) : null, obs });
      toast.success(`Pagamento registrado — pago até ${dateBR(data.paid_until)}`);
      setObs(''); onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
    finally { setBusy(false); }
  };
  const saveCfg = async () => {
    if (!key) { toast.error('Informe a senha-mestra'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/licenca/config`, { master_key: key, ...cfg, valor: cfg.valor === '' ? null : Number(cfg.valor), ciclo_dias: Number(cfg.ciclo_dias) || 30, paid_until: cfg.paid_until || null });
      toast.success('Configuração da licença salva'); onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="licenca-master-panel" className="rounded-2xl glass-panel p-4">
      <button type="button" data-testid="licenca-master-toggle" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        <KeyRound className="w-4 h-4 text-[#E0FF00]" />
        <p className="flex-1 text-[10px] tracking-[0.2em] uppercase font-bold text-[#E0FF00]">Área do licenciante (senha-mestra)</p>
        <span className="text-[10px] text-zinc-500">{open ? 'ocultar' : 'abrir'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {!st.master_configured && <p className="text-[11px] text-[#FF5E00]">Senha-mestra não configurada no servidor (LICENSE_MASTER_KEY). Defina-a nos segredos da publicação.</p>}
          <input data-testid="licenca-master-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Senha-mestra" className={inp} autoComplete="off" />
          {st.stripe_enabled && (
            <div data-testid="licenca-stripe-box" className="rounded-xl border border-[#635BFF]/40 bg-[#635BFF]/10 p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <CreditCard className="w-6 h-6 text-[#A5A0FF] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm">Pagar online (cartão · Stripe)</p>
                  <p className="text-xs text-zinc-400">Libera +{st.ciclo_dias} dias automaticamente após a confirmação · {st.valor ? formatCurrency(st.valor) : 'defina o valor por ciclo abaixo'}</p>
                </div>
              </div>
              <button type="button" data-testid="licenca-pay-online" onClick={payOnline} disabled={paying || !st.valor || !key} className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[#635BFF] text-white text-xs font-black inline-flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap">{paying ? <Loader className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} Pagar {st.valor ? formatCurrency(st.valor) : ''}</button>
            </div>
          )}
          <div className="rounded-xl border border-[#39FF14]/30 p-3 space-y-2">
            <p className="text-[10px] tracking-[0.15em] uppercase font-bold text-[#39FF14]">Registrar pagamento recebido</p>
            <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-2">
              <input data-testid="licenca-manual-dias" type="number" min="1" value={dias} onChange={(e) => setDias(e.target.value)} placeholder={`+${st.ciclo_dias} dias`} className={inp} />
              <input data-testid="licenca-manual-obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (PIX, boleto, nº do comprovante…)" className={inp} />
              <button type="button" data-testid="licenca-manual-pay" onClick={pay} disabled={busy} className="px-4 py-2 rounded-full bg-[#39FF14] text-black text-xs font-black inline-flex items-center justify-center gap-1 disabled:opacity-60">{busy ? <Loader className="w-3 h-3 animate-spin" /> : <CalendarCheck className="w-3 h-3" />} Liberar +{dias || st.ciclo_dias} dias</button>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 p-3 space-y-2">
            <p className="text-[10px] tracking-[0.15em] uppercase font-bold text-zinc-400 inline-flex items-center gap-1"><Settings2 className="w-3 h-3" /> Configuração da licença</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input data-testid="licenca-cfg-empresa" value={cfg.empresa || ''} onChange={(e) => setCfg({ ...cfg, empresa: e.target.value })} placeholder="Empresa licenciada" className={inp} />
              <input data-testid="licenca-cfg-cnpj" value={cfg.cnpj || ''} onChange={(e) => setCfg({ ...cfg, cnpj: e.target.value })} placeholder="CNPJ" className={inp} />
              <input data-testid="licenca-cfg-email" value={cfg.contato_email || ''} onChange={(e) => setCfg({ ...cfg, contato_email: e.target.value })} placeholder="E-mail de contato" className={inp} />
              <input data-testid="licenca-cfg-valor" type="number" min="0" step="0.01" value={cfg.valor} onChange={(e) => setCfg({ ...cfg, valor: e.target.value })} placeholder="Valor por ciclo (R$)" className={inp} />
              <input data-testid="licenca-cfg-ciclo" type="number" min="1" max="365" value={cfg.ciclo_dias} onChange={(e) => setCfg({ ...cfg, ciclo_dias: e.target.value })} placeholder="Ciclo (dias)" className={inp} />
              <input data-testid="licenca-cfg-paid-until" type="date" value={cfg.paid_until} onChange={(e) => setCfg({ ...cfg, paid_until: e.target.value })} className={inp} title="Pago até (ajuste manual)" />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300"><input data-testid="licenca-cfg-enabled" type="checkbox" checked={!!cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="accent-[#E0FF00]" /> Controle de licença ativo (bloqueia o app quando vencer)</label>
            <div><button type="button" data-testid="licenca-cfg-save" onClick={saveCfg} disabled={busy} className="px-4 py-2 rounded-full bg-[#E0FF00] text-black text-xs font-black disabled:opacity-60">Salvar configuração</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

const HistoryList = ({ history }) => (
  <div data-testid="licenca-history" className="rounded-2xl glass-panel p-4">
    <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 inline-flex items-center gap-1 mb-2"><History className="w-3 h-3" /> Histórico</p>
    {history.length === 0 ? <p className="text-xs text-zinc-600 italic">Sem lançamentos.</p> : history.map((h, i) => (
      <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-white/5 last:border-0 flex-wrap">
        <span className="font-mono text-zinc-500">{new Date(h.at).toLocaleString('pt-BR')}</span>
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${h.method === 'stripe' ? 'bg-[#635BFF]/20 text-[#A5A0FF]' : h.method === 'manual' ? 'bg-[#39FF14]/15 text-[#39FF14]' : 'bg-white/5 text-zinc-400'}`}>{h.method === 'stripe' ? 'ONLINE' : h.method === 'manual' ? 'MANUAL' : 'CONFIG'}</span>
        {h.days ? <span className="text-white">+{h.days} dias → até {dateBR(h.until)}</span> : null}
        <span className="text-zinc-400 truncate">{h.obs}</span>
        {h.by && <span className="text-zinc-600">· {h.by}</span>}
      </div>
    ))}
  </div>
);

const Body = ({ st, reload, blocked }) => (
  <div className="space-y-4">
    <StatusCard st={st} />
    {blocked && (
      <div data-testid="licenca-blocked-msg" className="rounded-2xl border border-[#FF003C]/50 bg-[#FF003C]/10 p-4 text-sm text-white">
        <p className="font-bold">O uso do sistema está suspenso.</p>
        <p className="text-zinc-300 text-xs mt-1">A licença venceu em {dateBR(st.paid_until)}. Regularize o pagamento para liberar imediatamente o acesso de todos os usuários. Seus dados estão preservados.</p>
      </div>
    )}
    <MasterPanel st={st} onChanged={reload} blocked={blocked} />
    <HistoryList history={st.history || []} />
    <p className="text-xs text-zinc-500 italic">O pagamento online (Stripe) e a configuração da licença exigem a senha-mestra do licenciante. Fale com o responsável pela plataforma.</p>
  </div>
);

/** Out/2026 · Licença de uso (cópia white-label): status, pagamento online/manual, bloqueio ao expirar. */
export const LicencaPage = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [st, setSt] = useState(null);
  const reload = () => axios.get(`${API}/licenca/status`).then(({ data }) => { setSt(data); invalidateLicense(); }).catch(() => setSt({ enabled: false, history: [] }));
  useEffect(() => { reload(); }, []);
  if (!st) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Loader className="w-6 h-6 animate-spin text-[#E0FF00]" /></div>;
  const blocked = st.blocked || params.get('bloqueado') === '1';
  if (blocked && st.blocked) {
    return (
      <div data-testid="licenca-blocked-screen" className="min-h-screen bg-[#050505] text-white">
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <HayahLogo size="lg" showText />
            <button type="button" data-testid="licenca-logout" onClick={async () => { await logout(); navigate('/login'); }} className="text-xs text-zinc-400 inline-flex items-center gap-1 hover:text-white"><LogOut className="w-4 h-4" /> Sair</button>
          </div>
          <h1 className="text-3xl font-heading font-black tracking-tighter inline-flex items-center gap-2"><Clock className="w-7 h-7 text-[#FF003C]" /> Uso expirado — regularize o pagamento</h1>
          <Body st={st} reload={reload} blocked />
        </div>
      </div>
    );
  }
  return (
    <AppLayout title="Licença de uso" subtitle="Ciclo de pagamento, validade e marca da empresa">
      <div className="max-w-3xl space-y-4">
        <Body st={st} reload={reload} blocked={false} />
      </div>
    </AppLayout>
  );
};

export default LicencaPage;
