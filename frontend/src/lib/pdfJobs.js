import axios from 'axios';
import { apiUrl, downloadUrl, withAuth } from './files';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/** Dispara um job de PDF pesado e acompanha até terminar. onProgress(job) recebe {status, pct, message, done, total}. */
export async function runPdfJob(startUrl, body, onProgress) {
  const { data: job } = await axios.post(startUrl, body || {});
  let cur = job;
  onProgress?.(cur);
  while (cur.status === 'queued' || cur.status === 'running') {
    await new Promise((r) => setTimeout(r, 1200));
    cur = (await axios.get(`${API}/pdf-jobs/${job.id}`)).data;
    onProgress?.(cur);
  }
  if (cur.status !== 'done') throw new Error(cur.error || 'Falha ao gerar o PDF');
  return cur;
}

export const downloadPdfJob = (job) => downloadUrl(withAuth(apiUrl(job.download_url)), job.filename);
