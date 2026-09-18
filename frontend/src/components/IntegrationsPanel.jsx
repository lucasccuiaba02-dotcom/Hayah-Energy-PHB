import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Plug, Mail, MessageCircle, Save, Send, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const input = 'w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none';
const label = 'text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block';

const Status = ({ ok, testid, on, off }) => (
  <span data-testid={testid} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${ok ? 'bg-[#39FF14]/15 text-[#39FF14] border border-[#39FF14]/40' : 'bg-[#FF5E00]/15 text-[#FF5E00] border border-[#FF5E00]/40'}`}>
    {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />} {ok ? on : off}
  </span>
);

const Field = ({ k, l, form, setForm, fromEnv, type = 'text', hint, className = '' }) => (
  <div className={className}>
    <label className={label}>{l}{fromEnv?.[k] && <span className="ml-1 text-[#00F0FF] normal-case">· vindo do servidor</span>}</label>
    <input data-testid={`integ-${k}`} type={type} value={form[k] || ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={input} placeholder={hint} autoComplete="off" />
  </div>
);

export const IntegrationsPanel = () => {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState({ email: '', wa: '' });
  const [busy, setBusy] = useState('');

  const load = async () => {
    try { const { data: d } = await axios.get(`${API}/integrations`); setData(d); setForm(d.values); } catch (e) { if (e?.response?.status !== 403) toast.error('Falha ao carregar integrações'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try { await axios.put(`${API}/integrations`, form); toast.success('Integrações salvas'); await load(); } catch (e) { toast.error(e?.response?.data?.detail || 'Falha ao salvar'); } finally { setSaving(false); }
  };
  const test = async (kind) => {
    setBusy(kind);
    try {
      const { data: r } = await axios.post(`${API}/integrations/test-${kind}`, { to: kind === 'email' ? testTo.email : testTo.wa });
      toast.success(kind === 'email' ? `E-mail de teste enviado para ${(r.to || []).join(', ')}` : `WhatsApp enviado: ${(r.results || []).filter((x) => x.status === 'sent').length} ok`);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Falha no teste'); } finally { setBusy(''); }
  };

  if (!data) return null;
  const st = data.status;
  return (
    <div data-testid="integrations-panel" className="glass-panel rounded-2xl p-5 border border-white/10 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[#00F0FF]/10 border border-[#00F0FF]/40 flex items-center justify-center"><Plug className="w-5 h-5 text-[#00F0FF]" /></div>
        <div className="flex-1">
          <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#00F0FF]">Integrações (admin)</p>
          <p className="text-white font-bold">E-mail (Resend) e WhatsApp (Twilio)</p>
        </div>
        <button data-testid="integ-save" disabled={saving} onClick={save} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600] disabled:opacity-40"><Save className="w-3.5 h-3.5" /> {saving ? 'Salvando…' : 'Salvar integrações'}</button>
      </div>

      <div className="rounded-xl border border-white/10 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Mail className="w-4 h-4 text-[#E0FF00]" /><p className="text-sm font-bold text-white flex-1">E-mail · Resend</p>
          <Status ok={st.email_ready} testid="integ-email-status" on="Ativo" off="Sem chave" />
          <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="text-[10px] text-[#00F0FF] inline-flex items-center gap-1 underline">API keys <ExternalLink className="w-3 h-3" /></a>
          <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="text-[10px] text-[#00F0FF] inline-flex items-center gap-1 underline">Domínios <ExternalLink className="w-3 h-3" /></a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field k="resend_api_key" l="Chave da API (re_…)" form={form} setForm={setForm} fromEnv={data.from_env} type="password" hint="re_xxxxxxxxx" />
          <Field k="sender_email" l="Remetente" form={form} setForm={setForm} fromEnv={data.from_env} hint="Hayah Energy <noreply@hayahenergy.com.br>" />
          <Field k="notification_emails" l="E-mails de notificação (separar por vírgula)" form={form} setForm={setForm} fromEnv={data.from_env} hint="gestor@empresa.com, financeiro@empresa.com" />
          <Field k="warehouse_email" l="E-mail do almoxarifado (requisições)" form={form} setForm={setForm} fromEnv={data.from_env} hint="almoxarifado@empresa.com" />
        </div>
        <p className="text-[10px] text-zinc-500">Domínio não verificado? Use temporariamente <code className="text-zinc-300">onboarding@resend.dev</code> como remetente — só entrega para o e-mail da sua conta Resend. Para enviar a qualquer destinatário, verifique o domínio (SPF/DKIM) em Domínios.</p>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]"><label className={label}>Enviar teste para (opcional)</label><input data-testid="integ-test-email-to" value={testTo.email} onChange={(e) => setTestTo((t) => ({ ...t, email: e.target.value }))} className={input} placeholder="deixe vazio = e-mails de notificação" /></div>
          <button data-testid="integ-test-email" disabled={busy === 'email'} onClick={() => test('email')} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-2 rounded-full border border-white/15 text-zinc-300 hover:bg-white/10 disabled:opacity-40"><Send className="w-3.5 h-3.5" /> {busy === 'email' ? 'Enviando…' : 'Testar e-mail'}</button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <MessageCircle className="w-4 h-4 text-[#25D366]" /><p className="text-sm font-bold text-white flex-1">WhatsApp automático · Twilio</p>
          <Status ok={st.whatsapp_ready} testid="integ-wa-status" on="Ativo" off="Sem credenciais" />
          <a href="https://console.twilio.com/" target="_blank" rel="noreferrer" className="text-[10px] text-[#00F0FF] inline-flex items-center gap-1 underline">Console Twilio <ExternalLink className="w-3 h-3" /></a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field k="twilio_account_sid" l="Account SID (AC…)" form={form} setForm={setForm} fromEnv={data.from_env} hint="ACxxxxxxxx" />
          <Field k="twilio_auth_token" l="Auth Token" form={form} setForm={setForm} fromEnv={data.from_env} type="password" />
          <Field k="twilio_whatsapp_from" l="Número remetente WhatsApp" form={form} setForm={setForm} fromEnv={data.from_env} hint="+14155238886 (sandbox) ou seu número aprovado" />
          <Field k="whatsapp_numbers" l="Números que recebem os alertas (com DDI, separar por vírgula)" form={form} setForm={setForm} fromEnv={data.from_env} hint="5565999998888, 5565988887777" />
        </div>
        <p className="text-[10px] text-zinc-500">Sem Twilio, os botões verdes "WhatsApp" do sistema continuam funcionando com mensagem pronta (abre o seu WhatsApp). No sandbox da Twilio cada número precisa enviar "join &lt;código&gt;" para o número sandbox antes de receber.</p>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]"><label className={label}>Enviar teste para (opcional)</label><input data-testid="integ-test-wa-to" value={testTo.wa} onChange={(e) => setTestTo((t) => ({ ...t, wa: e.target.value }))} className={input} placeholder="deixe vazio = números cadastrados" /></div>
          <button data-testid="integ-test-wa" disabled={busy === 'whatsapp'} onClick={() => test('whatsapp')} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-2 rounded-full border border-[#25D366]/50 text-[#25D366] hover:bg-[#25D366]/10 disabled:opacity-40"><Send className="w-3.5 h-3.5" /> {busy === 'whatsapp' ? 'Enviando…' : 'Testar WhatsApp'}</button>
        </div>
      </div>
    </div>
  );
};
