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
  if (!(await isPushSupported())) throw new Error('Push não suportado neste navegador');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permissão negada');
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
