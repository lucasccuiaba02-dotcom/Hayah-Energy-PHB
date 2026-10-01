import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { X, FileDown, Image as ImageIcon, CheckSquare, Square, Paperclip } from 'lucide-react';
import { runPdfJob, downloadPdfJob, jobErrorMessage } from '../lib/pdfJobs';
import { thumbSrc } from '../lib/files';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const AvancoPdfModal = ({ open, projectId, projectCode, onClose }) => {
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !projectId) return;
    setLoading(true); setError(''); setJob(null);
    axios.get(`${API}/projects/${projectId}/avanco/photos`)
      .then(({ data }) => { setPhotos(data.photos || []); setSelected(data.default_ids || []); })
      .catch(() => toast.error('Erro ao carregar fotos da obra'))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  if (!open) return null;
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const generate = async () => {
    setGenerating(true); setJob(null); setError('');
    try {
      const done = await runPdfJob(`${API}/projects/${projectId}/avanco/pdf/job`, { photo_ids: selected }, setJob);
      downloadPdfJob(done);
      toast.success(`Relatório gerado com ${selected.length} foto(s) · ${(done.size / 1024 / 1024).toFixed(1)} MB`);
      onClose();
    } catch (err) { const msg = jobErrorMessage(err); setError(msg); toast.error(msg); } finally { setGenerating(false); setJob(null); }
  };

  return (
    <div data-testid="avanco-pdf-modal" className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={generating ? undefined : onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-[#E0FF00]/40 overflow-hidden" style={{ backgroundColor: '#0b0b0d' }}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-[#E0FF00]/15 border border-[#E0FF00]/40 flex items-center justify-center"><ImageIcon className="w-5 h-5 text-[#E0FF00]" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Relatório de Avanço Físico</p>
            <h3 className="font-heading font-black text-lg text-white leading-tight">Escolha as fotos do PDF</h3>
            <p className="text-[11px] text-zinc-400">{photos.length} foto(s) disponíveis · {selected.length} selecionada(s){photos.length > 60 ? ' · obras grandes levam 1–3 min' : ''}</p>
          </div>
          <button data-testid="avanco-pdf-modal-close" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center gap-2 px-5 py-2 border-b border-white/5 text-[11px]">
          <button data-testid="avanco-pdf-select-all" onClick={() => setSelected(photos.map((p) => p.id))} className="inline-flex items-center gap-1 text-[#00F0FF] font-bold"><CheckSquare className="w-3.5 h-3.5" /> Todas</button>
          <button data-testid="avanco-pdf-select-none" onClick={() => setSelected([])} className="inline-flex items-center gap-1 text-zinc-400 font-bold"><Square className="w-3.5 h-3.5" /> Nenhuma</button>
          <span className="ml-auto text-zinc-500">Sem fotos marcadas, o PDF sai sem galeria.</span>
        </div>

        {error && !generating && (
          <div data-testid="avanco-pdf-error" className="mx-5 mt-3 rounded-xl border border-[#FF003C]/40 bg-[#FF003C]/10 p-3 text-xs text-[#FF6B8A]">
            <p className="font-bold text-[#FF003C]">Não foi possível gerar o PDF</p>
            <p className="mt-0.5 break-words">{error}</p>
          </div>
        )}

        <div className="overflow-y-auto p-4">
          {loading ? <p className="text-sm text-zinc-500 text-center py-8">Carregando fotos…</p> : photos.length === 0 ? (
            <p data-testid="avanco-pdf-no-photos" className="text-sm text-zinc-500 text-center py-8">Esta obra ainda não tem fotos ou anexos de imagem. O PDF será gerado sem galeria.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((ph) => {
                const on = selected.includes(ph.id);
                return (
                  <button key={ph.id} type="button" data-testid={`avanco-pdf-photo-${ph.id}`} data-selected={on ? 'true' : 'false'} onClick={() => toggle(ph.id)}
                    className={`relative rounded-xl overflow-hidden border-2 text-left transition ${on ? 'border-[#E0FF00]' : 'border-white/10 opacity-70 hover:opacity-100'}`}>
                    <div className="aspect-[4/3] bg-zinc-900 flex items-center justify-center">
                      {ph.thumb ? <img src={thumbSrc(ph.thumb)} alt={ph.caption} loading="lazy" className="w-full h-full object-cover" /> : <Paperclip className="w-8 h-8 text-zinc-600" />}
                    </div>
                    <div className={`absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center ${on ? 'bg-[#E0FF00] text-black' : 'bg-black/60 text-zinc-400 border border-white/20'}`}>
                      {on ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </div>
                    <div className="px-2 py-1.5 bg-black/70">
                      <p className="text-[10px] font-bold text-white truncate">{ph.point || (ph.source === 'attachment' ? 'Anexo' : 'Obra')} · {ph.label || ph.filename}</p>
                      <p className="text-[9px] text-zinc-400">{(ph.uploaded_at || '').slice(0, 10).split('-').reverse().join('/')}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10">
          {generating && job && (
            <div data-testid="avanco-pdf-progress" className="flex-1 min-w-0">
              <p className="text-[10px] text-zinc-400 truncate">{job.message} · <span className="font-mono text-[#E0FF00]">{job.pct ?? 0}%</span></p>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-1"><div className="h-full bg-[#E0FF00] transition-all" style={{ width: `${job.pct ?? 0}%` }} /></div>
            </div>
          )}
          <button onClick={onClose} className="text-xs font-bold px-4 py-2 rounded-full border border-white/15 text-zinc-300 hover:bg-white/10">Cancelar</button>
          <button data-testid="avanco-pdf-generate" disabled={generating || loading} onClick={generate} className="inline-flex items-center gap-1 text-xs font-bold px-4 py-2 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600] disabled:opacity-50">
            <FileDown className="w-4 h-4" /> {generating ? 'Gerando…' : `Gerar PDF (${selected.length} foto${selected.length !== 1 ? 's' : ''})`}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
