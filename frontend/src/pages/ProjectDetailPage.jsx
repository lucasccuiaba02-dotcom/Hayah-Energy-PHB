import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Zap, AlertTriangle, Package, CheckCircle2, Camera, X, MapPin, Wifi, WifiOff, FileText, FolderOpen, ShieldCheck, Download, Upload, Trash2, Folder } from 'lucide-react';
import { HayahLogo } from '../components/HayahLogo';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS_LABEL, formatCurrency } from '../lib/constants';
import { enqueue, syncQueue } from '../lib/offline';

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
  const [tab, setTab] = useState('operacional'); // 'operacional' | 'arquivos'
  const [uploadingPdf, setUploadingPdf] = useState(false);

  useEffect(() => {
    axios.get(`${API}/projects/${id}`).then(({ data }) => setProject(data)).catch(() => toast.error('Projeto não encontrado'));
    axios.get(`${API}/operacional/checklist/${id}`).then(({ data }) => {
      setChecklist(data.checklist || {});
      setPhotos(data.photos || []);
    }).catch(() => { /* offline OK */ });

    const onOn = () => { setOnline(true); syncQueue(axios, API).then((r) => { if (r.synced > 0) toast.success(`${r.synced} atualização(ões) sincronizada(s)`); }); };
    const onOff = () => setOnline(false);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
    };
  }, [id]);

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
    setUploading(true);
    try {
      let outFile = file;
      try {
        outFile = await buildWatermarkedFile(file);
      } catch (err) {
        console.warn('Watermark failed, sending original', err);
      }
      const formData = new FormData();
      formData.append('file', outFile);
      formData.append('label', photoLabel);
      formData.append('point', (photoPoint || '').trim());
      const { data } = await axios.post(`${API}/operacional/photos/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotos([...photos, data]);
      // Auto-increment point (P1 → P2 → P3, etc.)
      if (photoPoint) {
        const m = photoPoint.match(/^([A-Za-z]*)(\d+)$/);
        if (m) {
          const prefix = m[1] || 'P';
          setPhotoPoint(`${prefix}${parseInt(m[2], 10) + 1}`);
        }
      }
      toast.success(`Foto enviada com marca d'água${data.point ? ` (${data.point})` : ''}!`);
    } catch (err) {
      toast.error('Erro ao enviar foto');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
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

  const uploadPdf = async (file) => {
    if (!file) return;
    setUploadingPdf(true);
    try {
      const fd = new FormData();
      fd.append('kind', 'project_pdf');
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
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${online ? 'text-[#39FF14]' : 'text-[#FF003C]'}`} title={online ? 'Online' : 'Offline'}>
            {online ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          </div>
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
              />
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

          {/* Documentos do Projeto (PDFs / imagens anexadas) */}
          <div data-testid="pd-arquivos-docs" className="glass-panel rounded-2xl overflow-hidden border border-[#E0FF00]/25">
            <div className="px-4 py-3 border-b border-white/5 bg-[#E0FF00]/[0.04] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#E0FF00]" />
              <div className="flex-1">
                <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Documentos do Projeto</p>
                <p className="text-[11px] text-zinc-400">
                  {attachments.length} arquivo(s) · PDF ou imagens até 25MB
                </p>
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
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf,image/*"
                className="hidden"
                data-testid="pd-attachment-input"
                onChange={(e) => uploadPdf(e.target.files?.[0])}
              />
            </div>
            {attachments.length === 0 ? (
              <p className="px-4 py-6 text-[11px] text-zinc-500 italic text-center">
                Nenhum documento anexado. Envie plantas, ARTs, projetos executivos, etc.
              </p>
            ) : (
              <div className="divide-y divide-white/5">
                {attachments.map((a) => (
                  <div key={a.id} data-testid={`pd-att-row-${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition">
                    <div className="w-9 h-9 rounded-lg bg-[#E0FF00]/10 border border-[#E0FF00]/30 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-[#E0FF00]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-bold truncate">{a.filename}</p>
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
                ))}
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
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-right px-2 py-2">Qtd</th>
                      <th className="text-left px-2 py-2">Un</th>
                      <th className="text-right px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m) => (
                      <tr key={m.id} data-testid={`pd-mat-row-${m.id}`} className="border-t border-white/5">
                        <td className="px-3 py-1.5 text-white truncate max-w-[180px]" title={m.item}>{m.item}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-zinc-300">{m.quantity}</td>
                        <td className="px-2 py-1.5 text-zinc-400 uppercase">{m.unit}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-white font-bold">{formatCurrency(m.total_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                      {photosByPoint[pk].map((ph) => (
                        <a
                          key={ph.id}
                          href={ph.data_url}
                          target="_blank"
                          rel="noreferrer"
                          data-testid={`pd-arq-photo-${ph.id}`}
                          className="relative rounded-lg overflow-hidden border border-white/10 group"
                        >
                          <img src={ph.data_url} alt={ph.label} className="w-full h-24 object-cover group-hover:opacity-90" />
                          <p className="absolute bottom-1 left-1 text-[9px] text-white font-bold uppercase px-1.5 py-0.5 rounded bg-black/60">
                            {ph.label}
                          </p>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
