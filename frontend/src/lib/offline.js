// Offline queue helper - stores actions to sync when back online
const QUEUE_KEY = 'hayah_offline_queue';

export const getQueue = () => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
};

export const enqueue = (action) => {
  const queue = getQueue();
  queue.push({ ...action, timestamp: Date.now() });
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
      }
    } catch (e) {
      remaining.push(action);
    }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { synced, remaining: remaining.length };
};

export const registerServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.error('SW registration failed:', err));
    });
  }
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
