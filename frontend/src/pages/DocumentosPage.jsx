import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import {
  FolderOpen, FileText, Package, ShieldAlert, Map, FileSearch, Camera,
  Upload, Download, Trash2, Search, X, ChevronDown, ChevronRight, Layers,
  Calendar, Users, DollarSign,
} from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { formatCurrency, PROJECT_TYPE_LABEL } from '../lib/constants';
import { openAttachment, openUrl, thumbSrc } from '../lib/files';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

// Set/2026 · documentos GERADOS pelo sistema (preenchidos pelas equipes de campo) listados junto aos anexos
const GeneratedAprs = ({ aprs, loading }) => (
  <div data-testid="doc-generated-aprs" className="px-4 py-2 border-b border-white/5 bg-[#FF003C]/[0.03]">
    <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">APRs preenchidas pelas equipes · {aprs.length}</p>
    {loading ? <p className="text-[11px] text-zinc-500 italic">Carregando…</p> : aprs.length === 0 ? <p className="text-[11px] text-zinc-500 italic">Nenhuma APR digital nesta obra.</p> : (
      <div className="divide-y divide-white/5">
        {aprs.map((a) => (
          <div key={a.id} data-testid={`doc-apr-${a.id}`} className="flex items-center gap-2 py-1.5 text-xs text-zinc-200 flex-wrap">
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded text-white" style={{ background: a.line_type === 'viva' ? '#FF003C' : '#16a34a' }}>LV{a.line_type === 'viva' ? '' : 'M'}</span>
            <span className="font-mono text-zinc-400">{dateBR(a.date)}</span>
            {a.os_number && <span className="font-mono text-zinc-400">OS {a.os_number}</span>}
            <span className="truncate">{a.supervisor || 'sem supervisor'}</span>
            <span className={`text-[10px] ${a.signed ? 'text-[#39FF14]' : 'text-zinc-500'}`}>{a.signed ? 'assinada' : 'sem assinatura'}</span>
            <button data-testid={`doc-apr-pdf-${a.id}`} onClick={() => openUrl(a.pdf_url)} className="ml-auto w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 text-[#FF003C] flex items-center justify-center" title="Abrir PDF da APR"><Download className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    )}
  </div>
);

const GeneratedRequisitions = ({ reqs, loading }) => (
  <div data-testid="doc-generated-reqs" className="px-4 py-2 border-b border-white/5 bg-[#00F0FF]/[0.03]">
    <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-1">Requisições de almoxarifado (PDF gerado) · {reqs.length}</p>
    {loading ? <p className="text-[11px] text-zinc-500 italic">Carregando…</p> : reqs.length === 0 ? <p className="text-[11px] text-zinc-500 italic">Nenhuma requisição enviada. Anexe abaixo a lista escaneada, se houver.</p> : (
      <div className="divide-y divide-white/5">
        {reqs.map((r) => (
          <div key={r.id} data-testid={`doc-req-${r.id}`} className="flex items-center gap-2 py-1.5 text-xs text-zinc-200 flex-wrap">
            <span className="font-mono text-zinc-400">{dateBR(r.created_at)}</span>
            <span className="font-bold">{r.requisition_type === 'parcial' ? `PARCIAL nº ${r.seq}` : 'Requisição total'}</span>
            <span className="text-zinc-400">{r.items_count} item(ns) · {r.created_by || '—'}</span>
            {r.received_at && <span className="text-[10px] text-[#39FF14]">recebido {dateBR(r.received_at)}</span>}
            {r.receipt_photo_url && <button onClick={() => openUrl(r.receipt_photo_url)} className="text-[10px] text-[#39FF14] underline">canhoto</button>}
            <button data-testid={`doc-req-pdf-${r.id}`} onClick={() => openUrl(r.pdf_url)} className="ml-auto w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 text-[#00F0FF] flex items-center justify-center" title="Abrir PDF da requisição"><Download className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    )}
  </div>
);

class DocsErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div data-testid="doc-error-boundary" className="glass-panel rounded-2xl p-8 text-center">
          <p className="text-[#FF003C] font-bold">A aba Documentos encontrou um erro ao renderizar.</p>
          <p className="text-[11px] text-zinc-500 mt-1 break-words">{String(this.state.error?.message || this.state.error)}</p>
          <button onClick={() => window.location.reload()} className="mt-3 text-[10px] font-bold uppercase text-black bg-[#E0FF00] px-4 py-2 rounded-full">Recarregar página</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Categorias de documento — chave = kind salvo no backend
export const DOC_KINDS = [
  { key: 'projeto',   label: 'Projeto Executivo', icon: FileText,   color: '#E0FF00', hint: 'Plantas, memoriais, projetos assinados' },
  { key: 'materiais', label: 'Lista de Materiais', icon: Package,   color: '#00F0FF', hint: 'Requisições e RM em PDF/XLSX' },
  { key: 'apr',       label: 'APR (Análise de Risco)', icon: ShieldAlert, color: '#FF003C', hint: 'Análise Preliminar de Risco assinada' },
  { key: 'croqui',    label: 'Croqui', icon: Map,      color: '#FF5E00', hint: 'Croquis de campo, esboços' },
  { key: 'dwg',       label: 'Arquivos DWG', icon: FileSearch, color: '#A855F7', hint: 'AutoCAD, DXF, IFC etc.' },
  { key: 'fotos_ext', label: 'Fotos Anexas', icon: Camera,   color: '#39FF14', hint: 'Imagens avulsas (para fotos operacionais use Operacional)' },
];

const fmtBytes = (n) => {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const kindOf = (att) => {
  const k = (att?.kind || '').toLowerCase();
  const alias = { project_pdf: 'projeto', material_pdf: 'materiais' };
  return alias[k] || k || 'projeto';
};

const KindCard = ({ kindDef, attachments, onUpload, onOpen, onRemove, uploading, projectId, generated = null }) => {
  const Icon = kindDef.icon;
  const inputRef = useRef(null);
  return (
    <div
      data-testid={`doc-kind-${kindDef.key}`}
      className="glass-panel rounded-2xl overflow-hidden border transition"
      style={{ borderColor: `${kindDef.color}30` }}
    >
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2" style={{ backgroundColor: `${kindDef.color}0d` }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${kindDef.color}18`, border: `1px solid ${kindDef.color}40` }}>
          <Icon className="w-4 h-4" style={{ color: kindDef.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.22em] uppercase font-bold" style={{ color: kindDef.color }}>{kindDef.label}</p>
          <p className="text-[11px] text-zinc-500 truncate">{kindDef.hint}</p>
        </div>
        <span className="font-mono text-xs font-bold text-white bg-black/40 border border-white/10 px-2 py-0.5 rounded-full">
          {attachments.length}
        </span>
        <button
          type="button"
          data-testid={`doc-upload-${kindDef.key}`}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-[10px] font-bold uppercase text-black px-3 py-1.5 rounded-full disabled:opacity-60"
          style={{ backgroundColor: kindDef.color }}
        >
          <Upload className="inline w-3 h-3 mr-0.5" /> {uploading ? 'Enviando' : 'Anexar'}
        </button>
        <input
          ref={inputRef}
          type="file"
          data-testid={`doc-file-${kindDef.key}`}
          accept={kindDef.key === 'dwg' ? '.dwg,.dxf,.ifc,application/*' : 'application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv'}
          className="hidden"
          onChange={(e) => onUpload(e.target.files?.[0], kindDef.key, () => { if (inputRef.current) inputRef.current.value = ''; })}
        />
      </div>
      {generated}
      {attachments.length === 0 ? (
        <p className="px-4 py-4 text-[11px] italic text-zinc-500 text-center">{generated ? 'Nenhum arquivo escaneado/anexado manualmente.' : 'Nenhum arquivo anexado nessa categoria.'}</p>
      ) : (
        <div className="divide-y divide-white/5">
          {attachments.map((a) => (
            <div key={a.id} data-testid={`doc-att-${projectId}-${a.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02]">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${kindDef.color}12`, border: `1px solid ${kindDef.color}30` }}>
                <FileText className="w-3.5 h-3.5" style={{ color: kindDef.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate" title={a.filename}>{a.filename}</p>
                <p className="text-[10px] text-zinc-500 font-mono">
                  {fmtBytes(a.size)} · {(a.uploaded_at || '').slice(0, 10)} {a.uploaded_by ? `· ${a.uploaded_by}` : ''}
                </p>
              </div>
              <button data-testid={`doc-open-${a.id}`} onClick={() => onOpen(a)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-[#00F0FF] flex items-center justify-center flex-shrink-0" title="Abrir">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button data-testid={`doc-remove-${a.id}`} onClick={() => onRemove(a)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-[#FF003C] flex items-center justify-center flex-shrink-0" title="Remover">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PhotosPanel = ({ photos, projectId, loading = false }) => {
  const imgSrc = (u) => thumbSrc(u);
  const grouped = photos.reduce((acc, ph) => {
    const key = (ph.point || 'Sem ponto').toUpperCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(ph);
    return acc;
  }, {});
  const keys = Object.keys(grouped).sort((a, b) => {
    if (a === 'Sem ponto') return 1;
    if (b === 'Sem ponto') return -1;
    const na = a.match(/(\d+)/), nb = b.match(/(\d+)/);
    if (na && nb) return parseInt(na[1]) - parseInt(nb[1]);
    return a.localeCompare(b);
  });
  return (
    <div data-testid="doc-fotos-operacionais" className="glass-panel rounded-2xl overflow-hidden border border-[#FF5E00]/25">
      <div className="px-4 py-3 border-b border-white/5 bg-[#FF5E00]/[0.04] flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#FF5E00]/18 border border-[#FF5E00]/40">
          <Camera className="w-4 h-4 text-[#FF5E00]" />
        </div>
        <div className="flex-1">
          <p className="text-[10px] tracking-[0.22em] uppercase font-bold text-[#FF5E00]">Fotos Operacionais (por Ponto)</p>
          <p className="text-[11px] text-zinc-500 truncate">Enviadas via aba Operacional com marca d'água</p>
        </div>
        <span className="font-mono text-xs font-bold text-white bg-black/40 border border-white/10 px-2 py-0.5 rounded-full">
          {photos.length}
        </span>
      </div>
      {loading ? (
        <p className="px-4 py-4 text-[11px] italic text-zinc-500 text-center">Carregando fotos…</p>
      ) : photos.length === 0 ? (
        <p className="px-4 py-4 text-[11px] italic text-zinc-500 text-center">Nenhuma foto operacional. Envie na aba Operacional do projeto (P1, P2, ...).</p>
      ) : (
        <div className="p-3 space-y-4">
          {keys.map((pk) => (
            <div key={pk} data-testid={`doc-photos-point-${pk}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs font-black text-[#E0FF00] bg-[#E0FF00]/10 border border-[#E0FF00]/30 px-2 py-0.5 rounded-full">{pk}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{grouped[pk].length} foto(s)</span>
              </div>
              <div className="grid grid-cols-6 md:grid-cols-8 gap-2">
                {grouped[pk].map((ph) => (
                  <button key={ph.id} type="button" onClick={() => openUrl(ph.data_url)} data-testid={`doc-photo-${ph.id}`} className="relative rounded-lg overflow-hidden border border-white/10 group">
                    <img src={imgSrc(ph.data_url)} alt={ph.label} loading="lazy" className="w-full h-20 object-cover group-hover:opacity-90" />
                    <p className="absolute bottom-0.5 left-0.5 text-[9px] text-white font-bold uppercase px-1 py-0.5 rounded bg-black/60">{ph.label}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MaterialsPanel = ({ materials, projectId }) => {
  const totalCost = materials.reduce((s, m) => s + (m.total_cost || 0), 0);
  return (
    <div data-testid="doc-materiais-list" className="glass-panel rounded-2xl overflow-hidden border border-[#00F0FF]/25">
      <div className="px-4 py-3 border-b border-white/5 bg-[#00F0FF]/[0.04] flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#00F0FF]/18 border border-[#00F0FF]/40">
          <Package className="w-4 h-4 text-[#00F0FF]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.22em] uppercase font-bold text-[#00F0FF]">Lista de Materiais</p>
          <p className="text-[11px] text-zinc-500">Cadastro atual da obra · Total {formatCurrency(totalCost)}</p>
        </div>
        <span className="font-mono text-xs font-bold text-white bg-black/40 border border-white/10 px-2 py-0.5 rounded-full">
          {materials.length}
        </span>
      </div>
      {materials.length === 0 ? (
        <p className="px-4 py-4 text-[11px] italic text-zinc-500 text-center">Nenhum material cadastrado. Importe via /materiais.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 bg-white/[0.03] sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Código</th>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-2 py-2">Qtd</th>
                <th className="text-left px-2 py-2">Un</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id} data-testid={`doc-mat-${m.id}`} className="border-t border-white/5">
                  <td className="px-3 py-1.5 font-mono text-[#E0FF00]">{m.code || '-'}</td>
                  <td className="px-3 py-1.5 text-white truncate max-w-[280px]" title={m.item}>{m.item}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-zinc-300">{m.quantity ?? m.qty_requested ?? 0}</td>
                  <td className="px-2 py-1.5 text-zinc-400 uppercase">{m.unit}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-white font-bold">{formatCurrency(m.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const DocumentosPage = () => {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploadingKind, setUploadingKind] = useState(null);
  const [docs, setDocs] = useState(null); // Set/2026 · documentos gerados pelo sistema (APR, fotos, requisições)
  const [docsLoading, setDocsLoading] = useState(false);

  const load = async () => {
    setLoading(true); setLoadError('');
    try {
      const { data } = await axios.get(`${API}/projects`);
      setProjects(Array.isArray(data) ? data : []);
      if (!selected && data?.[0]) setSelected(data[0].id);
    } catch (err) { setLoadError(err?.response?.data?.detail || err?.message || 'Erro ao carregar obras'); toast.error('Erro ao carregar obras'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!selected) { setDocs(null); return; }
    let alive = true;
    setDocsLoading(true);
    axios.get(`${API}/projects/${selected}/documentos`)
      .then(({ data }) => { if (alive) setDocs(data); })
      .catch(() => { if (alive) setDocs(null); })
      .finally(() => { if (alive) setDocsLoading(false); });
    return () => { alive = false; };
  }, [selected]);

  const filtered = useMemo(() => {
    const term = (q || '').toLowerCase().trim();
    if (!term) return projects;
    return projects.filter((p) =>
      (p.project_code || '').toLowerCase().includes(term) ||
      (p.name || '').toLowerCase().includes(term) ||
      (p.team_name || '').toLowerCase().includes(term) ||
      (p.location || '').toLowerCase().includes(term)
    );
  }, [projects, q]);

  const selectedProject = useMemo(() => projects.find((p) => p.id === selected), [projects, selected]);
  const attachments = useMemo(
    () => (selectedProject?.attachments || []).filter((a) => !a.is_deleted),
    [selectedProject?.attachments],
  );
  const attachmentsByKind = useMemo(() => {
    const acc = {};
    for (const k of DOC_KINDS) acc[k.key] = [];
    for (const a of attachments) {
      const k = kindOf(a);
      if (!acc[k]) acc[k] = [];
      acc[k].push(a);
    }
    return acc;
  }, [attachments]);

  const totalDocs = attachments.length + (docs?.counts?.photos || 0) + (docs?.counts?.aprs || 0) + (docs?.counts?.requisitions || 0);

  const upload = async (file, kind, done) => {
    if (!file || !selectedProject) return;
    setUploadingKind(kind);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      const { data } = await axios.post(`${API}/projects/${selectedProject.id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProjects((prev) => prev.map((p) => (p.id === selectedProject.id ? { ...p, attachments: [...(p.attachments || []), data] } : p)));
      toast.success(`${file.name} anexado em ${DOC_KINDS.find((k) => k.key === kind)?.label || kind}`);
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro no upload'); }
    finally { setUploadingKind(null); if (done) done(); }
  };

  const open = (att) => openAttachment(selectedProject.id, att);

  const remove = async (att) => {
    if (!window.confirm(`Remover ${att.filename}?`)) return;
    try {
      await axios.delete(`${API}/projects/${selectedProject.id}/attachments/${att.id}`);
      setProjects((prev) => prev.map((p) => (p.id === selectedProject.id ? { ...p, attachments: (p.attachments || []).filter((a) => a.id !== att.id) } : p)));
      toast.success('Anexo removido');
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro'); }
  };

  return (
    <AppLayout title="Documentos" subtitle="Central de arquivos por obra — projeto executivo, materiais, APR, croqui, DWG e fotos">
      <DocsErrorBoundary>
      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Sidebar Projetos */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-3 border-b border-white/5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input
                data-testid="doc-search-obras"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por código, nome, equipe…"
                className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#E0FF00] focus:outline-none"
              />
              {q && (
                <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 mt-1.5 font-mono uppercase tracking-wider">
              {filtered.length}/{projects.length} obra(s)
            </p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-white/5" data-testid="doc-project-list">
            {loading ? (
              <p className="p-6 text-center text-xs text-zinc-500">Carregando…</p>
            ) : loadError ? (
              <div className="p-6 text-center" data-testid="doc-load-error">
                <p className="text-xs text-[#FF003C] font-bold">Não foi possível carregar as obras</p>
                <p className="text-[10px] text-zinc-500 mt-1 break-words">{loadError}</p>
                <button onClick={load} className="mt-3 text-[10px] font-bold uppercase text-black bg-[#E0FF00] px-3 py-1.5 rounded-full">Tentar novamente</button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-xs text-zinc-500 italic">Nenhuma obra encontrada</p>
            ) : filtered.map((p) => {
              const active = p.id === selected;
              const atts = (p.attachments || []).filter((a) => !a.is_deleted).length;
              const photos = (p.photos || []).length;
              const badge = atts + photos;
              return (
                <button
                  key={p.id}
                  data-testid={`doc-project-${p.id}`}
                  onClick={() => setSelected(p.id)}
                  className={`w-full text-left px-3 py-2.5 transition ${active ? 'bg-[#E0FF00]/10 border-l-2 border-[#E0FF00]' : 'hover:bg-white/[0.02] border-l-2 border-transparent'}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      {p.project_code && <p className="font-mono text-[10px] text-[#E0FF00] uppercase tracking-wider">{p.project_code}</p>}
                      <p className={`text-sm font-bold truncate ${active ? 'text-white' : 'text-zinc-300'}`}>{p.name}</p>
                      {p.team_name && <p className="text-[10px] text-zinc-500 truncate">{p.team_name}</p>}
                    </div>
                    {badge > 0 && (
                      <span className="flex-shrink-0 font-mono text-[10px] font-bold text-black bg-[#E0FF00] px-1.5 py-0.5 rounded-full">
                        {badge}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detalhe da obra */}
        <div className="space-y-4">
          {!selectedProject ? (
            <div className="glass-panel rounded-2xl p-10 text-center">
              <FolderOpen className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-400 font-bold">Escolha uma obra na lista para ver os documentos</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-4" data-testid="doc-project-header">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="w-11 h-11 rounded-xl bg-[#E0FF00]/10 border border-[#E0FF00]/40 flex items-center justify-center flex-shrink-0">
                    <FolderOpen className="w-5 h-5 text-[#E0FF00]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {selectedProject.project_code && (
                      <p className="font-mono text-[11px] text-[#E0FF00] uppercase tracking-wider">{selectedProject.project_code}</p>
                    )}
                    <h2 className="text-white text-xl font-bold truncate">{selectedProject.name}</h2>
                    <div className="flex items-center gap-3 flex-wrap mt-1 text-[11px] text-zinc-500">
                      {selectedProject.team_name && (<span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {selectedProject.team_name}</span>)}
                      {selectedProject.scheduled_date && (<span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {selectedProject.scheduled_date}</span>)}
                      {selectedProject.programmed_value ? (<span className="inline-flex items-center gap-1 font-mono text-white"><DollarSign className="w-3 h-3" /> {formatCurrency(selectedProject.programmed_value)}</span>) : null}
                      {selectedProject.project_type && (<span className="inline-flex items-center gap-1">{PROJECT_TYPE_LABEL[selectedProject.project_type] || selectedProject.project_type}</span>)}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] tracking-widest uppercase font-bold text-zinc-500">Total arquivos</p>
                    <p className="font-mono text-3xl font-black text-[#E0FF00]" data-testid="doc-total-count">{totalDocs}</p>
                  </div>
                </div>
              </motion.div>

              {/* Cards por categoria */}
              <div className="grid md:grid-cols-2 gap-4" data-testid="doc-kinds-grid">
                {DOC_KINDS.map((kd) => (
                  <KindCard
                    key={kd.key}
                    kindDef={kd}
                    attachments={attachmentsByKind[kd.key] || []}
                    onUpload={upload}
                    onOpen={open}
                    onRemove={remove}
                    uploading={uploadingKind === kd.key}
                    projectId={selectedProject.id}
                    generated={kd.key === 'apr' ? <GeneratedAprs aprs={docs?.aprs || []} loading={docsLoading} /> : kd.key === 'materiais' ? <GeneratedRequisitions reqs={docs?.requisitions || []} loading={docsLoading} /> : null}
                  />
                ))}
              </div>

              {/* Fotos operacionais + Materiais (dados do sistema) */}
              <PhotosPanel photos={docs?.photos || []} projectId={selectedProject.id} loading={docsLoading} />
              <MaterialsPanel materials={selectedProject.materials_list || []} projectId={selectedProject.id} />
            </>
          )}
        </div>
      </div>
      </DocsErrorBoundary>
    </AppLayout>
  );
};

export default DocumentosPage;
