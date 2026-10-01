import axios from 'axios';
import { apiUrl, downloadUrl, withAuth } from './files';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const jobErrorMessage = (err) => err?.response?.data?.detail || err?.message || 'Erro ao gerar o PDF';

/** Dispara um job de PDF pesado e acompanha até terminar. onProgress(job) recebe {status, pct, message, done, total}.
 *  Tolera quedas momentâneas de rede durante o polling (celular em campo): só desiste após 8 falhas seguidas. */
export async function runPdfJob(startUrl, body, onProgress) {
  const { data: job } = await axios.post(startUrl, body || {}, { timeout: 60000 });
  let cur = job;
  let failures = 0;
  onProgress?.(cur);
  while (cur.status === 'queued' || cur.status === 'running') {
    await sleep(1200);
    try {
      cur = (await axios.get(`${API}/pdf-jobs/${job.id}`, { timeout: 20000 })).data;
      failures = 0;
      onProgress?.(cur);
    } catch (err) {
      if (err?.response?.status === 404) throw new Error(jobErrorMessage(err));
      failures += 1;
      if (failures >= 8) throw new Error('Sem resposta do servidor durante a geração. Verifique sua conexão e tente novamente.');
      onProgress?.({ ...cur, message: `Reconectando… (${failures})` });
      await sleep(1500 * failures);
    }
  }
  if (cur.status !== 'done') throw new Error(cur.error || 'Falha ao gerar o PDF');
  return cur;
}

export const downloadPdfJob = (job) => downloadUrl(withAuth(apiUrl(job.download_url)), job.filename);
