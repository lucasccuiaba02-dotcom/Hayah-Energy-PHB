// Offline queue helper - stores actions to sync when back online
const QUEUE_KEY = 'hayah_offline_queue';

export const getQueue = () => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
};

export const enqueue = (action, { replaceKey } = {}) => {
  let queue = getQueue();
  if (replaceKey) queue = queue.filter((a) => !(a.type === action.type && a.replaceKey === replaceKey));
  queue.push({ ...action, replaceKey, timestamp: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

export const clearQueue = () => localStorage.removeItem(QUEUE_KEY);

export const syncQueue = async (axios, API) => {
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0 };
  const remaining = [];
  let synced = 0;
  for (const action of queue) {
    try {
      if (action.type === 'checklist') {
        await axios.put(`${API}/operacional/checklist/${action.projectId}`, action.data);
        synced += 1;
      } else if (action.type === 'apr') {
        if (action.aprId) await axios.patch(`${API}/aprs/${action.aprId}`, action.data);
        else await axios.post(`${API}/projects/${action.projectId}/aprs`, action.data);
        synced += 1;
      } else if (action.type === 'checkin') {
        await axios.post(`${API}/campo/checkin`, action.data);
        synced += 1;
      } else if (action.type === 'ditais') {
        await axios.post(`${API}/projects/${action.projectId}/ditais`, action.data);
        synced += 1;
      } else if (action.type === 'material_receipt') {
        const fd = new FormData();
        fd.append('receiver_name', action.data.receiver_name || '');
        fd.append('notes', action.data.notes || '');
        await axios.post(`${API}/projects/${action.projectId}/requisitions/${action.reqId}/confirm-receipt`, fd);
        synced += 1;
      } else {
        synced += 1;
      }
    } catch (e) {
      if (e?.response?.status && e.response.status >= 400 && e.response.status < 500 && e.response.status !== 401) continue;
      remaining.push(action);
    }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  if (synced > 0) { try { window.dispatchEvent(new CustomEvent('hayah-queue-synced', { detail: { synced } })); } catch (_) {} }
  return { synced, remaining: remaining.length };
};

export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Verifica atualizações a cada 30 minutos
        setInterval(() => { try { reg.update(); } catch (_) {} }, 30 * 60 * 1000);
        // Ativa novo SW automaticamente quando disponível
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              // Novo conteúdo disponível — instrui o SW novo a assumir imediatamente
              try { nw.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
            }
          });
        });
      })
      .catch((err) => console.error('SW registration failed:', err));

    // Recarrega uma única vez quando o controlador muda (novo SW ativado)
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      // Não recarrega em telas críticas para não perder trabalho — só marca
      try { window.dispatchEvent(new CustomEvent('sw-updated')); } catch (_) {}
    });

    // Recebe mensagens do SW (navegação por push, sync)
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'PUSH_NAV' && msg.url) {
        try { window.location.href = msg.url; } catch (_) {}
      }
      if (msg.type === 'SYNC_REQUEST') {
        try { window.dispatchEvent(new CustomEvent('hayah-sync-request')); } catch (_) {}
      }
      if (msg.type === 'SW_READY') {
        try { window.dispatchEvent(new CustomEvent('sw-ready', { detail: msg })); } catch (_) {}
      }
    });
  });
};

export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
};

export const showNotification = (title, body) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  }
};
