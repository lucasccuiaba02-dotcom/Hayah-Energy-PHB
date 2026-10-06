import { useEffect, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TTL = 5 * 60 * 1000;

let cache = null;
let at = 0;
let inflight = null;
const listeners = new Set();

/** Out/2026 · Status da licença (cache 5 min) — alimenta a faixa de aviso do AppLayout e a seção de Configurações. */
export const fetchLicense = (force = false) => {
  if (!force && cache && Date.now() - at < TTL) return Promise.resolve(cache);
  if (!inflight) {
    inflight = axios.get(`${API}/licenca/status`)
      .then(({ data }) => { cache = data; at = Date.now(); listeners.forEach((fn) => fn(data)); return data; })
      .catch(() => cache)
      .finally(() => { inflight = null; });
  }
  return inflight;
};

export const invalidateLicense = () => { at = 0; return fetchLicense(true); };

export const useLicense = () => {
  const [lic, setLic] = useState(cache);
  useEffect(() => {
    listeners.add(setLic);
    fetchLicense();
    return () => listeners.delete(setLic);
  }, []);
  return lic;
};

export const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
