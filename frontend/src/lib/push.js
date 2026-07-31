import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

export async function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function currentPushStatus() {
  if (!(await isPushSupported())) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'no-sw';
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'subscribed' : Notification.permission === 'granted' ? 'granted' : 'default';
}

export async function subscribeToPush() {
  if (!(await isPushSupported())) {
    throw new Error('Este navegador não suporta notificações push. Use Chrome/Edge no Android ou desktop.');
  }
  // If previously denied, guide the user
  if (Notification.permission === 'denied') {
    throw new Error(
      'Notificações estão BLOQUEADAS neste site. Para ativar:\n\n' +
      '1. Clique no cadeado 🔒 (ou "i") na barra de endereço\n' +
      '2. Encontre "Notificações" → mude para "Permitir"\n' +
      '3. Recarregue a página e clique em Ativar de novo\n\n' +
      'Em iOS Safari: adicione o app à Tela de Início antes de ativar.'
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permissão negada. Clique no cadeado 🔒 da barra de endereço, mude Notificações para "Permitir" e recarregue.');
  }
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js');
  const { data } = await axios.get(`${API}/push/vapid-key`);
  const key = urlBase64ToUint8Array(data.public_key);
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const raw = sub.toJSON();
  await axios.post(`${API}/push/subscribe`, { endpoint: raw.endpoint, keys: raw.keys });
  return sub;
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await axios.post(`${API}/push/unsubscribe`, { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}
