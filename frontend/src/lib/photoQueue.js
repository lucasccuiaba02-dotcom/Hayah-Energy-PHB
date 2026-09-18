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

export const discardQueuedPhoto = removeQueuedPhoto;

const updateQueuedPhoto = async (item) => {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const describeError = (err) => {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail || err?.response?.data?.error;
  if (err?.response?.data?.offline) return 'Sem conexão com o servidor';
  if (status === 401) return 'Sessão expirada — faça login novamente';
  if (status === 404) return 'Obra não encontrada (pode ter sido excluída)';
  if (status === 413) return 'Foto grande demais para o servidor';
  if (status) return `${detail || 'Erro do servidor'} (HTTP ${status})`;
  if (err?.code === 'ECONNABORTED') return 'Tempo esgotado no envio';
  return err?.message || 'Falha de rede';
};

// Set/2026 · `force` ignora navigator.onLine (alguns celulares reportam offline mesmo com sinal);
// cada falha grava attempts/lastError no item para a UI mostrar o motivo.
export const syncPhotoQueue = async (axios, API, onProgress, { force = false } = {}) => {
  if (!force && !navigator.onLine) return { synced: 0, failed: 0, remaining: 0, errors: [] };
  const items = await getQueuedPhotos();
  if (items.length === 0) return { synced: 0, failed: 0, remaining: 0, errors: [] };
  let synced = 0;
  let failed = 0;
  const errors = [];
  for (const item of items) {
    try {
      const fd = new FormData();
      fd.append('file', new File([item.blob], item.filename, { type: item.type }));
      fd.append('label', item.label || 'depois');
      fd.append('point', item.point || '');
      await axios.post(`${API}/operacional/photos/${item.projectId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90000,
      });
      await removeQueuedPhoto(item.id);
      synced += 1;
      if (onProgress) onProgress({ synced, failed, total: items.length });
    } catch (err) {
      failed += 1;
      const message = describeError(err);
      errors.push({ id: item.id, filename: item.filename, projectId: item.projectId, message });
      try {
        await updateQueuedPhoto({ ...item, attempts: (item.attempts || 0) + 1, lastError: message, lastTriedAt: new Date().toISOString() });
      } catch { /* mantém item como está */ }
    }
  }
  const remaining = await getQueuedPhotoCount();
  return { synced, failed, remaining, errors };
};

export const clearPhotoQueue = async () => {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};
