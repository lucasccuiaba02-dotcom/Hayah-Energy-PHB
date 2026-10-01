// Set/2026 · Abrir/baixar arquivos com nome e extensão corretos (celular + DWG) usando link direto autenticado
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export const apiUrl = (path) => (path?.startsWith('http') ? path : `${BACKEND_URL}${path}`);
/** Miniatura das fotos operacionais (`/api/operacional/photos/.../file?w=320`); data URLs e outras rotas passam direto. */
export const thumbSrc = (u, w = 320) => {
  if (!u || u.startsWith('data:')) return u;
  const full = apiUrl(u);
  return full.includes('/operacional/photos/') ? `${full}${full.includes('?') ? '&' : '?'}w=${w}` : full;
};
export const withAuth = (url) => {
  const t = localStorage.getItem('access_token');
  if (!t) return url;
  return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(t)}`;
};
export const extOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
const VIEWABLE = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt'];

export function downloadUrl(url, filename = '') {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function openUrl(path) {
  window.open(withAuth(apiUrl(path)), '_blank', 'noopener');
}

/** Anexo da obra: PDF/imagem abre inline no desktop; no celular e para DWG/XLSX/etc. baixa com o nome original. */
export function openAttachment(projectId, att) {
  const base = `${BACKEND_URL}/api/projects/${projectId}/attachments/${att.id}`;
  const ext = extOf(att.filename);
  if (VIEWABLE.includes(ext) && !isMobile()) {
    window.open(withAuth(base), '_blank', 'noopener');
    return;
  }
  downloadUrl(withAuth(`${base}?download=1`), att.filename || `arquivo.${ext || 'bin'}`);
}
