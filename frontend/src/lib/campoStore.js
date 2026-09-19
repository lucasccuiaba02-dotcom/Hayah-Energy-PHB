// Set/2026 · Pacote do dia (Modo Campo) — cache local p/ operação 100% offline
const KEY = 'hayah_campo_pacote';

export const savePacote = (pacote) => {
  const saved = { ...pacote, saved_at: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* quota */ }
  return saved;
};

export const loadPacote = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
};

export const findProjectInPacote = (id) => {
  const p = loadPacote();
  return (p?.projects || []).find((x) => x.id === id) || null;
};

export const updateProjectInPacote = (id, patch) => {
  const p = loadPacote();
  if (!p) return;
  p.projects = (p.projects || []).map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x));
  savePacote(p);
};

export const isToday = (pacote) => !!pacote && pacote.date === new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Cuiaba' });
