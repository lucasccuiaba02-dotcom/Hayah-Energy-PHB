import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Zap, AlertTriangle, Package, CheckCircle2, Camera, X, MapPin, Wifi, WifiOff, FileText } from 'lucide-react';
import { HayahLogo } from '../components/HayahLogo';
import { PROJECT_TYPE_LABEL, EXECUTION_STATUS_LABEL, formatCurrency } from '../lib/constants';
import { enqueue, syncQueue } from '../lib/offline';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const ProjectDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [photos, setPhotos] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [photoLabel, setPhotoLabel] = useState('antes');
  const [photoPoint, setPhotoPoint] = useState(''); // P1, P2, P3...
  const [dailyNotes, setDailyNotes] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

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
      const { data } = await axios.post(`${API}/operacional/photos/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotos([...photos, data]);
      toast.success('Foto enviada com marca d\'água!');
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
      </div>

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
="text-sm font-bold" style={{ color: checked ? color : '#fff' }}>{label}</p>
      {sub && <p className="text-xs text-zinc-500 truncate">{sub}</p>}
    </div>
  </label>
);
