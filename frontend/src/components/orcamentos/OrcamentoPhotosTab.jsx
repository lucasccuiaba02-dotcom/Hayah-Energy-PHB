import React, { useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Camera, Trash2, Upload } from 'lucide-react';
import { API, BACKEND_URL, PHOTO_KINDS, kindOf, inputCls, labelCls, btnGhost, btnPrimary } from './orcamentoShared';

const PhotoCard = ({ orcId, p, onChanged }) => {
  const k = kindOf(p.kind);
  const patch = async (body) => {
    try {
      await axios.patch(`${API}/orcamentos/${orcId}/photos/${p.id}`, body);
      onChanged();
    } catch { toast.error('Falha ao atualizar imagem'); }
  };
  const del = async () => {
    if (!window.confirm('Remover esta imagem?')) return;
    try {
      await axios.delete(`${API}/orcamentos/${orcId}/photos/${p.id}`);
      toast.success('Imagem removida');
      onChanged();
    } catch { toast.error('Falha ao remover'); }
  };
  return (
    <div data-testid={`orc-photo-${p.id}`} className="glass-panel rounded-xl overflow-hidden border border-white/10">
      <a href={`${BACKEND_URL}${p.url}`} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-black/40">
        <img src={`${BACKEND_URL}${p.url}`} alt={p.caption || k.label} className="w-full h-full object-cover" loading="lazy" />
      </a>
      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <select data-testid={`orc-photo-kind-${p.id}`} value={p.kind} onChange={(e) => patch({ kind: e.target.value })} className="bg-zinc-950/90 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase focus:outline-none" style={{ color: k.color }}>
            {PHOTO_KINDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <span className="text-[9px] text-zinc-500 ml-auto truncate">{(p.uploaded_at || '').slice(0, 10).split('-').reverse().join('/')}</span>
          <button data-testid={`orc-photo-delete-${p.id}`} onClick={del} className="p-1 rounded text-zinc-500 hover:text-[#FF003C]"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <input data-testid={`orc-photo-caption-${p.id}`} defaultValue={p.caption || ''} onBlur={(e) => e.target.value !== (p.caption || '') && patch({ caption: e.target.value })} placeholder="Legenda…" className="w-full bg-transparent border-b border-white/10 text-[11px] text-white px-1 py-0.5 focus:outline-none focus:border-[#E0FF00]" />
      </div>
    </div>
  );
};

export const OrcamentoPhotosTab = ({ orcId, photos, onChanged }) => {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const [kind, setKind] = useState('servico');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of list) {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('kind', kind);
      fd.append('caption', caption);
      try { await axios.post(`${API}/orcamentos/${orcId}/photos`, fd); ok += 1; } catch (e) { toast.error(e?.response?.data?.detail || `Falha em ${f.name}`); }
    }
    setBusy(false);
    setCaption('');
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
    if (ok) { toast.success(`${ok} imagem(ns) enviada(s)`); onChanged(); }
  };

  const groups = PHOTO_KINDS.map((k) => ({ ...k, items: photos.filter((p) => p.kind === k.key) })).filter((g) => g.items.length);

  return (
    <div className="space-y-4" data-testid="orc-tab-fotos">
      <div className="rounded-xl border border-dashed border-[#E0FF00]/40 bg-[#E0FF00]/[0.04] p-3 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto] gap-2 items-end">
        <div>
          <label className={labelCls}>Tipo</label>
          <div className="flex gap-1">
            {PHOTO_KINDS.map((k) => (
              <button key={k.key} data-testid={`orc-photo-kind-btn-${k.key}`} onClick={() => setKind(k.key)} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase transition ${kind === k.key ? 'text-black' : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-white'}`} style={kind === k.key ? { background: k.color } : {}}>{k.label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Legenda (opcional)</label>
          <input data-testid="orc-photo-caption-new" value={caption} onChange={(e) => setCaption(e.target.value)} className={inputCls} placeholder="Ex.: Poste existente a ser substituído" />
        </div>
        <button data-testid="orc-photo-camera" disabled={busy} onClick={() => camRef.current?.click()} className={btnPrimary}><Camera className="w-3.5 h-3.5" /> Câmera</button>
        <button data-testid="orc-photo-upload" disabled={busy} onClick={() => fileRef.current?.click()} className={btnGhost}><Upload className="w-3.5 h-3.5" /> {busy ? 'Enviando…' : 'Arquivos'}</button>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} />
        <input ref={fileRef} data-testid="orc-photo-file" type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <p className="sm:col-span-4 text-[10px] text-zinc-500">Fotos de <b>Serviço/Antes</b> entram na Proposta; <b>Antes/Depois/Serviço</b> e <b>Croquis</b> entram no Relatório de Conclusão.</p>
      </div>

      {photos.length === 0 && <p className="text-zinc-500 text-sm italic text-center py-6">Nenhuma imagem ainda.</p>}
      {groups.map((g) => (
        <div key={g.key} data-testid={`orc-photo-group-${g.key}`}>
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold mb-2" style={{ color: g.color }}>{g.label} · {g.items.length}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {g.items.map((p) => <PhotoCard key={p.id} orcId={orcId} p={p} onChanged={onChanged} />)}
          </div>
        </div>
      ))}
    </div>
  );
};
