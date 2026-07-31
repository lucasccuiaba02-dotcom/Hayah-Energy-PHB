import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { AppLayout } from '../components/AppLayout';
import {
  Package, Send, FileText, MapPin, Users, Calendar, Hash, PenLine,
  CheckCircle2, History, FileDown, Camera, Truck, AlertCircle, Loader, RefreshCw, Eye, X,
} from 'lucide-react';
import { PROJECT_TYPE_LABEL, formatCurrency, todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const SolicitacaoMaterialPage = () => {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [notes, setNotes] = useState('');
  const [signatureName, setSignatureName] = useState('');
  const [savingRow, setSavingRow] = useState(null);
  const [sending, setSending] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [me, setMe] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API}/projects`).then(({ data }) => setProjects(data));
    axios.get(`${API}/auth/me`).then(({ data }) => {
      setMe(data);
      setSignatureName(data?.name || '');
    }).catch(() => {});
  }, []);

  const reloadProjects = async () => {
    const { data } = await axios.get(`${API}/projects`);
    setProjects(data);
  };

  const selected = useMemo(() => projects.find((p) => p.id === selectedProject), [projects, selectedProject]);
  const materials = selected?.materials_list || [];
  const history = selected?.material_requisitions || [];

  const totals = useMemo(() => materials.reduce((acc, m) => {
    acc.solicitado += Number(m.qty_requested ?? m.quantity ?? 0);
    acc.separado += Number(m.qty_separated ?? 0);
    acc.baixado += Number(m.qty_written_off ?? 0);
    acc.entregue += Number(m.qty_delivered ?? 0);
    return acc;
  }, { solicitado: 0, separado: 0, baixado: 0, entregue: 0 }), [materials]);

  const patchItem = async (item, field, value) => {
    if (!selected) return;
    setSavingRow(item.id + ':' + field);
    try {
      await axios.patch(`${API}/projects/${selected.id}/materials/${item.id}`, { [field]: Number(value) || 0 });
      await reloadProjects();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar');
    } finally { setSavingRow(null); }
  };

  const handlePreview = async () => {
    if (!selectedProject) { toast.error('Selecione uma obra'); return; }
    if (materials.length === 0) { toast.error('Importe a lista de materiais antes de gerar prévia'); return; }
    if (!signatureName) { toast.error('Preencha a assinatura'); return; }
    setPreviewLoading(true);
    try {
      const fd = new FormData();
      fd.append('project_id', selectedProject);
      fd.append('notes', notes);
      fd.append('signature_name', signatureName);
      const res = await axios.post(`${API}/materials/preview`, fd, {
        responseType: 'blob',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPreviewUrl(url);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao gerar prévia');
    } finally { setPreviewLoading(false); }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const handleSend = async () => {
    if (!selectedProject) { toast.error('Selecione uma obra'); return; }
    if (materials.length === 0) { toast.error('Importe a lista de materiais na obra antes de enviar'); return; }
    if (!signatureName) { toast.error('Preencha a assinatura'); return; }
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('project_id', selectedProject);
      fd.append('notes', notes);
      fd.append('signature_name', signatureName);
      const { data } = await axios.post(`${API}/materials/request`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data.status === 'sent') {
        toast.success(`Enviado ao almoxarifado! (${data.attachments_count} anexo(s))`);
      } else if (data.status === 'skipped') {
        toast.info(`Registrado no histórico. PDF gerado. Email não enviado (configure RESEND_API_KEY)`);
      } else {
        toast.error(`Falha: ${data.error || 'erro'}`);
      }
      await reloadProjects();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao enviar');
    } finally { setSending(false); }
  };

  const openReqPdf = async (reqId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/projects/${selectedProject}/requisitions/${reqId}/pdf`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast.error('Erro ao abrir PDF'); }
  };

  const confirmReceipt = async (reqId, receiverName, receiptNotes, photoFile) => {
    setConfirmingId(reqId);
    try {
      const fd = new FormData();
      fd.append('receiver_name', receiverName || '');
      fd.append('notes', receiptNotes || '');
      if (photoFile) fd.append('photo', photoFile);
      await axios.post(`${API}/projects/${selectedProject}/requisitions/${reqId}/confirm-receipt`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Recebimento confirmado!');
      await reloadProjects();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao confirmar');
    } finally { setConfirmingId(null); }
  };

  const openReceiptPhoto = async (reqId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/projects/${selectedProject}/requisitions/${reqId}/receipt-photo`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast.error('Erro ao abrir foto'); }
  };

  const resendReq = async (reqId) => {
    setResendingId(reqId);
    try {
      const { data } = await axios.post(`${API}/projects/${selectedProject}/requisitions/${reqId}/resend`);
      if (data.status === 'sent') toast.success('Reenviado ao almoxarifado!');
      else if (data.status === 'skipped') toast.info('Reenvio registrado. Email pendente (configure RESEND_API_KEY).');
      else toast.error(`Falha: ${data.error || 'erro'}`);
      await reloadProjects();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao reenviar');
    } finally { setResendingId(null); }
  };

  return (
    <AppLayout title="Almoxarifado" subtitle="Controle solicitado · separado · baixado · entregue, envie ao almoxarifado e confirme recebimento">
      <div className="max-w-6xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="w-12 h-12 rounded-xl bg-[#FF5E00]/10 border border-[#FF5E00]/40 flex items-center justify-center">
              <Package className="w-6 h-6 text-[#FF5E00]" />
            </div>
            <div className="flex-1 min-w-[220px]">
              <h2 className="font-heading font-black text-2xl tracking-tighter text-white">Requisição de Almoxarifado</h2>
              <p className="text-xs text-zinc-500">PDF gerado automático com QR + assinatura · envio por email para 5 destinatários</p>
            </div>
            <button
              data-testid="preview-material-request"
              onClick={handlePreview}
              disabled={previewLoading || !selectedProject}
              className="bg-white/5 border border-[#00F0FF]/40 hover:bg-[#00F0FF]/10 text-[#00F0FF] font-bold px-5 py-3 rounded-full transition-all disabled:opacity-40 inline-flex items-center gap-2"
            >
              <Eye className="w-4 h-4" /> {previewLoading ? 'Gerando…' : 'Prévia PDF'}
            </button>
            <button
              data-testid="send-material-request"
              onClick={handleSend}
              disabled={sending || !selectedProject}
              className="bg-[#FF5E00] hover:bg-[#E55400] text-black font-bold px-6 py-3 rounded-full transition-all disabled:opacity-40 inline-flex items-center gap-2"
            >
              <Send className="w-4 h-4" /> {sending ? 'Enviando…' : 'Enviar Almoxarifado'}
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-3 mb-5">
            <div className="md:col-span-2">
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 flex items-center gap-1 mb-1"><Hash className="w-3 h-3" /> Número da obra / Projeto</label>
              <select
                data-testid="material-project-select"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none"
              >
                <option value="">Selecione a obra…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_code ? `[${p.project_code}] ` : ''}{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 flex items-center gap-1 mb-1"><Calendar className="w-3 h-3" /> Data</label>
              <input data-testid="material-date" type="date" defaultValue={todayISO()} className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 flex items-center gap-1 mb-1"><Users className="w-3 h-3" /> Equipe</label>
              <div data-testid="material-team" className="bg-zinc-950/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm min-h-[38px]">
                {selected?.team_name || <span className="text-zinc-600">—</span>}
                {selected?.additional_team_name && <span className="ml-1 text-[10px] text-[#00F0FF]">+{selected.additional_team_name}</span>}
              </div>
            </div>
            <div>
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 flex items-center gap-1 mb-1"><MapPin className="w-3 h-3" /> Localidade</label>
              <div data-testid="material-location" className="bg-zinc-950/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm min-h-[38px]">
                {selected?.location || <span className="text-zinc-600">—</span>}
              </div>
            </div>
            <div>
              <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 flex items-center gap-1 mb-1"><PenLine className="w-3 h-3" /> Assinatura (nome)</label>
              <input data-testid="material-signature" type="text" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder="Nome de quem assina" className="w-full bg-zinc-950/90 border border-[#E0FF00]/30 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 flex items-center gap-1 mb-1">Observações</label>
            <textarea data-testid="material-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ex.: Priorizar postes para amanhã" className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#E0FF00] focus:outline-none" />
          </div>
        </motion.div>

        {selectedProject && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#00F0FF] inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Materiais desta obra ({materials.length})
              </p>
              {materials.length === 0 && <p className="text-[11px] text-zinc-500 italic">Nenhum material. Importe a lista (Excel/CSV) no cadastro da obra.</p>}
              {materials.length > 0 && (
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="text-zinc-400">Solicitado <b className="text-white font-mono">{totals.solicitado}</b></span>
                  <span className="text-[#39FF14]">Separado <b className="font-mono">{totals.separado}</b></span>
                  <span className="text-[#FF5E00]">Baixado <b className="font-mono">{totals.baixado}</b></span>
                  <span className="text-[#00F0FF]">Entregue <b className="font-mono">{totals.entregue}</b></span>
                </div>
              )}
            </div>
            {materials.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/[0.03] text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500">
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="px-2 py-2">Un</th>
                      <th className="px-2 py-2 text-right text-white">Solicitado</th>
                      <th className="px-2 py-2 text-right text-[#39FF14]">Separado</th>
                      <th className="px-2 py-2 text-right text-[#FF5E00]">Baixado</th>
                      <th className="px-2 py-2 text-right text-[#00F0FF]">Entregue</th>
                      <th className="px-2 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m) => {
                      const qs = Number(m.qty_requested ?? m.quantity ?? 0);
                      const qent = Number(m.qty_delivered ?? 0);
                      const complete = qent >= qs && qs > 0;
                      return (
                        <tr key={m.id} data-testid={`material-row-${m.id}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                          <td className="px-3 py-2 text-white">{m.item}</td>
                          <td className="px-2 py-2 text-zinc-400 text-center">{m.unit || 'un'}</td>
                          <td className="px-2 py-2"><QtyInput testid={`qty-requested-${m.id}`} value={qs} saving={savingRow === m.id + ':qty_requested'} onCommit={(v) => patchItem(m, 'qty_requested', v)} color="#fff" /></td>
                          <td className="px-2 py-2"><QtyInput testid={`qty-separated-${m.id}`} value={Number(m.qty_separated ?? 0)} saving={savingRow === m.id + ':qty_separated'} onCommit={(v) => patchItem(m, 'qty_separated', v)} color="#39FF14" /></td>
                          <td className="px-2 py-2"><QtyInput testid={`qty-baixado-${m.id}`} value={Number(m.qty_written_off ?? 0)} saving={savingRow === m.id + ':qty_written_off'} onCommit={(v) => patchItem(m, 'qty_written_off', v)} color="#FF5E00" /></td>
                          <td className="px-2 py-2"><QtyInput testid={`qty-delivered-${m.id}`} value={qent} saving={savingRow === m.id + ':qty_delivered'} onCommit={(v) => patchItem(m, 'qty_delivered', v)} color="#00F0FF" /></td>
                          <td className="px-2 py-2 text-right">
                            {complete ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#39FF14]"><CheckCircle2 className="w-3 h-3" /> OK</span>
                            ) : qent > 0 ? (
                              <span className="text-[10px] font-bold text-[#FF5E00]">Parcial</span>
                            ) : (
                              <span className="text-[10px] text-zinc-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {/* HISTORY */}
        {selectedProject && history.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} data-testid="requisitions-history" className="glass-panel rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <History className="w-4 h-4 text-[#E0FF00]" />
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#E0FF00]">
                Histórico de Envios ({history.length})
              </p>
            </div>
            <div className="divide-y divide-white/5">
              {[...history].reverse().map((r) => (
                <RequisitionRow
                  key={r.id}
                  req={r}
                  onOpenPdf={() => openReqPdf(r.id)}
                  onOpenPhoto={() => openReceiptPhoto(r.id)}
                  onConfirm={(receiver, notes, photo) => confirmReceipt(r.id, receiver, notes, photo)}
                  onResend={() => resendReq(r.id)}
                  confirming={confirmingId === r.id}
                  resending={resendingId === r.id}
                  defaultReceiver={me?.name || ''}
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {previewUrl && (
        <div
          data-testid="material-preview-modal"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={closePreview}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-panel rounded-2xl border border-[#00F0FF]/40 w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#00F0FF]/15 border border-[#00F0FF]/40 flex items-center justify-center">
                <Eye className="w-4 h-4 text-[#00F0FF]" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#00F0FF]">Prévia da requisição</p>
                <h3 className="text-white font-bold text-sm">
                  {selected?.project_code ? `[${selected.project_code}] ` : ''}{selected?.name}
                </h3>
              </div>
              <a
                data-testid="material-preview-download"
                href={previewUrl}
                download={`previa_${selected?.project_code || 'obra'}.pdf`}
                className="text-[11px] bg-white/5 border border-white/10 hover:bg-white/10 text-[#00F0FF] px-3 py-1.5 rounded-full inline-flex items-center gap-1"
              >
                <FileDown className="w-3 h-3" /> Baixar
              </a>
              <button
                data-testid="material-preview-send"
                onClick={() => { closePreview(); handleSend(); }}
                disabled={sending}
                className="text-[11px] bg-[#FF5E00] hover:bg-[#E55400] text-black font-bold px-4 py-1.5 rounded-full inline-flex items-center gap-1 disabled:opacity-40"
              >
                <Send className="w-3 h-3" /> Enviar para o Almoxarifado
              </button>
              <button
                data-testid="material-preview-close"
                onClick={closePreview}
                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              data-testid="material-preview-iframe"
              src={previewUrl}
              title="Prévia da requisição"
              className="flex-1 w-full bg-white"
            />
          </motion.div>
        </div>
      )}
    </AppLayout>
  );
};

const QtyInput = ({ value, onCommit, saving, color, testid }) => {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      data-testid={testid}
      type="number"
      value={v}
      min={0}
      step="0.01"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (Number(v) !== Number(value)) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-16 text-right bg-zinc-950/60 border border-white/10 rounded-md px-1.5 py-1 text-xs font-mono focus:outline-none focus:border-current"
      style={{ color, borderColor: saving ? color : undefined }}
    />
  );
};

const RequisitionRow = ({ req, onOpenPdf, onOpenPhoto, onConfirm, onResend, confirming, resending, defaultReceiver }) => {
  const [expand, setExpand] = useState(false);
  const [receiver, setReceiver] = useState(defaultReceiver || '');
  const [rNotes, setRNotes] = useState('');
  const photoRef = useRef(null);
  const [photo, setPhoto] = useState(null);

  const status = req.email_status || 'pending';
  const statusChip =
    status === 'sent' ? { c: '#39FF14', l: 'Enviado' } :
    status === 'skipped_no_key' ? { c: '#E0FF00', l: 'Registrado (email pendente)' } :
    status === 'error' ? { c: '#FF003C', l: 'Erro' } :
    { c: '#71717a', l: 'Pendente' };

  const received = !!req.receipt;

  return (
    <div data-testid={`req-row-${req.id}`} className="p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <p className="text-xs text-white font-mono">
            {new Date(req.created_at).toLocaleString('pt-BR')} · <span className="text-zinc-400">{req.created_by}</span>
          </p>
          <p className="text-[10px] text-zinc-500">
            {req.recipients?.length || 0} destinatário(s) · {req.materials_snapshot?.length || 0} itens · assinado por {req.signature_name || '—'}
          </p>
        </div>
        <span
          className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
          style={{ backgroundColor: `${statusChip.c}15`, borderColor: `${statusChip.c}50`, color: statusChip.c }}
        >
          {statusChip.l}
        </span>
        {received && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#005EE0]/15 border border-[#005EE0]/50 text-[#00A0FF] inline-flex items-center gap-1">
            <Truck className="w-3 h-3" /> Recebido
          </span>
        )}
        <button
          data-testid={`req-pdf-${req.id}`}
          onClick={onOpenPdf}
          className="text-[10px] bg-white/5 border border-white/10 hover:bg-white/10 text-[#00F0FF] px-2 py-1 rounded-full inline-flex items-center gap-1"
        >
          <FileDown className="w-3 h-3" /> PDF
        </button>
        {!req.is_resend && (
          <button
            data-testid={`req-resend-${req.id}`}
            onClick={onResend}
            disabled={resending}
            className="text-[10px] bg-[#FF5E00]/15 border border-[#FF5E00]/40 hover:bg-[#FF5E00]/25 text-[#FF5E00] px-2 py-1 rounded-full inline-flex items-center gap-1 disabled:opacity-60"
          >
            {resending ? <Loader className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {resending ? '...' : 'Reenviar'}
          </button>
        )}
        {req.is_resend && (
          <span className="text-[10px] bg-[#FF5E00]/10 border border-[#FF5E00]/40 text-[#FF5E00] px-2 py-1 rounded-full inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Reenvio
          </span>
        )}
        <button
          data-testid={`req-expand-${req.id}`}
          onClick={() => setExpand((x) => !x)}
          className="text-[10px] bg-white/5 border border-white/10 hover:bg-white/10 text-white px-2 py-1 rounded-full"
        >
          {expand ? 'Fechar' : (received ? 'Ver recebimento' : 'Confirmar recebimento')}
        </button>
      </div>

      {expand && (
        <div className="mt-3 rounded-xl bg-zinc-950/60 border border-white/10 p-3">
          {received ? (
            <div data-testid={`req-receipt-${req.id}`} className="space-y-2">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#00A0FF] inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Recebido em {new Date(req.receipt.received_at).toLocaleString('pt-BR')}
              </p>
              <div className="grid md:grid-cols-2 gap-2 text-xs">
                <p><span className="text-zinc-500">Recebido por:</span> <span className="text-white font-bold">{req.receipt.received_by}</span></p>
                {req.receipt.notes && <p className="text-zinc-300">{req.receipt.notes}</p>}
              </div>
              {req.receipt.photo_path && (
                <button
                  data-testid={`req-receipt-photo-${req.id}`}
                  onClick={onOpenPhoto}
                  className="inline-flex items-center gap-1 text-[10px] bg-[#00F0FF]/15 border border-[#00F0FF]/40 text-[#00F0FF] px-2 py-1 rounded-full"
                >
                  <Camera className="w-3 h-3" /> Ver foto do canhoto
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 inline-flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Confirmar entrega em campo
              </p>
              <div className="grid md:grid-cols-2 gap-2">
                <input
                  data-testid={`req-receiver-${req.id}`}
                  type="text"
                  value={receiver}
                  onChange={(e) => setReceiver(e.target.value)}
                  placeholder="Nome de quem recebeu"
                  className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#00F0FF] focus:outline-none"
                />
                <input
                  data-testid={`req-receipt-notes-${req.id}`}
                  type="text"
                  value={rNotes}
                  onChange={(e) => setRNotes(e.target.value)}
                  placeholder="Observações"
                  className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#00F0FF] focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={photoRef}
                  data-testid={`req-receipt-photo-input-${req.id}`}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  data-testid={`req-choose-photo-${req.id}`}
                  onClick={() => photoRef.current?.click()}
                  className="inline-flex items-center gap-1 text-[11px] bg-white/5 border border-white/10 hover:bg-white/10 text-white px-3 py-1.5 rounded-full"
                >
                  <Camera className="w-3 h-3" /> {photo ? photo.name : 'Foto do canhoto (opcional)'}
                </button>
                <button
                  type="button"
                  data-testid={`req-confirm-${req.id}`}
                  disabled={confirming}
                  onClick={() => onConfirm(receiver, rNotes, photo)}
                  className="inline-flex items-center gap-1 text-[11px] bg-[#00F0FF] hover:bg-[#00D0DD] text-black font-bold px-3 py-1.5 rounded-full disabled:opacity-60"
                >
                  {confirming ? <Loader className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  {confirming ? 'Salvando…' : 'Confirmar Recebimento'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
