import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { X, Save, FileDown, Loader, WifiOff, Camera, Images, Ban, Trash2, PenLine, Eye, EyeOff, CheckCircle2, Clock, Trash } from 'lucide-react';
import { SignaturePad } from './APREditor';
import { enqueue } from '../lib/offline';
import { enqueuePhoto, getQueuedPhotos, discardQueuedPhoto } from '../lib/photoQueue';
import { thumbSrc } from '../lib/files';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
export const DITAIS_STEPS = [['D', 'D', 'Desligar'], ['I1', 'I', 'Interromper'], ['T', 'T', 'Testar'], ['A', 'A', 'Aterrar'], ['I2', 'I', 'Isolar'], ['S', 'S', 'Sinalizar']];
const FIELDS = [['data_execucao', 'Data execução', 'date'], ['numero_obra', 'N.º da obra'], ['regional', 'Regional'], ['municipio', 'Município'], ['prestadora', 'Prestadora'], ['responsavel', 'Responsável'], ['equipe', 'Equipe']];
const uid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const inp = 'mt-0.5 w-full bg-zinc-950/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#E0FF00]';
const emptySteps = () => Object.fromEntries(DITAIS_STEPS.map(([k]) => [k, { status: 'pendente', na_motivo: '', photo: null }]));
export const ditaisCounts = (steps) => {
  const vals = Object.values(steps || {});
  const fotos = vals.filter((s) => s.status === 'foto').length;
  const na = vals.filter((s) => s.status === 'na').length;
  return { fotos, na, pendentes: 6 - fotos - na };
};

const StepCard = ({ k, letter, name, step, busy, online, onCamera, onPick, onNA, onMotivo, onRemove }) => {
  const fileRef = useRef(null);
  const status = step?.status || 'pendente';
  const color = status === 'foto' ? '#39FF14' : status === 'na' ? '#FF5E00' : '#71717a';
  const src = step?._local || (step?.photo?.url ? `${BACKEND_URL}${step.photo.url}?w=600` : null);
  return (
    <div data-testid={`ditais-step-${k}`} className="rounded-2xl border bg-white/[0.02] p-3 space-y-2" style={{ borderColor: `${color}66` }}>
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 rounded-xl bg-[#E0FF00] text-black font-black text-xl flex items-center justify-center shrink-0">{letter}</span>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm leading-tight">{letter} - {name.toLowerCase()}</p>
          <p data-testid={`ditais-step-${k}-status`} className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
            {status === 'foto' ? (step?._queued ? 'Foto aguardando sync' : 'Foto registrada') : status === 'na' ? 'Não aplicável' : 'Pendente'}
          </p>
        </div>
        {busy ? <Loader className="w-4 h-4 animate-spin text-[#E0FF00]" /> : status === 'foto' ? <CheckCircle2 className="w-4 h-4" style={{ color }} /> : <Clock className="w-4 h-4 text-zinc-600" />}
      </div>
      {status === 'foto' && src ? (
        <div className="relative rounded-xl overflow-hidden bg-black">
          <img data-testid={`ditais-step-${k}-img`} src={src} alt={name} className="w-full aspect-[4/3] object-cover" />
          <span className="absolute top-2 left-2 text-4xl font-black text-[#E0FF00] drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]">{letter}</span>
          <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] font-bold px-2 py-1">DITAIS · {name.toUpperCase()}{step?._queued ? ' · offline' : ''}</span>
        </div>
      ) : status === 'na' ? (
        <div className="rounded-xl border border-dashed border-[#FF5E00]/50 bg-[#FF5E00]/5 p-3 text-center">
          <p className="text-2xl font-black text-[#FF5E00]">N/A</p>
          <input data-testid={`ditais-step-${k}-na-motivo`} value={step?.na_motivo || ''} onChange={(e) => onMotivo(e.target.value)} placeholder="Motivo (opcional)" className={`${inp} text-xs text-center`} />
        </div>
      ) : (
        <button type="button" data-testid={`ditais-step-${k}-placeholder`} onClick={() => fileRef.current?.click()} className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1 text-zinc-500 hover:border-[#E0FF00]/50 hover:text-[#E0FF00]">
          <Camera className="w-7 h-7" /><span className="text-xs font-bold">Tirar foto</span>
        </button>
      )}
      <input ref={fileRef} data-testid={`ditais-step-${k}-file`} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onCamera(f); e.target.value = ''; }} />
      <div className="grid grid-cols-4 gap-1">
        <button type="button" data-testid={`ditais-step-${k}-camera`} onClick={() => fileRef.current?.click()} className="py-1.5 rounded-lg text-[10px] font-bold bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00] inline-flex items-center justify-center gap-1"><Camera className="w-3 h-3" /> Câmera</button>
        <button type="button" data-testid={`ditais-step-${k}-pick`} onClick={onPick} disabled={!online} title={online ? 'Escolher uma foto já tirada na obra' : 'Só com internet'} className="py-1.5 rounded-lg text-[10px] font-bold bg-white/5 border border-white/10 text-zinc-300 inline-flex items-center justify-center gap-1 disabled:opacity-40"><Images className="w-3 h-3" /> Da obra</button>
        <button type="button" data-testid={`ditais-step-${k}-na`} onClick={onNA} className={`py-1.5 rounded-lg text-[10px] font-bold border inline-flex items-center justify-center gap-1 ${status === 'na' ? 'bg-[#FF5E00] text-black border-[#FF5E00]' : 'bg-white/5 border-white/10 text-zinc-300'}`}><Ban className="w-3 h-3" /> N/A</button>
        <button type="button" data-testid={`ditais-step-${k}-remove`} onClick={onRemove} disabled={status !== 'foto'} className="py-1.5 rounded-lg text-[10px] font-bold bg-white/5 border border-white/10 text-zinc-400 inline-flex items-center justify-center gap-1 disabled:opacity-30"><Trash2 className="w-3 h-3" /> Remover</button>
      </div>
    </div>
  );
};

const PhotoPicker = ({ photos, onPick, onClose }) => (
  <div data-testid="ditais-picker" className="fixed inset-0 z-[90] bg-black/90 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
    <div className="bg-[#0f0f10] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
      <div className="p-3 border-b border-white/10 flex items-center gap-2">
        <p className="flex-1 text-white font-bold text-sm">Fotos da obra ({photos.length})</p>
        <button data-testid="ditais-picker-close" onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 text-zinc-300 flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>
      <div className="overflow-y-auto p-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.length === 0 && <p className="col-span-full text-xs text-zinc-500 text-center py-6">Nenhuma foto na obra ainda.</p>}
        {photos.map((ph) => (
          <button key={ph.id} data-testid={`ditais-picker-${ph.id}`} onClick={() => onPick(ph)} className="relative rounded-lg overflow-hidden border border-white/10 hover:border-[#E0FF00]">
            <img src={thumbSrc(ph.data_url || ph.url, 320)} alt="" className="w-full aspect-square object-cover" loading="lazy" />
            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white px-1 py-0.5 truncate">{[ph.point, ph.label].filter(Boolean).join(' · ') || 'foto'}</span>
          </button>
        ))}
      </div>
    </div>
  </div>
);

/** Out/2026 · Formulário DITAIS (Desligar · Interromper · Testar · Aterrar · Isolar · Sinalizar) com 6 fotos, N/A, observação, assinatura e PDF. */
export const DitaisEditor = ({ projectId, project, photos = [], initial = null, onClose, onSaved, onDeleted }) => {
  const clientId = useRef(initial?.client_id || uid());
  const [doc, setDoc] = useState(initial);
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, initial?.[k] || ''])));
  const [obs, setObs] = useState(initial?.observacao || '');
  const [sig, setSig] = useState(initial?.assinatura || '');
  const [sigNome, setSigNome] = useState(initial?.assinatura_nome || '');
  const [steps, setSteps] = useState(() => ({ ...emptySteps(), ...(initial?.steps || {}) }));
  const [online, setOnline] = useState(navigator.onLine);
  const [saving, setSaving] = useState(false);
  const [busyStep, setBusyStep] = useState(null);
  const [picker, setPicker] = useState(null);
  const [showModel, setShowModel] = useState(!initial);
  const counts = useMemo(() => ditaisCounts(steps), [steps]);

  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!initial) {
      const local = { data_execucao: new Date().toISOString().slice(0, 10), numero_obra: project?.project_code || '', regional: 'DCMD', municipio: project?.location || '', prestadora: 'GRUPO ATUAL', responsavel: '', equipe: project?.team_name || '' };
      setForm(local);
      axios.get(`${API}/projects/${projectId}/ditais/prefill`).then(({ data }) => {
        setForm((f) => Object.fromEntries(FIELDS.map(([k]) => [k, f[k] || data[k] || ''])));
        setSigNome((s) => s || data.assinatura_nome || '');
      }).catch(() => {});
    }
    getQueuedPhotos().then((items) => {
      const mine = items.filter((it) => it.meta?.kind === 'ditais' && it.meta?.clientId === clientId.current);
      if (!mine.length) return;
      setSteps((s) => { const n = { ...s }; mine.forEach((it) => { n[it.meta.step] = { status: 'foto', na_motivo: '', photo: null, _local: URL.createObjectURL(it.blob), _queued: true, _qid: it.id }; }); return n; });
    }).catch(() => {});
  }, [initial, projectId, project]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const payload = (stepsNow = steps) => ({ client_id: clientId.current, ...form, observacao: obs, assinatura: sig, assinatura_nome: sigNome,
    steps_na: Object.fromEntries(DITAIS_STEPS.map(([k]) => [k, { na: stepsNow[k]?.status === 'na', motivo: stepsNow[k]?.na_motivo || '' }])) });
  const mergeServer = (data) => {
    setDoc(data);
    setSteps((s) => { const n = { ...data.steps }; Object.keys(s).forEach((k) => { if (s[k]?._queued) n[k] = s[k]; }); return n; });
  };

  const saveOffline = (stepsNow = steps, { silent = false } = {}) => {
    const body = payload(stepsNow);
    enqueue({ type: 'ditais', projectId, data: body }, { replaceKey: clientId.current });
    const c = ditaisCounts(stepsNow);
    const local = { ...(doc || {}), ...body, id: doc?.id || null, project_id: projectId, steps: stepsNow, counts: c, complete: c.pendentes === 0, created_at: doc?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(), _offline: true };
    setDoc(local);
    onSaved?.(local, { offline: true });
    if (!silent) toast.success('DITAIS salvo no celular — sincroniza quando voltar o sinal');
    return local;
  };

  const save = async ({ silent = false } = {}) => {
    if (!navigator.onLine) return saveOffline(steps, { silent });
    const body = payload();
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/projects/${projectId}/ditais`, body);
      mergeServer(data);
      onSaved?.(data, { offline: false });
      if (!silent) toast.success('DITAIS salvo');
      return data;
    } catch (err) {
      if (!err?.response) { toast.warning('Sem conexão — DITAIS guardado no celular'); return saveOffline(steps, { silent: true }); }
      toast.error(err?.response?.data?.detail || 'Erro ao salvar DITAIS');
      return null;
    } finally { setSaving(false); }
  };

  const queueLocal = async (k, file, takenAt) => {
    const qid = await enqueuePhoto({ projectId, file, url: `/projects/${projectId}/ditais/${clientId.current}/steps/${k}/photo`, fields: { taken_at: takenAt }, meta: { kind: 'ditais', clientId: clientId.current, step: k } });
    const nextSteps = { ...steps, [k]: { status: 'foto', na_motivo: '', photo: null, _local: URL.createObjectURL(file), _queued: true, _qid: qid } };
    setSteps(nextSteps);
    saveOffline(nextSteps, { silent: true });
    toast.success('Foto guardada no celular — envia quando voltar o sinal');
  };

  const takePhoto = async (k, file) => {
    const takenAt = new Date().toISOString();
    if (!navigator.onLine) { await queueLocal(k, file, takenAt); return; }
    setBusyStep(k);
    try {
      if (!doc?.id) await save({ silent: true });
      const fd = new FormData(); fd.append('file', file); fd.append('taken_at', takenAt);
      const { data } = await axios.post(`${API}/projects/${projectId}/ditais/${clientId.current}/steps/${k}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90000 });
      mergeServer(data);
      onSaved?.(data, { offline: false, silent: true });
    } catch (err) {
      if (!err?.response) await queueLocal(k, file, takenAt);
      else toast.error(err?.response?.data?.detail || 'Erro ao enviar a foto');
    } finally { setBusyStep(null); }
  };

  const pickFromProject = async (k, ph) => {
    setPicker(null); setBusyStep(k);
    try {
      if (!doc?.id) await save({ silent: true });
      const { data } = await axios.post(`${API}/ditais/${clientId.current}/steps/${k}/from-photo`, { photo_id: ph.id, taken_at: ph.uploaded_at || null });
      mergeServer(data);
      onSaved?.(data, { offline: false, silent: true });
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao vincular a foto'); }
    finally { setBusyStep(null); }
  };

  const removePhoto = async (k) => {
    const st = steps[k];
    if (st?._queued) { if (st._qid != null) await discardQueuedPhoto(st._qid).catch(() => {}); setSteps((s) => ({ ...s, [k]: { status: 'pendente', na_motivo: '', photo: null } })); return; }
    if (!navigator.onLine) { toast.error('Remover foto já enviada exige internet'); return; }
    setBusyStep(k);
    try { const { data } = await axios.delete(`${API}/ditais/${clientId.current}/steps/${k}/photo`); mergeServer(data); onSaved?.(data, { offline: false, silent: true }); }
    catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao remover'); }
    finally { setBusyStep(null); }
  };

  const toggleNA = async (k) => {
    const st = steps[k];
    if (st?.status === 'na') { setSteps((s) => ({ ...s, [k]: { status: 'pendente', na_motivo: '', photo: null } })); return; }
    if (st?._queued && st._qid != null) await discardQueuedPhoto(st._qid).catch(() => {});
    setSteps((s) => ({ ...s, [k]: { status: 'na', na_motivo: '', photo: null } }));
  };

  const downloadPdf = async () => {
    if (!doc?.id) { toast.info('Salve o DITAIS antes de gerar o PDF'); return; }
    try {
      const res = await axios.get(`${API}/ditais/${doc.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `DITAIS_${form.numero_obra || doc.id}_${(form.data_execucao || '').replace(/-/g, '')}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('Erro ao gerar PDF'); }
  };

  const remove = async () => {
    if (!doc?.id || !window.confirm('Excluir este DITAIS e todas as fotos vinculadas?')) return;
    try { await axios.delete(`${API}/ditais/${doc.id}`); toast.success('DITAIS excluído'); onDeleted?.(doc); onClose(); }
    catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao excluir'); }
  };

  return (
    <div data-testid="ditais-editor" className="fixed inset-0 z-[70] bg-black/95 backdrop-blur-xl overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-[#050505]/90 backdrop-blur border-b border-white/10 py-3 px-1">
          <button data-testid="ditais-close" onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 text-white flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#E0FF00]">DITAIS · Procedimento de segurança</p>
            <h2 className="text-white font-bold truncate text-sm sm:text-base">{project?.project_code ? `${project.project_code} · ` : ''}{project?.name || 'Obra'}</h2>
          </div>
          {!online && <span data-testid="ditais-offline-badge" className="text-[10px] font-bold px-2 py-1 rounded-full bg-[#FF5E00]/15 border border-[#FF5E00]/40 text-[#FF5E00] inline-flex items-center gap-1"><WifiOff className="w-3 h-3" /> offline</span>}
          <button data-testid="ditais-pdf" onClick={downloadPdf} disabled={!doc?.id || !online} title={!doc?.id ? 'Salve primeiro' : !online ? 'PDF só com internet' : 'Baixar PDF'} className="text-xs font-bold px-3 py-2 rounded-full bg-white/5 border border-white/10 text-white flex items-center gap-1 disabled:opacity-40"><FileDown className="w-3 h-3" /> PDF</button>
          <button data-testid="ditais-save" onClick={() => save()} disabled={saving} className="text-xs font-black px-4 py-2 rounded-full bg-[#E0FF00] text-black flex items-center gap-1 disabled:opacity-60">{saving ? <Loader className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} {online ? 'Salvar' : 'Salvar offline'}</button>
        </div>

        <div data-testid="ditais-progress" className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-bold text-white">{counts.fotos + counts.na === 6 ? 'Procedimento completo' : `${counts.fotos + counts.na} de 6 etapas registradas`}</p>
            <p className="text-[11px] text-zinc-400"><b className="text-[#39FF14]">{counts.fotos}</b> foto(s) · <b className="text-[#FF5E00]">{counts.na}</b> N/A · <b className="text-zinc-200">{counts.pendentes}</b> pendente(s)</p>
          </div>
          <div className="grid grid-cols-6 gap-1 mt-2">
            {DITAIS_STEPS.map(([k, l]) => { const s = steps[k]?.status; return <div key={k} className="h-2 rounded-full" style={{ background: s === 'foto' ? '#39FF14' : s === 'na' ? '#FF5E00' : 'rgba(255,255,255,0.12)' }} title={`${l}: ${s}`} />; })}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {FIELDS.map(([k, label, type]) => (
            <label key={k} className={k === 'municipio' || k === 'responsavel' ? 'col-span-2' : ''}>
              <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold">{label}</span>
              <input data-testid={`ditais-field-${k}`} type={type || 'text'} value={form[k] || ''} onChange={(e) => setField(k, e.target.value)} className={inp} />
            </label>
          ))}
        </div>

        <button type="button" data-testid="ditais-model-toggle" onClick={() => setShowModel((v) => !v)} className="text-[11px] font-bold text-[#00F0FF] inline-flex items-center gap-1">{showModel ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} {showModel ? 'Ocultar modelo da foto' : 'Ver modelo da foto'}</button>
        {showModel && (
          <div data-testid="ditais-model" className="rounded-2xl border border-white/10 overflow-hidden bg-black">
            <img src="/ditais_modelo.jpg" alt="Modelo das fotos DITAIS" className="w-full max-h-72 object-contain" />
            <p className="text-[10px] text-zinc-400 p-2">Modelo: uma foto por etapa, enquadrando o ponto de trabalho e o profissional executando a ação. A letra e a etiqueta DITAIS são carimbadas automaticamente no PDF.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DITAIS_STEPS.map(([k, letter, name]) => (
            <StepCard key={k} k={k} letter={letter} name={name} step={steps[k]} busy={busyStep === k} online={online}
              onCamera={(f) => takePhoto(k, f)} onPick={() => setPicker(k)} onNA={() => toggleNA(k)}
              onMotivo={(v) => setSteps((s) => ({ ...s, [k]: { ...s[k], na_motivo: v } }))} onRemove={() => removePhoto(k)} />
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold">Observação</span>
          <textarea data-testid="ditais-obs" value={obs} onChange={(e) => setObs(e.target.value)} rows={3} className={`${inp} resize-y`} placeholder="Ocorrências, condições do local, justificativas…" />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label>
            <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold">Nome do responsável (assinatura)</span>
            <input data-testid="ditais-sig-nome" value={sigNome} onChange={(e) => setSigNome(e.target.value)} className={inp} />
          </label>
          <div>
            <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold flex items-center gap-1"><PenLine className="w-3 h-3" /> Assinatura (desenhe com o dedo)</span>
            <SignaturePad testid="ditais-sig" value={sig} onChange={setSig} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pb-6">
          <p className="text-[10px] text-zinc-500">{doc?.updated_at ? `Atualizado ${new Date(doc.updated_at).toLocaleString('pt-BR')}` : 'Ainda não salvo'}{doc?._offline ? ' · aguardando sync' : ''}</p>
          {doc?.id && <button data-testid="ditais-delete" onClick={remove} disabled={!online} className="text-[11px] font-bold text-[#FF003C] inline-flex items-center gap-1 disabled:opacity-40"><Trash className="w-3 h-3" /> Excluir DITAIS</button>}
        </div>
      </div>
      {picker && <PhotoPicker photos={photos} onPick={(ph) => pickFromProject(picker, ph)} onClose={() => setPicker(null)} />}
    </div>
  );
};
