// Fev/2026 · Barra fixa global de aviso: sem sinal + fotos aguardando sync.
// Montada em App.js para aparecer em TODAS as rotas (inclusive ProjectDetailPage
// que não usa AppLayout). Escuta window online/offline + faz polling leve na fila IDB.
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { WifiOff, Upload, CheckCircle2, X } from 'lucide-react';
import { getQueuedPhotoCount, syncPhotoQueue } from '../lib/photoQueue';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const OfflineBanner = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const pollRef = useRef(null);

  const refreshPending = async () => {
    try { setPending(await getQueuedPhotoCount()); } catch { /* IDB indisponível */ }
  };

  useEffect(() => {
    refreshPending();
    const onOn = async () => {
      setOnline(true);
      setDismissed(false);
      // auto-sync ao voltar sinal
      if ((await getQueuedPhotoCount()) > 0) {
        setSyncing(true);
        try { await syncPhotoQueue(axios, API); } catch { /* já reporta */ }
        setSyncing(false);
        await refreshPending();
      }
    };
    const onOff = () => { setOnline(false); setDismissed(false); };
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    // polling leve a cada 6s para detectar mudanças na fila (foto adicionada em outra aba)
    pollRef.current = setInterval(refreshPending, 6000);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Nada a mostrar quando online + sem pendências, ou quando o usuário fechou o banner
  const hasIssue = !online || pending > 0;
  if (!hasIssue || dismissed) return null;

  const bg = !online
    ? { color: '#FF003C', label: 'SEM SINAL', icon: <WifiOff className="w-4 h-4" /> }
    : { color: '#FF5E00', label: 'FOTOS AGUARDANDO SYNC', icon: <Upload className="w-4 h-4" /> };

  const message = !online
    ? (pending > 0
        ? `${pending} foto(s) salvas no celular — sincronizam ao voltar sinal`
        : 'Você está offline. Alterações serão sincronizadas quando o sinal voltar')
    : `${pending} foto(s) aguardando envio` + (syncing ? ' · enviando…' : '');

  const forceSync = async () => {
    if (!online || syncing || pending === 0) return;
    setSyncing(true);
    try {
      const r = await syncPhotoQueue(axios, API);
      if (r.synced > 0) {
        // toast handled by page; aqui só atualizamos o count
      }
    } catch { /* silencioso */ }
    setSyncing(false);
    await refreshPending();
  };

  return (
    <div
      data-testid="global-offline-banner"
      className="fixed top-0 left-0 right-0 z-[60] backdrop-blur-md text-white text-xs sm:text-sm flex items-center gap-3 px-3 py-2 border-b"
      style={{
        backgroundColor: `${bg.color}22`,
        borderColor: `${bg.color}80`,
        color: bg.color,
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-1.5 font-black tracking-wider shrink-0">
        {bg.icon}
        <span>{bg.label}</span>
      </div>
      <span className="flex-1 truncate font-mono text-[11px] sm:text-xs text-white/90">
        {message}
      </span>
      {online && pending > 0 && (
        <button
          data-testid="global-offline-sync-now"
          onClick={forceSync}
          disabled={syncing}
          className="text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border transition-all disabled:opacity-60"
          style={{ backgroundColor: `${bg.color}30`, borderColor: `${bg.color}80`, color: bg.color }}
        >
          {syncing ? 'Enviando…' : 'Sincronizar agora'}
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
  );
};
