import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { X, FileDown, Camera, Loader2, CheckCircle2 } from 'lucide-react';
import { runPdfJob, downloadPdfJob, jobErrorMessage } from '../lib/pdfJobs';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

export const DiarioPdfModal = ({ open, projectId, initialNotes = '', onClose }) => {
  const [catalog, setCatalog] = useState({ photos: [], dates: [], points: [] });
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [point, setPoint] = useState('');
  const [notes, setNotes] = useState(initialNotes);
  const [job, setJob] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !projectId) return;
    setJob(null); setError(''); setFrom(''); setTo(''); setPoint(''); setNotes(initialNotes);
    setLoading(true);
    axios.get(`${API}/operacional/daily-log/${projectId}/photos`)
      .then(({ data }) => setCatalog(data))
      .catch(() => toast.error('Erro ao carregar as fotos da obra'))
      .finally(() => setLoading(false));
  }, [open, projectId, initialNotes]);

  const selectedCount = useMemo(() => catalog.photos.filter((p) => (!from || !p.date || p.date >= from) && (!to || !p.date || p.date <= to) && (!point || p.point.toUpperCase() === point.toUpperCase())).length, [catalog, from, to, point]);
  const capped = Math.min(selectedCount, 500);
  if (!open) return null;

  const generate = async () => {
    setRunning(true); setJob(null); setError('');
    try {
      const done = await runPdfJob(`${API}/operacional/daily-log/${projectId}/job`, { notes, date_from: from, date_to: to, point, max_photos: 500 }, setJob);
      setJob(done);
      downloadPdfJob(done);
      toast.success(`Diário de Obra gerado (${(done.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) { const msg = jobErrorMessage(err); setError(msg); toast.error(msg); } finally { setRunning(false); }
  };

  return (
    <div data-testid="diario-pdf-modal" className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={running ? undefined : onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-lg rounded-2xl border border-[#00F0FF]/40 overflow-hidden" style={{ backgroundColor: '#0b0b0d' }}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-[#00F0FF]/15 border border-[#00F0FF]/40 flex items-center justify-center"><Camera className="w-5 h-5 text-[#00F0FF]" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#00F0FF]">Diário de Obra em PDF</p>
            <h3 className="font-heading font-black text-lg text-white leading-tight">Fotos e observações</h3>
            <p className="text-[11px] text-zinc-400">{loading ? 'Carregando…' : `${catalog.photos.length} foto(s) na obra · até 500 por PDF`}</p>
          </div>
          <button data-testid="diario-pdf-close" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Fotos de</label>
              <select data-testid="diario-pdf-from" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#00F0FF] focus:outline-none">
                <option value="">Início</option>
                {catalog.dates.map((d) => <option key={d} value={d}>{dateBR(d)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">até</label>
              <select data-testid="diario-pdf-to" value={to} onChange={(e) => setTo(e.target.value)} className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#00F0FF] focus:outline-none">
                <option value="">Hoje</option>
                {catalog.dates.map((d) => <option key={d} value={d}>{dateBR(d)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Ponto</label>
            <select data-testid="diario-pdf-point" value={point} onChange={(e) => setPoint(e.target.value)} className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#00F0FF] focus:outline-none">
              <option value="">Todos os pontos</option>
              {catalog.points.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-zinc-500 font-bold">Observações do dia</label>
            <textarea data-testid="diario-pdf-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional — entra no PDF" className="w-full mt-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#00F0FF] focus:outline-none" />
          </div>
          <p data-testid="diario-pdf-count" className="text-xs text-zinc-300"><b className="font-mono text-[#00F0FF]">{capped}</b> foto(s) entram no PDF{selectedCount > 500 ? ` (limite de 500 — filtre por período)` : ''}{capped > 60 ? ' · obras grandes levam 1–3 min, acompanhe a barra' : ''}</p>

          {error && !running && (
            <div data-testid="diario-pdf-error" className="rounded-xl border border-[#FF003C]/40 bg-[#FF003C]/10 p-3 text-xs text-[#FF6B8A]">
              <p className="font-bold text-[#FF003C]">Não foi possível gerar o PDF</p>
              <p className="mt-0.5 break-words">{error}</p>
            </div>
          )}

          {(running || (job && job.status !== 'error')) && (
            <div data-testid="diario-pdf-progress" className="rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="flex items-center gap-2 text-xs text-white mb-2">
                {job?.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-[#39FF14]" /> : <Loader2 className="w-4 h-4 animate-spin text-[#00F0FF]" />}
                <span className="flex-1">{job?.message || 'Iniciando…'}</span>
                {job?.elapsed != null && job?.status !== 'done' && <span className="font-mono text-zinc-500 text-[10px]">{job.elapsed}s</span>}
                <span className="font-mono text-[#00F0FF]">{job?.pct ?? 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#00F0FF] transition-all" style={{ width: `${job?.pct ?? 0}%` }} /></div>
              {running && <p className="text-[10px] text-zinc-500 mt-2">Pode fechar esta janela — o download começa sozinho quando terminar.</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10">
          {job?.status === 'done' && (
            <button data-testid="diario-pdf-download" onClick={() => downloadPdfJob(job)} className="inline-flex items-center gap-1 text-xs font-bold px-4 py-2 rounded-full border border-[#39FF14]/50 text-[#39FF14] hover:bg-[#39FF14]/10"><FileDown className="w-4 h-4" /> Baixar novamente</button>
          )}
          <button data-testid="diario-pdf-generate" disabled={running || loading} onClick={generate} className="inline-flex items-center gap-1 text-xs font-bold px-4 py-2 rounded-full bg-[#00F0FF] text-black hover:bg-[#00D9E5] disabled:opacity-50">
            <FileDown className="w-4 h-4" /> {running ? 'Gerando…' : `Gerar Diário (${capped} foto${capped !== 1 ? 's' : ''})`}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
