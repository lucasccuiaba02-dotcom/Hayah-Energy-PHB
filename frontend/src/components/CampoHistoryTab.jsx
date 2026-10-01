import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { MapPin, Camera, ShieldCheck, Package, PackageCheck, Undo2, Gauge, CalendarCheck, FileDown, Users, RefreshCw } from 'lucide-react';
import { openUrl, thumbSrc } from '../lib/files';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const dateBR = (d) => (d && d !== 'sem-data' ? d.slice(0, 10).split('-').reverse().join('/') : 'Sem data');
const timeBR = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const SHIFT = { manha: 'Manhã', tarde: 'Tarde', integral: 'Integral', noturno: 'Noturno' };
const STATUS = { a_caminho: { label: 'A caminho', color: '#E0FF00' }, no_local: { label: 'No local', color: '#00F0FF' }, concluido: { label: 'Concluído', color: '#39FF14' } };
const imgSrc = (u) => (u?.startsWith('data:') || u?.startsWith('http') ? u : `${BACKEND_URL}${u}`);

const Section = ({ icon: Icon, color, title, count, children }) => (
  <div className="rounded-xl border border-white/5 bg-black/30 p-3">
    <p className="text-[10px] tracking-[0.2em] uppercase font-bold mb-2 inline-flex items-center gap-1.5" style={{ color }}><Icon className="w-3.5 h-3.5" /> {title} <span className="font-mono text-zinc-500">· {count}</span></p>
    {children}
  </div>
);

const DayCard = ({ d, pid }) => (
  <div data-testid={`campo-hist-day-${d.date}`} className="glass-panel rounded-2xl p-4 space-y-3">
    <div className="flex items-center gap-2 flex-wrap">
      <p className="font-mono text-lg font-black text-white">{dateBR(d.date)}</p>
      <span className="text-[10px] text-zinc-500 font-mono">{d.count} registro(s)</span>
      {d.checkins.length > 0 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/40">CHECK-IN</span>}
      {d.aprs.length > 0 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#FF003C]/15 text-[#FF003C] border border-[#FF003C]/40">APR</span>}
      {d.photos.length > 0 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#FF5E00]/15 text-[#FF5E00] border border-[#FF5E00]/40">{d.photos.length} FOTOS</span>}
      {d.receipts.length > 0 && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#39FF14]/15 text-[#39FF14] border border-[#39FF14]/40">MATERIAL RECEBIDO</span>}
    </div>
    {d.checkins.length > 0 && (
      <Section icon={MapPin} color="#00F0FF" title="Check-ins" count={d.checkins.length}>
        <div className="space-y-1">
          {d.checkins.map((c, i) => (
            <p key={i} className="text-xs text-zinc-200 flex flex-wrap items-center gap-2">
              <span className="font-mono text-zinc-500">{timeBR(c.at)}</span>
              <b>{c.by_name || c.by_email}</b>
              <span className="text-zinc-400">{SHIFT[c.shift] || c.shift}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: STATUS[c.status]?.color || '#94A3B8', background: `${STATUS[c.status]?.color || '#94A3B8'}18` }}>{STATUS[c.status]?.label || c.status}</span>
              {c.note && <span className="text-zinc-500 italic">{c.note}</span>}
            </p>
          ))}
        </div>
      </Section>
    )}
    {d.aprs.length > 0 && (
      <Section icon={ShieldCheck} color="#FF003C" title="APRs" count={d.aprs.length}>
        <div className="space-y-1">
          {d.aprs.map((a) => (
            <div key={a.id} data-testid={`campo-hist-apr-${a.id}`} className="flex items-center gap-2 text-xs text-zinc-200 flex-wrap">
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: a.line_type === 'viva' ? '#FF003C' : '#16a34a', color: '#fff' }}>LINHA {a.line_type === 'viva' ? 'VIVA' : 'MORTA'}</span>
              {a.os_number && <span className="font-mono text-zinc-400">OS {a.os_number}</span>}
              <span>{a.supervisor ? `Supervisor: ${a.supervisor}` : 'Sem supervisor'}</span>
              <span className={`text-[10px] ${a.signed ? 'text-[#39FF14]' : 'text-zinc-500'}`}>{a.signed ? 'assinada' : 'sem assinatura'}</span>
              <button data-testid={`campo-hist-apr-pdf-${a.id}`} onClick={() => openUrl(a.pdf_url)} className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-[#FF003C] hover:underline"><FileDown className="w-3 h-3" /> PDF</button>
            </div>
          ))}
        </div>
      </Section>
    )}
    {d.photos.length > 0 && (
      <Section icon={Camera} color="#FF5E00" title="Fotos" count={d.photos.length}>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
          {d.photos.map((ph) => (
            <button key={ph.id} data-testid={`campo-hist-photo-${ph.id}`} onClick={() => window.open(imgSrc(ph.url), '_blank', 'noopener')} className="relative rounded-lg overflow-hidden border border-white/10 aspect-square bg-zinc-900">
              <img src={thumbSrc(ph.url)} alt={ph.label} loading="lazy" className="w-full h-full object-cover" />
              <span className="absolute bottom-0 left-0 right-0 text-[8px] font-bold text-white bg-black/60 px-1 truncate">{ph.point || '—'} · {(ph.label || '').toUpperCase()}</span>
            </button>
          ))}
        </div>
      </Section>
    )}
    {(d.requisitions.length > 0 || d.receipts.length > 0 || d.returns.length > 0) && (
      <Section icon={Package} color="#39FF14" title="Material" count={d.requisitions.length + d.receipts.length + d.returns.length}>
        <div className="space-y-1 text-xs text-zinc-200">
          {d.requisitions.map((r) => (
            <div key={r.id} data-testid={`campo-hist-req-${r.id}`} className="flex items-center gap-2 flex-wrap">
              <Package className="w-3 h-3 text-[#E0FF00]" /> Requisição {r.requisition_type === 'parcial' ? `PARCIAL nº ${r.seq}` : 'total'} · {r.items_count} item(ns) · por {r.created_by || '—'}
              {r.warehouse_status && <span className="text-[10px] text-zinc-400">almox.: {r.warehouse_status}</span>}
              <button onClick={() => openUrl(r.pdf_url)} className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-[#E0FF00] hover:underline"><FileDown className="w-3 h-3" /> PDF</button>
            </div>
          ))}
          {d.receipts.map((rc, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <PackageCheck className="w-3 h-3 text-[#39FF14]" /> Recebido em campo por <b>{rc.received_by || '—'}</b> às {timeBR(rc.received_at)}{rc.notes ? ` · ${rc.notes}` : ''}
              {rc.photo_url && <button onClick={() => openUrl(rc.photo_url)} className="ml-auto text-[10px] font-bold text-[#39FF14] hover:underline">foto do canhoto</button>}
            </div>
          ))}
          {d.returns.map((rt) => (
            <div key={rt.id} className="flex items-center gap-2 flex-wrap">
              <Undo2 className="w-3 h-3 text-[#00F0FF]" /> Devolução de sobras por <b>{rt.returned_by || '—'}</b> · {rt.total_qty} un {rt.reason ? `· ${rt.reason}` : ''}
            </div>
          ))}
        </div>
      </Section>
    )}
    {d.progress.length > 0 && (
      <Section icon={Gauge} color="#E0FF00" title="Avanço físico" count={d.progress.length}>
        <div className="space-y-0.5 text-xs text-zinc-200">{d.progress.map((e, i) => <p key={i}><b className="font-mono text-[#E0FF00]">{e.qty}</b> {e.item_key}{e.notes ? ` · ${e.notes}` : ''} <span className="text-zinc-500">({e.registered_by || '—'})</span></p>)}</div>
      </Section>
    )}
    {d.daily_returns.length > 0 && (
      <Section icon={CalendarCheck} color="#A855F7" title="Retorno de programação" count={d.daily_returns.length}>
        <div className="space-y-0.5 text-xs text-zinc-200">{d.daily_returns.map((r, i) => <p key={i}>{r.executed ? <span className="text-[#39FF14] font-bold">Executada</span> : <span className="text-[#FF5E00] font-bold">Não executada</span>}{r.reason ? ` · ${r.reason}` : ''}{r.notes ? ` · ${r.notes}` : ''}</p>)}</div>
      </Section>
    )}
  </div>
);

export const CampoHistoryTab = ({ projectId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    axios.get(`${API}/projects/${projectId}/campo/historico`).then(({ data: d }) => setData(d)).catch(() => toast.error('Erro ao carregar histórico de campo')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  if (loading && !data) return <p className="p-6 text-center text-sm text-zinc-500">Carregando histórico de campo…</p>;
  if (!data) return null;
  const t = data.totals;
  const cl = data.checklist;
  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto" data-testid="campo-hist">
      <div className="glass-panel rounded-2xl p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#00F0FF] font-bold">Histórico de campo</p>
            <p className="text-white font-bold text-sm">Tudo que as equipes registraram nesta obra, por dia</p>
          </div>
          <button data-testid="campo-hist-reload" onClick={load} className="text-xs font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Atualizar</button>
        </div>
        <div data-testid="campo-hist-totals" className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[['Check-ins', t.checkins, '#00F0FF'], ['Fotos', t.photos, '#FF5E00'], ['APRs', t.aprs, '#FF003C'], ['Requisições', t.requisitions, '#E0FF00'], ['Recebimentos', t.receipts, '#39FF14'], ['Avanço', t.progress, '#A855F7']].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border p-2 text-center" style={{ borderColor: `${c}30`, background: `${c}08` }}>
              <p className="font-mono text-xl font-black text-white leading-none">{v}</p>
              <p className="text-[9px] uppercase tracking-wider font-bold mt-1" style={{ color: c }}>{l}</p>
            </div>
          ))}
        </div>
        {(cl.team_confirmed || cl.team) && (
          <p className="mt-3 text-[11px] text-zinc-400 inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-[#00F0FF]" /> Última confirmação de equipe: <b className="text-white">{cl.team || '—'}</b>{cl.turno ? ` · ${SHIFT[cl.turno] || cl.turno}` : ''}{cl.team_confirmed_by ? ` · por ${cl.team_confirmed_by}` : ''}{cl.team_confirmed_at ? ` em ${dateBR(cl.team_confirmed_at)} ${timeBR(cl.team_confirmed_at)}` : ''}</p>
        )}
      </div>
      {data.days.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center">
          <Camera className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
          <p className="text-zinc-400 font-bold">Nenhum registro de campo ainda</p>
          <p className="text-[11px] text-zinc-500 mt-1">Check-ins, fotos, APRs e recebimentos feitos pelas equipes aparecem aqui automaticamente.</p>
        </div>
      ) : data.days.map((d) => <DayCard key={d.date} d={d} pid={projectId} />)}
    </div>
  );
};
