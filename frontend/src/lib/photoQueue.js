// Fev/2026 · Fila offline de fotos usando IndexedDB.
// localStorage não serve porque fotos ~2-5MB não cabem no limite de 5-10MB por origem.
// IDB armazena Blobs sem serialização — perfeito para file uploads pendentes.

const DB_NAME = 'hayah_offline_photos';
const STORE = 'queue';
const VERSION = 1;

const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const tx = async (mode) => {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
};

export const enqueuePhoto = async ({ projectId, file, label = 'depois', point = '' }) => {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add({
      projectId,
      blob: file,
      filename: file.name || `photo_${Date.now()}.jpg`,
      type: file.type || 'image/jpeg',
      label,
      point,
      queuedAt: new Date().toISOString(),
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const getQueuedPhotos = async () => {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
};

export const getQueuedPhotoCount = async () => {
  try {
    const items = await getQueuedPhotos();
    return items.length;
  } catch {
    return 0;
  }
};

const removeQueuedPhoto = async (id) => {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const syncPhotoQueue = async (axios, API, onProgress) => {
  if (!navigator.onLine) return { synced: 0, failed: 0, remaining: 0 };
  const items = await getQueuedPhotos();
  if (items.length === 0) return { synced: 0, failed: 0, remaining: 0 };
  let synced = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const fd = new FormData();
      fd.append('file', new File([item.blob], item.filename, { type: item.type }));
      fd.append('label', item.label || 'depois');
      fd.append('point', item.point || '');
      await axios.post(`${API}/operacional/photos/${item.projectId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await removeQueuedPhoto(item.id);
      synced += 1;
      if (onProgress) onProgress({ synced, failed, total: items.length });
    } catch (err) {
      // Item permanece na fila para próxima tentativa
      failed += 1;
    }
  }
  const remaining = await getQueuedPhotoCount();
  return { synced, failed, remaining };
};

export const clearPhotoQueue = async () => {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};
