import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Bell, BellOff, BellRing, Smartphone, Mail, MessageCircle, Send, CalendarClock, DollarSign, Package, Clock, History } from 'lucide-react';
import { isPushSupported, currentPushStatus, subscribeToPush, unsubscribeFromPush } from '../lib/push';
import { PushBlockedHelpModal } from './PushBlockedHelpModal';
import { openWhatsApp } from '../lib/whatsapp';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const KINDS = [
  { key: 'vencidas', label: 'Obras vencidas', hint: 'Obras com Data Vencimento passada (exclui concluídas, suspensas e canceladas)', icon: CalendarClock, color: '#FF003C' },
  { key: 'faturamento', label: 'Faturamento preso', hint: 'Obras paradas no mesmo estágio da esteira há mais de N dias', icon: DollarSign, color: '#FF5E00' },
  { key: 'estoque', label: 'Estoque baixo', hint: 'Itens no mínimo (crítico) ou até X% acima do mínimo (perto de zero)', icon: Package, color: '#E0FF00' },
];
const CHANNELS = [['push', 'Push celular', Smartphone], ['email', 'E-mail', Mail], ['whatsapp', 'WhatsApp', MessageCircle]];
const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const PushDevice = ({ devices }) => {
  const [status, setStatus] = useState('loading');
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { (async () => setStatus((await isPushSupported()) ? await currentPushStatus() : 'unsupported'))(); }, []);
  const enable = async () => {
    if (Notification.permission === 'denied') { setHelpOpen(true); return; }
    try { await subscribeToPush(); setStatus('subscribed'); toast.success('Push ativado neste celular/navegador'); } catch (e) {
      if ((e?.message || '').toLowerCase().includes('bloquead')) setHelpOpen(true); else toast.error(e.message || 'Não foi possível ativar');
    }
  };
  const disable = async () => { await unsubscribeFromPush(); setStatus('default'); toast.info('Push desativado neste dispositivo'); };
  const test = async () => { try { const { data } = await axios.post(`${API}/push/test`); toast.success(`Push de teste enviado para ${data.sent} dispositivo(s)`); } catch { toast.error('Falha no teste'); } };
  const on = status === 'subscribed';
  return (
    <div data-testid="notif-push-device" className={`rounded-xl border p-3 flex items-center gap-3 flex-wrap ${on ? 'border-[#39FF14]/40 bg-[#39FF14]/[0.05]' : 'border-[#FF5E00]/40 bg-[#FF5E00]/[0.05]'}`}>
      {on ? <BellRing className="w-5 h-5 text-[#39FF14]" /> : <BellOff className="w-5 h-5 text-[#FF5E00]" />}
      <div className="flex-1 min-w-[180px]">
        <p className="text-sm font-bold text-white">{on ? 'Este dispositivo recebe push' : status === 'unsupported' ? 'Navegador sem suporte a push' : 'Push desligado neste dispositivo'}</p>
        <p className="text-[10px] text-zinc-500">{devices} dispositivo(s) ativo(s) no workspace · no iPhone adicione o app à Tela de Início antes de ativar</p>
      </div>
      {on ? (
        <>
          <button data-testid="notif-push-test" onClick={test} className="text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15 text-zinc-300 hover:bg-white/10">Testar push</button>
          <button data-testid="notif-push-disable" onClick={disable} className="text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15 text-zinc-400 hover:bg-white/10">Desativar aqui</button>
        </>
      ) : status !== 'unsupported' && (
        <button data-testid="notif-push-enable" onClick={enable} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600]"><Bell className="w-3.5 h-3.5" /> Ativar push neste celular</button>
      )}
      <PushBlockedHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
};

const KindCard = ({ k, cfg, preview, lastSent, integ, onChange, onTest, testing }) => {
  const Icon = k.icon;
  const n = preview?.count ?? null;
  const ready = { push: true, email: integ?.email_ready, whatsapp: integ?.whatsapp_ready };
  return (
    <div data-testid={`notif-card-${k.key}`} className="glass-panel rounded-2xl p-4 border border-white/10 border-l-4 space-y-3" style={{ borderLeftColor: k.color }}>
      <div className="flex items-start gap-3 flex-wrap">
        <Icon className="w-5 h-5 mt-0.5" style={{ color: k.color }} />
        <div className="flex-1 min-w-[160px]">
          <p className="text-sm font-black text-white">{k.label}</p>
          <p className="text-[10px] text-zinc-500">{k.hint}</p>
        </div>
        <div className="text-right">
          <p data-testid={`notif-count-${k.key}`} className="font-mono text-2xl font-black leading-none" style={{ color: n ? k.color : '#39FF14' }}>{n ?? '…'}</p>
          <p className="text-[9px] uppercase tracking-wider text-zinc-500">em alerta agora</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input data-testid={`notif-enabled-${k.key}`} type="checkbox" checked={!!cfg.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} className="w-4 h-4 accent-[#E0FF00]" />
          <span className="text-[11px] font-bold text-zinc-300">{cfg.enabled ? 'Ativo' : 'Desligado'}</span>
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block">Horário diário</label>
          <input data-testid={`notif-time-${k.key}`} type="time" value={cfg.time || '08:00'} onChange={(e) => onChange({ time: e.target.value })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
        </div>
        {k.key === 'faturamento' && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block">Dias parado ≥</label>
            <input data-testid="notif-threshold-faturamento" type="number" min="1" value={cfg.threshold_days ?? 15} onChange={(e) => onChange({ threshold_days: parseInt(e.target.value, 10) || 1 })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
          </div>
        )}
        {k.key === 'estoque' && (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block">Perto do mínimo (%)</label>
              <input data-testid="notif-nearpct-estoque" type="number" min="0" max="500" value={cfg.near_pct ?? 20} onChange={(e) => onChange({ near_pct: parseFloat(e.target.value) || 0 })} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none pb-2">
              <input data-testid="notif-instant-estoque" type="checkbox" checked={!!cfg.instant} onChange={(e) => onChange({ instant: e.target.checked })} className="w-4 h-4 accent-[#E0FF00]" />
              <span className="text-[11px] text-zinc-300">Push imediato ao atingir o mínimo</span>
            </label>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Canais:</span>
        {CHANNELS.map(([c, l, I]) => (
          <label key={c} data-testid={`notif-channel-${k.key}-${c}`} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold cursor-pointer select-none ${cfg.channels?.[c] ? 'border-[#E0FF00] bg-[#E0FF00] text-black' : 'border-white/10 text-zinc-500'} ${ready[c] ? '' : 'opacity-60'}`} title={ready[c] ? '' : 'Configure a integração abaixo'}>
            <input type="checkbox" className="hidden" checked={!!cfg.channels?.[c]} onChange={(e) => onChange({ channels: { ...cfg.channels, [c]: e.target.checked } })} />
            <I className="w-3 h-3" /> {l}{!ready[c] && <span className="text-[9px] text-[#FF5E00]">· não configurado</span>}
          </label>
        ))}
        <span className="ml-auto text-[10px] text-zinc-500 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> último envio: <b className="text-zinc-300" data-testid={`notif-lastsent-${k.key}`}>{lastSent || 'nunca'}</b></span>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button data-testid={`notif-test-${k.key}`} disabled={testing} onClick={onTest} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600] disabled:opacity-40"><Send className="w-3.5 h-3.5" /> {testing ? 'Enviando…' : 'Testar agora'}</button>
        <button data-testid={`notif-wa-${k.key}`} disabled={!preview} onClick={() => openWhatsApp(preview.whatsapp_text)} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-[#25D366]/50 text-[#25D366] hover:bg-[#25D366]/10 disabled:opacity-40"><MessageCircle className="w-3.5 h-3.5" /> Enviar resumo no WhatsApp</button>
      </div>
    </div>
  );
};

export const NotificationCenter = () => {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [log, setLog] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p, l] = await Promise.all([axios.get(`${API}/notifications/settings`), axios.get(`${API}/notifications/preview`), axios.get(`${API}/notifications/log?limit=12`)]);
      setData(s.data); setPreview(p.data); setLog(l.data); setDirty(false);
    } catch { toast.error('Falha ao carregar notificações'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const change = (kind, patch) => { setData((d) => ({ ...d, settings: { ...d.settings, [kind]: { ...d.settings[kind], ...patch } } })); setDirty(true); };
  const save = async () => {
    setSaving(true);
    try { await axios.put(`${API}/notifications/settings`, data.settings); toast.success('Notificações salvas'); setDirty(false); } catch (e) { toast.error(e?.response?.data?.detail || 'Falha ao salvar'); } finally { setSaving(false); }
  };
  const test = async (kind) => {
    setTesting(kind);
    try {
      if (dirty) await axios.put(`${API}/notifications/settings`, data.settings);
      const { data: r } = await axios.post(`${API}/notifications/test/${kind}`, {});
      const parts = Object.entries(r.results).map(([c, v]) => `${c}: ${v.status}${v.sent !== undefined ? ` (${v.sent})` : ''}${v.reason ? ` (${v.reason})` : ''}`);
      toast.success(`${r.title} · ${parts.join(' · ')}`, { duration: 7000 });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Falha no teste'); } finally { setTesting(''); }
  };

  if (!data) return <div className="glass-panel rounded-2xl p-6 text-zinc-500 text-sm">Carregando central de notificações…</div>;
  return (
    <div data-testid="notification-center" className="space-y-4">
      <div className="glass-panel rounded-2xl p-4 border border-[#E0FF00]/25 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-full bg-[#E0FF00]/10 border border-[#E0FF00]/40 flex items-center justify-center"><Bell className="w-5 h-5 text-[#E0FF00]" /></div>
          <div className="flex-1">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Central de Notificações</p>
            <p className="text-white font-bold">Alertas diários no celular, e-mail e WhatsApp</p>
          </div>
          <button data-testid="notif-save" disabled={!dirty || saving} onClick={save} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600] disabled:opacity-40">{saving ? 'Salvando…' : dirty ? 'Salvar alterações' : 'Salvo'}</button>
        </div>
        <PushDevice devices={data.push_devices} />
      </div>
      <div className="grid grid-cols-1 gap-3">
        {KINDS.map((k) => <KindCard key={k.key} k={k} cfg={data.settings[k.key]} preview={preview?.[k.key]} lastSent={data.last_sent?.[k.key]} integ={data.integrations} onChange={(p) => change(k.key, p)} onTest={() => test(k.key)} testing={testing === k.key} />)}
      </div>
      <div className="glass-panel rounded-2xl p-4 border border-white/10">
        <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2 flex items-center gap-1"><History className="w-3.5 h-3.5" /> Últimos envios</p>
        {log.length === 0 ? <p className="text-[11px] text-zinc-500 italic">Nenhum envio ainda.</p> : (
          <ul data-testid="notif-log" className="divide-y divide-white/5 text-[11px]">
            {log.map((e, i) => (
              <li key={i} className="py-1.5 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-zinc-500">{fmtAt(e.at)}</span>
                <span className="text-white font-bold">{e.title}</span>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-white/5 text-zinc-400">{e.trigger}</span>
                <span className="text-zinc-500 ml-auto">{Object.entries(e.results || {}).map(([c, v]) => `${c} ${v.status}${v.sent !== undefined ? ` ${v.sent}` : ''}`).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
