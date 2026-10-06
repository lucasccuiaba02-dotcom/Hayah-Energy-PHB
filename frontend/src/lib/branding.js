import { useEffect, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const KEY = 'hayah_branding';
export const DEFAULT_BRANDING = { app_name: 'Hayah Energy', company_name: '', tagline: 'ENERGY', logo_data_url: '' };

let cache = null;
let inflight = null;
const listeners = new Set();

const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

export const setBrandingCache = (b) => {
  cache = { ...DEFAULT_BRANDING, ...(b || {}) };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(cache));
};

export const fetchBranding = () => {
  if (!inflight) {
    inflight = axios.get(`${API}/branding`, { withCredentials: true }).then(({ data }) => { setBrandingCache(data); return cache; }).catch(() => cache || readLocal() || DEFAULT_BRANDING).finally(() => { inflight = null; });
  }
  return inflight;
};

/** Out/2026 · Marca branca — nome/logo exibidos nas telas (cache local p/ funcionar offline). */
export const useBranding = () => {
  const [b, setB] = useState(() => cache || readLocal() || DEFAULT_BRANDING);
  useEffect(() => {
    listeners.add(setB);
    if (!cache) fetchBranding();
    return () => listeners.delete(setB);
  }, []);
  return b;
};

export const splitName = (name) => {
  const parts = (name || 'Hayah Energy').trim().split(/\s+/);
  return { first: parts[0] || 'HAYAH', rest: parts.slice(1).join(' ') };
};
