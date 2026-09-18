import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Zap, AlertTriangle, Package, CheckCircle2, Camera, X, MapPin, Wifi, WifiOff, FileText, FolderOpen, ShieldCheck, Download, Upload, Trash2, Folder } from 'lucide-react';
import { HayahLogo } from '../components/HayahLogo';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS_LABEL, formatCurrency, resolveMaterialCodeAndDesc } from '../lib/constants';
import { APREditor } from '../components/APREditor';
import { PinchZoomImage } from '../components/PinchZoomImage';
import { AvancoQuickEntry, AvancoItemsTable, ProgressBar, effColor } from '../components/AvancoWidgets';
import { AvancoPdfModal } from '../components/AvancoPdfModal';
import { enqueue, syncQueue } from '../lib/offline';
import { enqueuePhoto, syncPhotoQueue, getQueuedPhotoCount } from '../lib/photoQueue';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const formatBytes = (n) => {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const ProjectDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [photos, setPhotos] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [photoLabel, setPhotoLabel] = useState('antes');
  const [photoPoint, setPhotoPoint] = useState(''); // P1, P2, P3...
  const [dailyNotes, setDailyNotes] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // Fev/2026 · Se veio de /carteira com ?camera=1, abre já na aba Arquivos
  const [tab, setTab] = useState(searchParams.get('camera') === '1' ? 'arquivos' : 'operacional');
  const [uploadingPdf, setUploadingPdf] = useState(false);
  // Fev/2026 · Preview modal pós-captura
  const [previewSrc, setPreviewSrc] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  // Fev/2026 · Lightbox para visualizar fotos existentes em tela cheia
  const [lightbox, setLightbox] = useState(null); // {index, list}
  // Fev/2026 · Fotos aguardando sync no IndexedDB (modo offline)
  const [pendingPhotos, setPendingPhotos] = useState(0);
  // Fev/2026 · APR (Análise Preliminar de Risco)
  const [aprOpen, setAprOpen] = useState(false);
  const [aprList, setAprList] = useState([]);
  const [aprSelected, setAprSelected] = useState(null); // objeto ou null para nova
  const [teams, setTeams] = useState([]);
  const [equipamentos, setEquipamentos] = useState([]);
  const [avanco, setAvanco] = useState(null);
  const [avancoPdfOpen, setAvancoPdfOpen] = useState(false);
  const loadAvanco = () => axios.get(`${API}/projects/${id}/avanco`).then(({ data }) => setAvanco(data)).catch(() => {});

  useEffect(() => {
    axios.get(`${API}/projects/${id}`).then(({ data }) => setProject(data)).catch(() => toast.error('Projeto não encontrado'));
    axios.get(`${API}/operacional/checklist/${id}`).then(({ data }) => {
      setChecklist(data.checklist || {});
      setPhotos(data.photos || []);
    }).catch(() => { /* offline OK */ });
    // APRs + teams + equipamentos vinculados + avanço físico
    axios.get(`${API}/projects/${id}/aprs`).then(({ data }) => setAprList(data || [])).catch(() => {});
    axios.get(`${API}/teams`).then(({ data }) => setTeams(data || [])).catch(() => {});
    axios.get(`${API}/equipamentos?project_id=${id}`).then(({ data }) => setEquipamentos(Array.isArray(data) ? data : [])).catch(() => {});
    loadAvanco();

    const onOn = () => {
      setOnline(true);
      syncQueue(axios, API).then((r) => { if (r.synced > 0) toast.success(`${r.synced} checklist(s) sincronizado(s)`); });
      // Fev/2026 · sincroniza fotos que estavam no IDB aguardando sinal
      syncPhotoQueue(axios, API, null, { force: true }).then(async (r) => {
        if (r.synced > 0) {
          toast.success(`${r.synced} foto(s) sincronizada(s) do offline`);
          // recarrega lista de fotos do backend
          try {
            const { data } = await axios.get(`${API}/operacional/checklist/${id}`);
            setPhotos(data.photos || []);
          } catch {}
        }
        if (r.failed > 0 && r.errors?.length) {
          toast.error(`${r.failed} foto(s) não sincronizaram: ${r.errors[0].message}`, { duration: 7000 });
        }
        setPendingPhotos(await getQueuedPhotoCount());
      });
    };
    const onOff = () => setOnline(false);
    const onSynced = async () => {
      try {
        const { data } = await axios.get(`${API}/operacional/checklist/${id}`);
        setPhotos(data.photos || []);
      } catch {}
      setPendingPhotos(await getQueuedPhotoCount());
    };
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    window.addEventListener('hayah-photos-synced', onSynced);
    // sincroniza na montagem se já online
    if (navigator.onLine) onOn();
    else getQueuedPhotoCount().then(setPendingPhotos);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
      window.removeEventListener('hayah-photos-synced', onSynced);
    };
  }, [id]);

  // Fev/2026 · Auto-abrir câmera quando abrimos com ?camera=1 (a partir da Carteira)
  useEffect(() => {
    if (searchParams.get('camera') !== '1') return;
    const t = setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.click();
    }, 600);
    return () => clearTimeout(t);
  }, [searchParams]);

  // Fev/2026 · Se veio de /programacao com ?apr=1, abre o editor de APR
  useEffect(() => {
    if (searchParams.get('apr') === '1' && project) {
      setAprSelected(null);
      setAprOpen(true);
    }
  }, [searchParams, project]);

  const updateCheck = async (key) => {
    const updated = { ...checklist, [key]: !checklist[key] };
    setChecklist(updated);
    const payload = { [key]: !checklist[key] };
    if (navigator.onLine) {
      try {
        await axios.put(`${API}/operacional/checklist/${id}`, payload);
      } catch {
        enqueue({ type: 'checklist', projectId: id, data: payload });
        toast.info('Salvo offline. Sincronizará ao voltar online.');
      }
    } else {
      enqueue({ type: 'checklist', projectId: id, data: payload });
      toast.info('Offline. Salvo localmente.');
    }
  };

  const buildWatermarkedFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxW = 1600;
          const scale = img.width > maxW ? maxW / img.width : 1;
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const lines = [
            project.project_code ? `Obra: ${project.project_code}` : `Obra: ${project.name}`,
            `Ponto: ${photoLabel.toUpperCase()}`,
            `Data: ${new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
            (project.utm_x || project.utm_y) ? `UTM: ${project.utm_x || '?'} / ${project.utm_y || '?'}` : (project.location ? `Local: ${project.location}` : null),
          ].filter(Boolean);

          const padding = Math.round(canvas.width * 0.02);
          const fontSize = Math.max(16, Math.round(canvas.width * 0.024));
          const lineHeight = Math.round(fontSize * 1.35);
          const boxH = lines.length * lineHeight + padding * 2;
          const boxY = canvas.height - boxH;

          // gradient background
          const grad = ctx.createLinearGradient(0, boxY, 0, canvas.height);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.35, 'rgba(0,0,0,0.55)');
          grad.addColorStop(1, 'rgba(0,0,0,0.85)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, boxY - padding, canvas.width, boxH + padding);

          // brand strip
          ctx.fillStyle = '#E0FF00';
          ctx.fillRect(0, canvas.height - 4, canvas.width, 4);

          ctx.font = `bold ${Math.round(fontSize * 0.85)}px system-ui, sans-serif`;
          ctx.fillStyle = '#E0FF00';
          ctx.textBaseline = 'top';
          ctx.fillText('HAYAH ENERGY', padding, boxY);

          ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 4;
          lines.forEach((text, i) => {
            ctx.fillText(text, padding, boxY + padding + i * lineHeight);
          });
          ctx.shadowBlur = 0;

          canvas.toBlob(
            (blob) => {
              if (!blob) return reject(new Error('blob'));
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '_wm.jpg', { type: 'image/jpeg' }));
            },
            'image/jpeg',
            0.9,
          );
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Fev/2026 · Abre preview modal antes de enviar; usuário confirma ou refaz
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewSrc(ev.target.result);
      setPreviewFile(file);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const confirmPhotoUpload = async () => {
    if (!previewFile) return;
    const file = previewFile;
    setPreviewSrc(null);
    setPreviewFile(null);
    setUploading(true);
    try {
      let outFile = file;
      try {
        outFile = await buildWatermarkedFile(file);
      } catch (err) {
        console.warn('Watermark failed, sending original', err);
      }
      // Fev/2026 · Se offline OU falhar o POST, enfileira no IndexedDB para sync posterior
      if (!navigator.onLine) {
        await enqueuePhoto({ projectId: id, file: outFile, label: photoLabel, point: (photoPoint || '').trim() });
        setPendingPhotos(await getQueuedPhotoCount());
        toast.info(`Offline — foto salva no celular. Sincroniza automaticamente ao voltar sinal.`);
        // auto-increment point mesmo offline
        if (photoPoint) {
          const m = photoPoint.match(/^([A-Za-z]*)(\d+)$/);
          if (m) setPhotoPoint(`${m[1] || 'P'}${parseInt(m[2], 10) + 1}`);
        }
        return;
      }
      const formData = new FormData();
      formData.append('file', outFile);
      formData.append('label', photoLabel);
      formData.append('point', (photoPoint || '').trim());
      try {
        const { data } = await axios.post(`${API}/operacional/photos/${id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setPhotos([...photos, data]);
        toast.success(`Foto enviada com marca d'água${data.point ? ` (${data.point})` : ''}!`);
      } catch (err) {
        // Falhou (timeout/rede) — enfileira offline
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail;
        if (status && status >= 400 && status < 500 && status !== 401) {
          toast.error(detail || `Foto recusada pelo servidor (HTTP ${status})`);
          return;
        }
        await enqueuePhoto({ projectId: id, file: outFile, label: photoLabel, point: (photoPoint || '').trim() });
        setPendingPhotos(await getQueuedPhotoCount());
        toast.warning(`Sem resposta do servidor${detail ? ` (${detail})` : ''} — foto salva no celular para sincronizar depois.`);
      }
      // Auto-increment point (P1 → P2 → P3, etc.)
      if (photoPoint) {
        const m = photoPoint.match(/^([A-Za-z]*)(\d+)$/);
        if (m) {
          const prefix = m[1] || 'P';
          setPhotoPoint(`${prefix}${parseInt(m[2], 10) + 1}`);
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const cancelPhotoPreview = () => {
    setPreviewSrc(null);
    setPreviewFile(null);
    // reabre o seletor para o usuário refazer
    setTimeout(() => { if (fileInputRef.current) fileInputRef.current.click(); }, 100);
  };

  const handlePhotoDelete = async (photoId) => {
    if (!window.confirm('Excluir esta foto?')) return;
    try {
      await axios.delete(`${API}/operacional/photos/${id}/${photoId}`);
      setPhotos(photos.filter((p) => p.id !== photoId));
      toast.success('Foto excluída');
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  // === Arquivos: PDF do projeto (upload / listar / abrir / remover) ===
  const attachments = useMemo(() => (project?.attachments || []).filter((a) => !a.is_deleted), [project?.attachments]);
  const materials = useMemo(() => project?.materials_list || [], [project?.materials_list]);
  const materialsTotal = useMemo(() => materials.reduce((s, m) => s + (m.total_cost || 0), 0), [materials]);

  const uploadPdf = async (file, kind = 'projeto') => {
    if (!file) return;
    setUploadingPdf(true);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      const { data } = await axios.post(`${API}/projects/${id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProject((prev) => ({ ...prev, attachments: [...(prev?.attachments || []), data] }));
      toast.success(`Anexo enviado: ${data.filename}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro no upload');
    } finally {
      setUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };
  const [uploadKind, setUploadKind] = useState('projeto');

  const openAttachment = async (att) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/projects/${id}/attachments/${att.id}`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast.error('Erro ao abrir arquivo'); }
  };

  const removeAttachment = async (attId) => {
    if (!window.confirm('Remover este anexo?')) return;
    try {
      await axios.delete(`${API}/projects/${id}/attachments/${attId}`);
      setProject((prev) => ({ ...prev, attachments: (prev?.attachments || []).filter((a) => a.id !== attId) }));
      toast.success('Anexo removido');
    } catch { toast.error('Erro ao remover'); }
  };

  const handleDownloadDailyLog = async () => {
    setDownloadingPdf(true);
    try {
      const { data } = await axios.get(`${API}/operacional/daily-log/${id}`, {
        params: { notes: dailyNotes },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `diario_${(project?.project_code || id).replace(/[^A-Za-z0-9]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Diário de Obra gerado!');
    } catch (err) {
      toast.error('Erro ao gerar o Diário de Obra');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!project) return null;
  const execStatus = EXECUTION_STATUS_LABEL[project.execution_status];

  // Group photos by point for the Arquivos tab (Google Drive style)
  const photosByPoint = photos.reduce((acc, ph) => {
    const key = (ph.point || 'Sem ponto').toUpperCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(ph);
    return acc;
  }, {});
  const pointKeys = Object.keys(photosByPoint).sort((a, b) => {
    if (a === 'Sem ponto') return 1;
    if (b === 'Sem ponto') return -1;
    const na = a.match(/(\d+)/), nb = b.match(/(\d+)/);
    if (na && nb) return parseInt(na[1]) - parseInt(nb[1]);
    return a.localeCompare(b);
  });

  return (
    <div className="min-h-screen bg-[#050505]">
      <div className="border-b border-white/8 bg-[#09090b]/50 backdrop-blur-xl sticky top-0 z-20">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            data-testid="pd-back"
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <HayahLogo size="sm" showText={false} />
          <div className="flex-1 min-w-0">
            {project.project_code && (
              <p className="font-mono text-xs text-[#E0FF00]">{project.project_code}</p>
            )}
            <h1 className="text-white font-bold truncate">{project.name}</h1>
          </div>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${online ? 'text-[#39FF14]' : 'text-[#FF003C]'}`} title={online ? 'Online' : 'Offline — fotos serão sincronizadas ao voltar sinal'}>
            {online ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          </div>
          {pendingPhotos > 0 && (
            <div
              data-testid="pd-pending-photos-badge"
              className="px-2 py-1 rounded-full bg-[#FF5E00]/15 border border-[#FF5E00]/50 text-[#FF5E00] text-[10px] font-black font-mono flex items-center gap-1"
              title={`${pendingPhotos} foto(s) aguardando sincronização`}
            >
              <Upload className="w-3 h-3" />{pendingPhotos}
            </div>
          )}
        </div>
        {/* Tabs */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <button
            data-testid="pd-tab-operacional"
            onClick={() => setTab('operacional')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-full border transition ${
              tab === 'operacional'
                ? 'bg-[#E0FF00] border-[#E0FF00] text-black'
                : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Operacional
          </button>
          <button
            data-testid="pd-tab-arquivos"
            onClick={() => setTab('arquivos')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-full border transition ${
              tab === 'arquivos'
                ? 'bg-[#E0FF00] border-[#E0FF00] text-black'
                : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" /> Arquivos
            <span className="ml-1 font-mono text-[9px] px-1.5 py-0.5 rounded-full bg-black/20 border border-white/10">
              {attachments.length + photos.length + materials.length}
            </span>
          </button>
        </div>
      </div>

      {tab === 'operacional' && (
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <div className="glass-panel rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span
              className="px-3 py-1 rounded-full text-xs font-bold border"
              style={{ backgroundColor: `${execStatus?.color}15`, borderColor: `${execStatus?.color}40`, color: execStatus?.color }}
            >
              {execStatus?.label}
            </span>
            <p className="font-mono text-sm font-bold text-white">{formatCurrency(project.programmed_value)}</p>
          </div>
          <p className="text-xs text-zinc-500 mb-2">{PROJECT_TYPE_LABEL[project.project_type]}</p>
          {project.location && (
            <p className="text-sm text-zinc-300 flex items-start gap-1"><MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500" />{project.location}</p>
          )}
          {project.team_name && <p className="text-xs text-zinc-500 mt-2">Equipe: <span className="text-white">{project.team_name}</span></p>}
        </div>

        {/* Set/2026 · Avanço Físico (obras de ticket grande) */}
        {avanco?.eligible && (
          <div data-testid="pd-avanco-card" className="glass-panel rounded-2xl p-4 border border-[#39FF14]/30">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#39FF14]">Avanço Físico</p>
                <p className="text-xs text-zinc-500">Obra de ticket grande · lance o executado do dia</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-black text-[#39FF14] leading-none">{avanco.summary.pct_fisico}%</p>
                <p className="text-[10px] text-zinc-500">
                  tempo {avanco.summary.pct_tempo === null ? '—' : `${avanco.summary.pct_tempo}%`} · efic. <span className="font-bold" style={{ color: effColor(avanco.summary.eficiencia) }}>{avanco.summary.eficiencia === null ? '—' : avanco.summary.eficiencia.toFixed(2)}</span>
                </p>
              </div>
            </div>
            <ProgressBar pct={avanco.summary.pct_fisico} color="#39FF14" />
            <div className="mt-3">
              <AvancoQuickEntry projectId={id} items={avanco.items} compact onSaved={loadAvanco} />
            </div>
            {avanco.items.length > 0 && <div className="mt-3"><AvancoItemsTable items={avanco.items} /></div>}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button data-testid="pd-avanco-open" onClick={() => navigate(`/avanco?obra=${id}`)} className="text-[11px] font-bold text-[#39FF14] underline">Ver curva S, materiais e histórico completo</button>
              <button
                data-testid="pd-avanco-pdf"
                onClick={() => setAvancoPdfOpen(true)}
                className="text-[11px] font-bold px-3 py-1 rounded-full bg-[#39FF14]/15 border border-[#39FF14]/40 text-[#39FF14]"
              >
                Relatório PDF
              </button>
            </div>
            <AvancoPdfModal open={avancoPdfOpen} projectId={id} projectCode={project?.project_code} onClose={() => setAvancoPdfOpen(false)} />
          </div>
        )}

        {/* Fev/2026 · APR (Análise Preliminar de Risco) */}
        <div className="glass-panel rounded-2xl p-4 border border-[#FF003C]/30">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF003C]">APR — Segurança</p>
              <p className="text-xs text-zinc-500">Análise Preliminar de Risco digital</p>
            </div>
            <button
              data-testid="pd-apr-new"
              onClick={() => { setAprSelected(null); setAprOpen(true); }}
              className="text-xs font-black px-3 py-2 rounded-full bg-[#FF003C] text-white flex items-center gap-1"
            >
              <ShieldCheck className="w-3 h-3" /> Nova APR
            </button>
          </div>
          {aprList.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">Nenhuma APR emitida ainda</p>
          ) : (
            <div className="space-y-1.5">
              {aprList.map((a) => (
                <button
                  key={a.id}
                  data-testid={`pd-apr-item-${a.id}`}
                  onClick={() => { setAprSelected(a); setAprOpen(true); }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 hover:border-white/30 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-bold truncate">
                      {a.header?.task || 'APR'} <span className="font-mono text-[10px] text-[#E0FF00]">#{a.os_number || '—'}</span>
                    </p>
                    <p className="text-[10px] text-zinc-500">{(a.header?.date || '').slice(0, 10)} · <span className={a.line_type === 'viva' ? 'text-[#FF003C] font-bold' : 'text-[#39FF14] font-bold'}>LINHA {a.line_type === 'viva' ? 'VIVA' : 'MORTA'}</span> · {(a.executores || []).length + (a.supervisor?.nome ? 1 : 0)} assinatura(s)</p>
                  </div>
                  <span className="text-[10px] text-zinc-400 shrink-0">Abrir</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Checklist de Segurança</p>
          <div className="space-y-2">
            {project.requires_hot_line && (
              <ChecklistRow
                testid="pd-check-hotline"
                icon={Zap}
                color="#FF5E00"
                label="Linha Viva — EPI Completo"
                sub="Confirmar equipamentos de proteção"
                checked={checklist.hotline_confirmed}
                onToggle={() => updateCheck('hotline_confirmed')}
              />
            )}
            {project.shutdown_info && (
              <ChecklistRow
                testid="pd-check-shutdown"
                icon={AlertTriangle}
                color="#E0FF00"
                label="Desligamento Confirmado"
                sub={project.shutdown_info}
                checked={checklist.shutdown_confirmed}
                onToggle={() => updateCheck('shutdown_confirmed')}
              />
            )}
            <ChecklistRow
              testid="pd-check-material"
              icon={Package}
              color="#39FF14"
              label="Material Separado"
              checked={checklist.material_confirmed}
              onToggle={() => updateCheck('material_confirmed')}
            />
            <ChecklistRow
              testid="pd-check-team"
              icon={CheckCircle2}
              color="#00F0FF"
              label="Equipe no Local"
              checked={checklist.team_confirmed}
              onToggle={() => updateCheck('team_confirmed')}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500">Fotos ({photos.length})</p>
            <div className="flex items-center gap-2">
              <select
                data-testid="pd-photo-label"
                value={photoLabel}
                onChange={(e) => setPhotoLabel(e.target.value)}
                className="bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
              >
                <option value="antes">Antes</option>
                <option value="durante">Durante</option>
                <option value="depois">Depois</option>
              </select>
              <input
                data-testid="pd-photo-point"
                value={photoPoint}
                onChange={(e) => setPhotoPoint(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="P1"
                className="w-16 bg-zinc-950/90 border border-[#E0FF00]/30 rounded-full px-2 py-1 text-xs text-[#E0FF00] font-mono font-bold text-center focus:border-[#E0FF00] focus:outline-none"
                title="Ponto/local da foto (ex: P1, P2, P3). Auto-incrementa após cada envio."
              />
              <button
                data-testid="pd-photo-add"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-[#E0FF00] text-black hover:scale-105 transition-all disabled:opacity-50"
              >
                <Camera className="w-3 h-3" />
                {uploading ? 'Enviando...' : 'Foto'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {photos.length === 0 ? (
              <p className="col-span-2 text-center py-8 text-zinc-600 text-sm">Nenhuma foto ainda</p>
            ) : (
              [...photos].sort((a, b) => {
                // Sort by point (P1, P2, ..., P10) natural order, no-point at end
                const na = (a.point || '').match(/(\d+)/);
                const nb = (b.point || '').match(/(\d+)/);
                if (a.point && !b.point) return -1;
                if (!a.point && b.point) return 1;
                if (na && nb) return parseInt(na[1]) - parseInt(nb[1]);
                return (a.point || '').localeCompare(b.point || '');
              }).map((ph) => (
                <div key={ph.id} data-testid={`pd-photo-${ph.id}`} className="relative rounded-lg overflow-hidden border border-white/10">
                  <img src={ph.data_url} alt={ph.label} className="w-full h-32 object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"></div>
                  {ph.point && (
                    <span data-testid={`pd-photo-point-${ph.id}`} className="absolute top-1 left-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-[#E0FF00] text-black">
                      {ph.point}
                    </span>
                  )}
                  <p className="absolute bottom-1 left-2 text-xs text-white font-bold uppercase">{ph.label}</p>
                  <button
                    onClick={() => handlePhotoDelete(ph.id)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-[#FF003C]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <p className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 mb-3">Diário de Obra</p>
          <div className="glass-panel rounded-xl p-4 space-y-3">
            <textarea
              data-testid="pd-daily-notes"
              value={dailyNotes}
              onChange={(e) => setDailyNotes(e.target.value)}
              placeholder="Observações do turno (opcional): ocorrências, decisões, pendências, etc."
              rows={3}
              className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-[#E0FF00] focus:outline-none resize-none"
            />
            <button
              data-testid="pd-download-daily-log"
              onClick={handleDownloadDailyLog}
              disabled={downloadingPdf}
              className="w-full flex items-center justify-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black font-bold py-3 rounded-full transition-all disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {downloadingPdf ? 'Gerando PDF...' : 'Baixar Diário de Obra (PDF)'}
            </button>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Consolida checklist, fotos com marca d'água e observações em um único PDF do turno.
            </p>
          </div>
        </div>
      </div>
      )}

      {tab === 'arquivos' && (
        <div data-testid="pd-arquivos" className="p-4 space-y-4 max-w-2xl mx-auto">
          {/* Resumo da obra */}
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span
                className="px-3 py-1 rounded-full text-xs font-bold border"
                style={{ backgroundColor: `${execStatus?.color}15`, borderColor: `${execStatus?.color}40`, color: execStatus?.color }}
              >
                {execStatus?.label}
              </span>
              <p className="font-mono text-sm font-bold text-white">{formatCurrency(project.programmed_value)}</p>
            </div>
            <p className="text-xs text-zinc-500 mb-1">{PROJECT_TYPE_LABEL[project.project_type]}</p>
            <p className="text-[11px] text-zinc-500">
              Central de arquivos consolidada — projetos, materiais e fotos organizados por ponto.
            </p>
          </div>

          {/* Documentos do Projeto categorizados (PDFs / DWG / imagens) */}
          <div data-testid="pd-arquivos-docs" className="glass-panel rounded-2xl overflow-hidden border border-[#E0FF00]/25">
            <div className="px-4 py-3 border-b border-white/5 bg-[#E0FF00]/[0.04]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#E0FF00]" />
                <div className="flex-1">
                  <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Documentos da Obra</p>
                  <p className="text-[11px] text-zinc-400">{attachments.length} arquivo(s) · até 25MB</p>
                </div>
                <button
                  type="button"
                  data-testid="pd-attachment-upload"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={uploadingPdf}
                  className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#E0FF00] hover:bg-[#C8E600] text-black px-3 py-1.5 rounded-full disabled:opacity-60"
                >
                  <Upload className="w-3 h-3" /> {uploadingPdf ? 'Enviando…' : 'Anexar'}
                </button>
              </div>
              <div className="flex gap-1 mt-2 flex-wrap">
                {[
                  { k: 'projeto',   l: 'Projeto',    c: '#E0FF00' },
                  { k: 'materiais', l: 'Materiais',  c: '#00F0FF' },
                  { k: 'apr',       l: 'APR',        c: '#FF003C' },
                  { k: 'croqui',    l: 'Croqui',     c: '#FF5E00' },
                  { k: 'dwg',       l: 'DWG',        c: '#A855F7' },
                  { k: 'fotos_ext', l: 'Foto anexa', c: '#39FF14' },
                ].map((o) => (
                  <button
                    key={o.k}
                    type="button"
                    data-testid={`pd-att-kind-${o.k}`}
                    onClick={() => setUploadKind(o.k)}
                    className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border transition"
                    style={{
                      color: uploadKind === o.k ? '#000' : o.c,
                      backgroundColor: uploadKind === o.k ? o.c : `${o.c}12`,
                      borderColor: `${o.c}55`,
                    }}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-500 mt-1.5">
                Categoria selecionada:{' '}
                <span className="font-bold text-white">{uploadKind}</span> · O botão Anexar salva nessa categoria.
              </p>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf,.dwg,.dxf,.ifc,image/*,.xlsx,.xls,.csv"
                className="hidden"
                data-testid="pd-attachment-input"
                onChange={(e) => uploadPdf(e.target.files?.[0], uploadKind)}
              />
            </div>
            {attachments.length === 0 ? (
              <p className="px-4 py-6 text-[11px] text-zinc-500 italic text-center">
                Nenhum documento anexado. Escolha uma categoria acima e clique em Anexar.
              </p>
            ) : (
              <div className="divide-y divide-white/5">
                {attachments.map((a) => {
                  const legacy = { project_pdf: 'projeto', material_pdf: 'materiais' };
                  const k = (legacy[a.kind] || a.kind || 'projeto').toLowerCase();
                  const colorMap = { projeto: '#E0FF00', materiais: '#00F0FF', apr: '#FF003C', croqui: '#FF5E00', dwg: '#A855F7', fotos_ext: '#39FF14', other: '#94A3B8' };
                  const col = colorMap[k] || '#94A3B8';
                  return (
                    <div key={a.id} data-testid={`pd-att-row-${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${col}18`, border: `1px solid ${col}40` }}>
                        <FileText className="w-4 h-4" style={{ color: col }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-bold truncate">{a.filename}</p>
                          <span className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border" style={{ color: col, backgroundColor: `${col}15`, borderColor: `${col}55` }}>
                            {k}
                          </span>
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {formatBytes(a.size)} · {(a.uploaded_at || '').slice(0, 10)}
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid={`pd-att-open-${a.id}`}
                        onClick={() => openAttachment(a)}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-[#00F0FF] flex items-center justify-center flex-shrink-0"
                        title="Abrir"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid={`pd-att-remove-${a.id}`}
                        onClick={() => removeAttachment(a.id)}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-[#FF003C] flex items-center justify-center flex-shrink-0"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Lista de Materiais */}
          <div data-testid="pd-arquivos-materiais" className="glass-panel rounded-2xl overflow-hidden border border-[#00F0FF]/25">
            <div className="px-4 py-3 border-b border-white/5 bg-[#00F0FF]/[0.04] flex items-center gap-2">
              <Package className="w-4 h-4 text-[#00F0FF]" />
              <div className="flex-1">
                <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#00F0FF]">Lista de Materiais</p>
                <p className="text-[11px] text-zinc-400">
                  {materials.length} item(s) · Total estimado{' '}
                  <span className="font-mono font-bold text-white">{formatCurrency(materialsTotal)}</span>
                </p>
              </div>
            </div>
            {materials.length === 0 ? (
              <p className="px-4 py-6 text-[11px] text-zinc-500 italic text-center">
                Nenhum material cadastrado. Importe via planilha na aba de edição da obra.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 bg-white/[0.03] sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-2">Código</th>
                      <th className="text-left px-3 py-2">Descrição</th>
                      <th className="text-right px-2 py-2">Qtd</th>
                      <th className="text-left px-2 py-2">Un</th>
                      <th className="text-right px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m) => {
                      const { code: rc, description: rd } = resolveMaterialCodeAndDesc(m);
                      return (
                        <tr key={m.id} data-testid={`pd-mat-row-${m.id}`} className="border-t border-white/5">
                          <td className="px-2 py-1.5 font-mono text-[#E0FF00]" title={rc || '-'}>{rc || '-'}</td>
                          <td className="px-3 py-1.5 text-white truncate max-w-[220px]" title={rd}>{rd || <span className="italic text-zinc-500">—</span>}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-zinc-300">{m.quantity}</td>
                          <td className="px-2 py-1.5 text-zinc-400 uppercase">{m.unit}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-white font-bold">{formatCurrency(m.total_cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Equipamentos vinculados à obra (Set/2026) */}
          <div data-testid="pd-arquivos-equipamentos" className="glass-panel rounded-2xl overflow-hidden border border-[#E0FF00]/25">
            <div className="px-4 py-3 border-b border-white/5 bg-[#E0FF00]/[0.04] flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#E0FF00]" />
              <div className="flex-1">
                <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Equipamentos na Obra</p>
                <p className="text-[11px] text-zinc-400">
                  {equipamentos.length} equipamento(s) · {equipamentos.filter((e) => e.tipo === 'transformador').length} trafo(s) · {equipamentos.filter((e) => e.tipo === 'religador').length} religador(es) · {equipamentos.filter((e) => e.tipo === 'regulador_tensao').length} regulador(es)
                </p>
              </div>
              <button
                data-testid="pd-equip-open-page"
                onClick={() => navigate('/equipamentos')}
                className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00]/15 border border-[#E0FF00]/40 text-[#E0FF00] hover:bg-[#E0FF00]/25"
              >
                Gerenciar
              </button>
            </div>
            {equipamentos.length === 0 ? (
              <p className="px-4 py-6 text-[11px] text-zinc-500 italic text-center">
                Nenhum equipamento vinculado. Na aba Equipamentos, selecione esta obra no campo "Obra vinculada".
              </p>
            ) : (
              <div className="divide-y divide-white/5">
                {equipamentos.map((e) => {
                  const meta = { transformador: ['Transformador', '#E0FF00'], religador: ['Religador', '#00F0FF'], regulador_tensao: ['Regulador de Tensão', '#FF5E00'] }[e.tipo] || [e.tipo, '#94A3B8'];
                  const fotos = e.photos || [];
                  return (
                    <div key={e.id} data-testid={`pd-equip-${e.id}`} className="px-4 py-3 flex items-start gap-3 flex-wrap">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${meta[1]}15`, border: `1px solid ${meta[1]}40` }}>
                        <Zap className="w-4 h-4" style={{ color: meta[1] }} />
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase" style={{ background: `${meta[1]}20`, color: meta[1], border: `1px solid ${meta[1]}40` }}>{meta[0]}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${e.condicao === 'novo' ? 'bg-[#39FF14]/20 text-[#39FF14] border border-[#39FF14]/40' : 'bg-[#FFB800]/20 text-[#FFB800] border border-[#FFB800]/40'}`}>{e.condicao === 'novo' ? 'Novo' : 'Reforma'}</span>
                          {e.potencia && <span className="font-mono text-[10px] text-zinc-400">{e.potencia}</span>}
                        </div>
                        <p className="text-sm font-bold text-white mt-1">{e.descricao || '—'}</p>
                        <p className="text-[11px] text-zinc-400 font-mono">
                          Patrimônio: <span className="text-white">{e.patrimonio || '—'}</span> · Série: <span className="text-white">{e.numero_serie || '—'}</span>
                          {e.codigo_material && <> · Cód: <span className="text-white">{e.codigo_material}</span></>}
                          {e.fabricante && <> · {e.fabricante}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {fotos.slice(0, 3).map((f) => (
                          <img
                            key={f.id}
                            data-testid={`pd-equip-photo-${f.id}`}
                            src={`${API}/equipamentos/${e.id}/photos/${f.id}`}
                            alt={f.filename}
                            className="w-12 h-12 rounded-md object-cover border border-white/10"
                          />
                        ))}
                        {fotos.length === 0 && <span className="text-[10px] text-zinc-600 italic">sem fotos</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Fotos organizadas por Ponto */}
          <div data-testid="pd-arquivos-fotos" className="glass-panel rounded-2xl overflow-hidden border border-[#FF5E00]/25">
            <div className="px-4 py-3 border-b border-white/5 bg-[#FF5E00]/[0.04] flex items-center gap-2">
              <Folder className="w-4 h-4 text-[#FF5E00]" />
              <div className="flex-1">
                <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#FF5E00]">Fotos por Ponto</p>
                <p className="text-[11px] text-zinc-400">
                  {photos.length} foto(s) · {pointKeys.length} ponto(s) mapeado(s)
                </p>
              </div>
            </div>
            {photos.length === 0 ? (
              <p className="px-4 py-6 text-[11px] text-zinc-500 italic text-center">
                Nenhuma foto ainda. Envie na aba Operacional identificando o ponto (P1, P2, ...).
              </p>
            ) : (
              <div className="p-3 space-y-4">
                {pointKeys.map((pk) => (
                  <div key={pk} data-testid={`pd-arq-point-${pk}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-xs font-black text-[#E0FF00] bg-[#E0FF00]/10 border border-[#E0FF00]/30 px-2 py-0.5 rounded-full">
                        {pk}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {photosByPoint[pk].length} foto(s)
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {photosByPoint[pk].map((ph, phIdx) => {
                        // Fev/2026 · lista plana ordenada dos pontos + índice global para o lightbox
                        const flat = pointKeys.flatMap((k) => photosByPoint[k]);
                        const globalIdx = flat.findIndex((x) => x.id === ph.id);
                        return (
                          <button
                            type="button"
                            key={ph.id}
                            onClick={() => setLightbox({ index: globalIdx, list: flat })}
                            data-testid={`pd-arq-photo-${ph.id}`}
                            className="relative rounded-lg overflow-hidden border border-white/10 group cursor-zoom-in text-left"
                            title="Clique para ampliar"
                          >
                            <img src={ph.data_url} alt={ph.label} className="w-full h-24 object-cover group-hover:opacity-90" />
                            <p className="absolute bottom-1 left-1 text-[9px] text-white font-bold uppercase px-1.5 py-0.5 rounded bg-black/60">
                              {ph.label}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'arquivos' && (
      <div className="p-4 space-y-4 max-w-3xl mx-auto">
      </div>
      )}

      {/* Fev/2026 · Lightbox para visualizar fotos em tela cheia (mobile-friendly) */}
      {lightbox && (
        <div
          data-testid="pd-lightbox"
          className="fixed inset-0 z-[80] bg-black/95 backdrop-blur-xl flex flex-col"
          onClick={() => setLightbox(null)}
        >
          <div className="p-3 flex items-center gap-2 border-b border-white/10" onClick={(e) => e.stopPropagation()}>
            <button
              data-testid="pd-lightbox-close"
              onClick={() => setLightbox(null)}
              className="w-10 h-10 rounded-full bg-white/5 border border-white/10 text-white flex items-center justify-center"
              aria-label="Fechar"
            >
              ✕
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold truncate">
                {(lightbox.list[lightbox.index]?.point || '—').toUpperCase()} · {(lightbox.list[lightbox.index]?.label || '').toUpperCase()}
              </p>
              <p className="text-[10px] text-zinc-400 font-mono truncate">
                {(lightbox.list[lightbox.index]?.uploaded_at || '').slice(0, 19).replace('T', ' ')}
                {'  ·  '}{lightbox.index + 1} de {lightbox.list.length}
              </p>
            </div>
            <a
              data-testid="pd-lightbox-download"
              href={lightbox.list[lightbox.index]?.data_url}
              download={`foto_${lightbox.list[lightbox.index]?.id || 'obra'}.jpg`}
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] font-black bg-[#E0FF00] text-black px-3 py-2 rounded-full"
              title="Baixar imagem"
            >
              Baixar
            </a>
          </div>
          <div className="flex-1 flex items-center justify-center p-2 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <PinchZoomImage
              testid="pd-lightbox-image"
              src={lightbox.list[lightbox.index]?.data_url}
              alt={lightbox.list[lightbox.index]?.label}
              resetKey={lightbox.index}
              className="w-full h-full"
            />
          </div>
          <p className="text-[10px] text-zinc-500 text-center pb-1" onClick={(e) => e.stopPropagation()}>
            Pinça 2 dedos para zoom · Duplo-toque para 2.5× · Arraste para navegar
          </p>
          {lightbox.list.length > 1 && (
            <div className="p-3 flex items-center justify-between gap-3 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
              <button
                data-testid="pd-lightbox-prev"
                disabled={lightbox.index === 0}
                onClick={() => setLightbox((s) => ({ ...s, index: Math.max(0, s.index - 1) }))}
                className="flex-1 py-2 rounded-full bg-white/5 border border-white/10 text-white font-bold disabled:opacity-40"
              >
                ← Anterior
              </button>
              <button
                data-testid="pd-lightbox-next"
                disabled={lightbox.index >= lightbox.list.length - 1}
                onClick={() => setLightbox((s) => ({ ...s, index: Math.min(s.list.length - 1, s.index + 1) }))}
                className="flex-1 py-2 rounded-full bg-white/5 border border-white/10 text-white font-bold disabled:opacity-40"
              >
                Próxima →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Fev/2026 · APR Editor Modal */}
      {aprOpen && (
        <APREditor
          projectId={id}
          project={project}
          teams={teams}
          initialApr={aprSelected}
          onClose={() => setAprOpen(false)}
          onSaved={async (saved) => {
            const { data } = await axios.get(`${API}/projects/${id}/aprs`);
            setAprList(data || []);
            setAprSelected(saved);
          }}
        />
      )}

      {/* Fev/2026 · file input global sempre montado — permite auto-abrir câmera a partir de ?camera=1 mesmo estando em aba arquivos */}
      <input
        data-testid="pd-photo-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoUpload}
        className="hidden"
      />

      {/* Fev/2026 · Modal de preview pós-captura de foto */}
      {previewSrc && (
        <div
          data-testid="pd-photo-preview-modal"
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 flex items-center justify-between border-b border-white/10">
            <p className="text-white font-bold text-sm">Conferir foto antes de enviar</p>
            <button
              data-testid="pd-photo-preview-close"
              onClick={() => { setPreviewSrc(null); setPreviewFile(null); }}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 text-white flex items-center justify-center"
              aria-label="Fechar preview"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img
              data-testid="pd-photo-preview-image"
              src={previewSrc}
              alt="Preview"
              className="max-w-full max-h-full object-contain rounded-xl"
              style={{ boxShadow: '0 0 40px rgba(224,255,0,0.15)' }}
            />
          </div>
          <div className="p-4 border-t border-white/10 grid grid-cols-2 gap-3">
            <button
              data-testid="pd-photo-preview-retake"
              onClick={cancelPhotoPreview}
              className="py-3 rounded-full bg-white/5 border border-white/20 text-white font-bold inline-flex items-center justify-center gap-2"
            >
              <Camera className="w-4 h-4" /> Refazer
            </button>
            <button
              data-testid="pd-photo-preview-send"
              onClick={confirmPhotoUpload}
              className="py-3 rounded-full bg-[#E0FF00] text-black font-black inline-flex items-center justify-center gap-2"
            >
              Enviar com marca d'água
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const ChecklistRow = ({ testid, icon: Icon, color, label, sub, checked, onToggle }) => (
  <label
    className="flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer"
    style={{
      backgroundColor: checked ? `${color}15` : 'rgba(255,255,255,0.02)',
      borderColor: checked ? color : 'rgba(255,255,255,0.1)',
    }}
  >
    <input data-testid={testid} type="checkbox" checked={!!checked} onChange={onToggle} className="w-6 h-6 flex-shrink-0" style={{ accentColor: color }} />
    <Icon className="w-5 h-5 flex-shrink-0" style={{ color: checked ? color : '#71717a' }} />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-bold" style={{ color: checked ? color : '#fff' }}>{label}</p>
      {sub && <p className="text-xs text-zinc-500 truncate">{sub}</p>}
    </div>
  </label>
);
