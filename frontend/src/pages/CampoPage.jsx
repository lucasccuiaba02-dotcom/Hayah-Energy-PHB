import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Camera, ShieldCheck, FolderOpen, Info, MapPin, Zap, AlertTriangle, Package, RefreshCw, Wifi, WifiOff, UploadCloud, CheckCircle2, Navigation, Flag, Users } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { useAuth } from '../contexts/AuthContext';
import { PROJECT_TYPE_LABEL } from '../lib/constants';
import { enqueue, getQueue, syncQueue } from '../lib/offline';
import { getQueuedPhotoCount, syncPhotoQueue } from '../lib/photoQueue';
import { savePacote, loadPacote, updateProjectInPacote } from '../lib/campoStore';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TURNOS = [['manha', 'Manhã'], ['tarde', 'Tarde'], ['integral', 'Integral'], ['noturno', 'Noturno']];
const STATUS = [['a_caminho', 'A caminho', Navigation, '#00F0FF'], ['no_local', 'No local', CheckCircle2, '#39FF14'], ['concluido', 'Concluído', Flag, '#E0FF00']];
const STAGE = { enviada: ['Requisição enviada', '#00F0FF'], separado: ['Material separado', '#39FF14'], parcial: ['Separado parcial', '#FF5E00'], pendencia: ['Pendência almoxarifado', '#FF003C'], recebido: ['Recebido na obra', '#E0FF00'] };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

const Action = ({ testid, icon: Icon, label, color, onClick }) => (
  <button data-testid={testid} onClick={onClick} className="rounded-2xl p-4 flex flex-col items-center justify-center gap-2 border transition active:scale-95" style={{ background: `${color}14`, borderColor: `${color}55` }}>
    <Icon className="w-7 h-7" style={{ color }} />
    <span className="text-[11px] font-black uppercase tracking-wider text-white">{label}</span>
  </button>
);

const CampoCard = ({ p, user, online, onCheckin, onReceipt, navigate }) => {
  const mine = [...(p.checkins_today || [])].filter((c) => !user || c.by_email === user.email || c.by_name === user.name).pop() || (p.checkins_today || []).slice(-1)[0];
  const [shift, setShift] = useState(mine?.shift || 'integral');
  const req = p.last_requisition;
  const stage = req ? STAGE[req.stage] || STAGE.enviada : null;
  const hotToday = p.hot_line_today ?? p.requires_hot_line;
  const aprHref = hotToday && (user?.hot_line_team ?? true) ? 'viva' : '1';
  return (
    <div data-testid={`campo-project-${p.id}`} className="glass-panel rounded-2xl overflow-hidden border border-white/10">
      <div className="p-4 space-y-1">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {p.project_code && <p className="font-mono text-xs text-[#E0FF00]">{p.project_code}</p>}
            <h3 className="text-white font-black text-lg leading-tight">{p.name}</h3>
            <p className="text-xs text-zinc-500">{PROJECT_TYPE_LABEL[p.project_type] || p.project_type} · {(p.teams_today || []).join(' + ')}</p>
          </div>
          {mine && <span data-testid={`campo-checkin-state-${p.id}`} className="px-2 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap" style={{ color: STATUS.find((s) => s[0] === mine.status)?.[3], borderColor: `${STATUS.find((s) => s[0] === mine.status)?.[3]}55` }}>{STATUS.find((s) => s[0] === mine.status)?.[1]} · {TURNOS.find((t) => t[0] === mine.shift)?.[1]} · {hhmm(mine.at)}</span>}
        </div>
        {p.location && <p className="text-xs text-zinc-300 flex items-start gap-1"><MapPin className="w-3 h-3 mt-0.5 text-zinc-500" /> {p.location}</p>}
        <div className="flex gap-1 flex-wrap pt-1">
          {hotToday && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF003C]/15 text-[#FF003C] border border-[#FF003C]/40 inline-flex items-center gap-1"><Zap className="w-3 h-3" /> LINHA VIVA HOJE</span>}
          {(p.shutdown_today || p.shutdown_info) && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E0FF00]/15 text-[#E0FF00] border border-[#E0FF00]/40 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> DESLIGAMENTO{p.shutdown_today ? ' HOJE' : ''}</span>}
          {p.aprs?.total > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-zinc-300 border border-white/10">{p.aprs.total} APR{p.aprs.total > 1 ? 's' : ''}</span>}
          {(p.photos || []).length > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-zinc-300 border border-white/10">{p.photos.length} fotos</span>}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 px-4">
        <Action testid={`campo-camera-${p.id}`} icon={Camera} label="Câmera" color="#E0FF00" onClick={() => navigate(`/projeto/${p.id}?camera=1`)} />
        <Action testid={`campo-apr-${p.id}`} icon={ShieldCheck} label={aprHref === 'viva' ? 'APR LV' : 'APR'} color={aprHref === 'viva' ? '#FF003C' : '#39FF14'} onClick={() => navigate(`/projeto/${p.id}?apr=${aprHref}`)} />
        <Action testid={`campo-docs-${p.id}`} icon={FolderOpen} label="Docs" color="#00F0FF" onClick={() => navigate(`/projeto/${p.id}?tab=arquivos`)} />
        <Action testid={`campo-info-${p.id}`} icon={Info} label="Obra" color="#FF5E00" onClick={() => navigate(`/projeto/${p.id}`)} />
      </div>

      <div className="p-4 space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2 flex items-center gap-1"><Users className="w-3 h-3" /> Check-in da equipe · turno e obra</p>
          <div className="grid grid-cols-4 gap-1 mb-2">
            {TURNOS.map(([k, l]) => <button key={k} data-testid={`campo-turno-${p.id}-${k}`} onClick={() => setShift(k)} className={`py-1.5 rounded-lg text-[10px] font-bold uppercase ${shift === k ? 'bg-white text-black' : 'bg-white/5 border border-white/10 text-zinc-400'}`}>{l}</button>)}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {STATUS.map(([k, l, I, c]) => (
              <button key={k} data-testid={`campo-checkin-${p.id}-${k}`} onClick={() => onCheckin(p, shift, k)} className="py-2.5 rounded-xl text-[11px] font-black inline-flex items-center justify-center gap-1 border active:scale-95" style={mine?.status === k ? { background: c, color: '#000', borderColor: c } : { color: c, borderColor: `${c}55`, background: `${c}10` }}>
                <I className="w-3.5 h-3.5" /> {l}
              </button>
            ))}
          </div>
          {(p.checkins_today || []).length > 0 && <p className="text-[10px] text-zinc-500 mt-2">{p.checkins_today.map((c) => `${c.by_name} · ${STATUS.find((s) => s[0] === c.status)?.[1]} ${hhmm(c.at)}`).join(' | ')}</p>}
        </div>

        <div data-testid={`campo-material-${p.id}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-zinc-400" />
            <p className="text-sm font-bold text-white flex-1">Material</p>
            {stage ? <span data-testid={`campo-material-stage-${p.id}`} className="px-2 py-0.5 rounded-full text-[10px] font-bold border" style={{ color: stage[1], borderColor: `${stage[1]}55`, background: `${stage[1]}12` }}>{stage[0]}</span> : <span className="text-[10px] text-zinc-500">sem requisição</span>}
          </div>
          {req && (
            <div className="mt-2 text-[11px] text-zinc-400 space-y-0.5">
              <p>Requisição {req.requisition_type === 'parcial' ? `parcial #${req.seq}` : 'total'} · {req.items_count} item(ns) · enviada {req.created_at?.slice(0, 10).split('-').reverse().join('/')}{req.warehouse_response?.responsible ? ` · separado por ${req.warehouse_response.responsible}` : ''}</p>
              {req.warehouse_response?.notes && <p className="text-zinc-300">"{req.warehouse_response.notes}"</p>}
              {req.warehouse_response?.missing_items && <p className="text-[#FF003C]">Faltam: {req.warehouse_response.missing_items}</p>}
              {req.receipt && <p className="text-[#E0FF00]">Recebido por {req.receipt.receiver_name || req.receipt.received_by || '—'} em {hhmm(req.receipt.received_at)}</p>}
            </div>
          )}
          {req && !req.receipt && ['separado', 'parcial'].includes(req.stage) && (
            <button data-testid={`campo-material-confirm-${p.id}`} onClick={() => onReceipt(p, req)} className="mt-2 w-full py-2 rounded-xl bg-[#39FF14] text-black text-[11px] font-black uppercase tracking-wider active:scale-95">Confirmar material recebido</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default function CampoPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pacote, setPacote] = useState(() => loadPacote());
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(0);
  const [fromCache, setFromCache] = useState(false);

  const refreshPending = useCallback(async () => setPending(getQueue().length + (await getQueuedPhotoCount().catch(() => 0))), []);

  // Set/2026 · aquece o cache do Service Worker: página da obra, checklist, APRs, equipes e fotos ficam disponíveis offline
  const prefetch = useCallback((data) => {
    const urls = [`${API}/teams`];
    (data.projects || []).forEach((p) => {
      urls.push(`${API}/projects/${p.id}`, `${API}/operacional/checklist/${p.id}`, `${API}/projects/${p.id}/aprs`);
      (p.photos || []).slice(0, 40).forEach((ph) => {
        if (ph.data_url && !ph.data_url.startsWith('data:')) { const img = new Image(); img.src = ph.data_url; }
      });
    });
    urls.forEach((u) => axios.get(u).catch(() => {}));
  }, []);

  const load = useCallback(async () => {
    if (!navigator.onLine) { const c = loadPacote(); setPacote(c); setFromCache(true); return; }
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/campo/hoje`);
      setPacote(savePacote(data)); setFromCache(false);
      prefetch(data);
    } catch {
      const c = loadPacote(); if (c) { setPacote(c); setFromCache(true); } else toast.error('Falha ao carregar programação');
    } finally { setLoading(false); }
  }, [prefetch]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const r = await syncQueue(axios, API);
    const ph = await syncPhotoQueue(axios, API, null, { force: true }).catch(() => ({ synced: 0 }));
    if (r.synced || ph.synced) toast.success(`${r.synced + (ph.synced || 0)} registro(s) offline sincronizado(s)`);
    await refreshPending();
    await load();
  }, [load, refreshPending]);

  useEffect(() => {
    load(); refreshPending();
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    if (navigator.onLine) sync();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [load, sync, refreshPending]);

  const onCheckin = async (p, shift, status) => {
    const body = { project_id: p.id, date: pacote?.date, shift, status, client_ts: new Date().toISOString() };
    const local = { by_name: user?.name, by_email: user?.email, shift, status, at: new Date().toISOString(), project_id: p.id };
    const apply = (list) => { updateProjectInPacote(p.id, { checkins_today: list }); setPacote(loadPacote()); };
    if (!navigator.onLine) {
      enqueue({ type: 'checkin', projectId: p.id, data: body });
      apply([...(p.checkins_today || []).filter((c) => c.by_email !== user?.email), local]);
      toast.info('Check-in salvo offline — sincroniza ao voltar o sinal'); refreshPending(); return;
    }
    try {
      const { data } = await axios.post(`${API}/campo/checkin`, body);
      apply(data.checkins_today);
      toast.success(`${data.status_label} · ${data.turno_label}`);
    } catch (e) {
      if (!e?.response) { enqueue({ type: 'checkin', projectId: p.id, data: body }); apply([...(p.checkins_today || []), local]); toast.info('Sem sinal — check-in na fila'); refreshPending(); }
      else toast.error(e?.response?.data?.detail || 'Falha no check-in');
    }
  };

  const onReceipt = async (p, req) => {
    const receiver = window.prompt('Quem recebeu o material?', user?.name || '');
    if (receiver === null) return;
    const data = { receiver_name: receiver, notes: '' };
    const markLocal = () => { updateProjectInPacote(p.id, (x) => ({ last_requisition: { ...x.last_requisition, stage: 'recebido', receipt: { receiver_name: receiver, received_at: new Date().toISOString() } } })); setPacote(loadPacote()); };
    if (!navigator.onLine) { enqueue({ type: 'material_receipt', projectId: p.id, reqId: req.id, data }); markLocal(); toast.info('Recebimento salvo offline'); refreshPending(); return; }
    try {
      const fd = new FormData(); fd.append('receiver_name', receiver); fd.append('notes', '');
      await axios.post(`${API}/projects/${p.id}/requisitions/${req.id}/confirm-receipt`, fd);
      toast.success('Recebimento confirmado'); load();
    } catch (e) {
      if (!e?.response) { enqueue({ type: 'material_receipt', projectId: p.id, reqId: req.id, data }); markLocal(); toast.info('Sem sinal — recebimento na fila'); refreshPending(); }
      else toast.error(e?.response?.data?.detail || 'Falha ao confirmar');
    }
  };

  const dateLabel = pacote?.date ? new Date(`${pacote.date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : '';
  const teams = pacote?.user?.team_names?.length ? pacote.user.team_names.join(' · ') : 'todas as equipes';

  return (
    <AppLayout title="Modo Campo" subtitle={`${dateLabel} · ${teams}`}>
      <div data-testid="campo-page" className="max-w-2xl mx-auto space-y-4">
        <div data-testid="campo-status" className={`rounded-2xl p-3 flex items-center gap-3 flex-wrap border ${online ? 'border-[#39FF14]/30 bg-[#39FF14]/[0.05]' : 'border-[#FF5E00]/40 bg-[#FF5E00]/[0.08]'}`}>
          {online ? <Wifi className="w-5 h-5 text-[#39FF14]" /> : <WifiOff className="w-5 h-5 text-[#FF5E00]" />}
          <div className="flex-1 min-w-[160px]">
            <p className="text-sm font-bold text-white">{online ? 'Online' : 'Sem internet — modo offline'}</p>
            <p className="text-[10px] text-zinc-500">{pacote?.saved_at ? `Pacote do dia salvo às ${hhmm(pacote.saved_at)}${fromCache ? ' (usando cópia local)' : ''}` : 'Abra com internet uma vez para baixar o pacote do dia'}</p>
          </div>
          {pending > 0 && <span data-testid="campo-pending" className="px-2 py-1 rounded-full text-[10px] font-black bg-[#FF5E00]/15 text-[#FF5E00] border border-[#FF5E00]/40 inline-flex items-center gap-1"><UploadCloud className="w-3 h-3" /> {pending} pendente(s)</span>}
          <button data-testid="campo-sync" disabled={!online} onClick={sync} className="text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15 text-zinc-300 disabled:opacity-40 inline-flex items-center gap-1"><UploadCloud className="w-3.5 h-3.5" /> Sincronizar</button>
          <button data-testid="campo-refresh" disabled={!online || loading} onClick={load} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black disabled:opacity-40 inline-flex items-center gap-1"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar</button>
        </div>

        {!pacote ? (
          <div data-testid="campo-empty" className="glass-panel rounded-2xl p-10 text-center text-zinc-500">{loading ? 'Carregando programação…' : 'Sem pacote do dia. Conecte-se à internet e toque em Atualizar.'}</div>
        ) : (pacote.projects || []).length === 0 ? (
          <div data-testid="campo-empty" className="glass-panel rounded-2xl p-10 text-center text-zinc-500">Nenhuma obra programada para {pacote.user?.team_names?.length ? 'sua equipe' : 'hoje'} em {pacote.date?.split('-').reverse().join('/')}.</div>
        ) : (
          <div className="space-y-4">
            {pacote.projects.map((p) => <CampoCard key={p.id} p={p} user={{ ...user, hot_line_team: pacote.user?.hot_line_team ?? true }} online={online} onCheckin={onCheckin} onReceipt={onReceipt} navigate={navigate} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
