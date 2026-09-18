// Fev/2026 · Barra fixa global de aviso: sem sinal + fotos aguardando sync.
// Set/2026 · mostra o MOTIVO da falha, permite "Sincronizar agora" mesmo com navigator.onLine=false
// e descartar fotos que nunca vão subir (obra excluída, arquivo inválido...).
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { WifiOff, Upload, CheckCircle2, X, AlertTriangle, Trash2 } from 'lucide-react';
import { getQueuedPhotos, syncPhotoQueue, discardQueuedPhoto } from '../lib/photoQueue';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const OfflineBanner = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const pollRef = useRef(null);
  const pending = queue.length;
  const withError = queue.filter((q) => q.lastError);

  const refreshPending = async () => {
    try { setQueue(await getQueuedPhotos()); } catch { /* IDB indisponível */ }
  };

  const runSync = async (force) => {
    setSyncing(true);
    try {
      const r = await syncPhotoQueue(axios, API, null, { force });
      if (r.synced > 0) {
        toast.success(`${r.synced} foto(s) sincronizada(s)`);
        try { window.dispatchEvent(new CustomEvent('hayah-photos-synced', { detail: r })); } catch (_) {}
      }
      if (r.failed > 0) {
        const first = r.errors?.[0]?.message || 'erro desconhecido';
        toast.error(`${r.failed} foto(s) não subiram: ${first}`, { duration: 7000 });
        setShowErrors(true);
      }
    } catch (e) {
      toast.error('Falha ao sincronizar fotos');
    }
    setSyncing(false);
    await refreshPending();
  };

  useEffect(() => {
    refreshPending();
    const onOn = async () => {
      setOnline(true);
      setDismissed(false);
      if ((await getQueuedPhotos()).length > 0) runSync(false);
    };
    const onOff = () => { setOnline(false); setDismissed(false); };
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    pollRef.current = setInterval(refreshPending, 6000);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const hasIssue = !online || pending > 0;
  if (!hasIssue || dismissed) return null;

  const bg = !online
    ? { color: '#FF003C', label: 'SEM SINAL', icon: <WifiOff className="w-4 h-4" /> }
    : withError.length > 0
      ? { color: '#FF003C', label: 'FOTOS COM ERRO', icon: <AlertTriangle className="w-4 h-4" /> }
      : { color: '#FF5E00', label: 'FOTOS AGUARDANDO SYNC', icon: <Upload className="w-4 h-4" /> };

  const message = !online
    ? (pending > 0
        ? `${pending} foto(s) salvas no celular — sincronizam ao voltar sinal`
        : 'Você está offline. Alterações serão sincronizadas quando o sinal voltar')
    : `${pending} foto(s) aguardando envio` + (withError.length > 0 ? ` · ${withError.length} com erro` : '') + (syncing ? ' · enviando…' : '');

  const discard = async (item) => {
    if (!window.confirm(`Descartar a foto "${item.filename}"? Ela será apagada do celular e NÃO será enviada.`)) return;
    await discardQueuedPhoto(item.id);
    toast.info('Foto descartada da fila');
    await refreshPending();
  };

  return (
    <div
      data-testid="global-offline-banner"
      className="fixed top-0 left-0 right-0 z-[60] backdrop-blur-md text-white text-xs sm:text-sm border-b"
      style={{ backgroundColor: `${bg.color}22`, borderColor: `${bg.color}80`, color: bg.color }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="flex items-center gap-1.5 font-black tracking-wider shrink-0">
          {bg.icon}
          <span>{bg.label}</span>
        </div>
        <span data-testid="global-offline-message" className="flex-1 truncate font-mono text-[11px] sm:text-xs text-white/90">
          {message}
        </span>
        {pending > 0 && (
          <button
            data-testid="global-offline-sync-now"
            onClick={() => runSync(true)}
            disabled={syncing}
            className="text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border transition-all disabled:opacity-60"
            style={{ backgroundColor: `${bg.color}30`, borderColor: `${bg.color}80`, color: bg.color }}
            title={!online ? 'Tentar enviar mesmo assim (o celular pode estar reportando offline por engano)' : 'Enviar agora'}
          >
            {syncing ? 'Enviando…' : !online ? 'Tentar enviar' : 'Sincronizar agora'}
          </button>
        )}
        {pending > 0 && withError.length > 0 && (
          <button
            data-testid="global-offline-toggle-errors"
            onClick={() => setShowErrors((v) => !v)}
            className="text-[10px] font-bold px-2 py-1 rounded-full border border-white/20 text-white/80 hover:bg-white/10"
          >
            {showErrors ? 'Ocultar' : 'Ver motivo'}
          </button>
        )}
        {online && pending === 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#39FF14]">
            <CheckCircle2 className="w-3 h-3" /> Tudo sincronizado
          </span>
        )}
        <button
          data-testid="global-offline-dismiss"
          onClick={() => setDismissed(true)}
          className="w-6 h-6 rounded-full bg-white/10 border border-white/10 flex items-center justify-center hover:bg-white/20"
          aria-label="Fechar aviso"
          title="Ocultar aviso"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {showErrors && withError.length > 0 && (
        <div data-testid="global-offline-errors" className="px-3 pb-2 space-y-1 max-h-40 overflow-y-auto">
          {withError.map((q) => (
            <div key={q.id} data-testid={`offline-photo-error-${q.id}`} className="flex items-center gap-2 text-[11px] bg-black/40 rounded-lg px-2 py-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-white/90">
                <span className="font-mono">{q.filename}</span>{q.point ? ` · ${q.point}` : ''} · <span className="text-white/70">{q.lastError}</span>
                {q.attempts > 1 && <span className="text-white/50"> · {q.attempts} tentativas</span>}
              </span>
              <button
                data-testid={`offline-photo-discard-${q.id}`}
                onClick={() => discard(q)}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/20 text-white/80 hover:bg-white/10"
                title="Apagar esta foto da fila"
              >
                <Trash2 className="w-3 h-3" /> Descartar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
