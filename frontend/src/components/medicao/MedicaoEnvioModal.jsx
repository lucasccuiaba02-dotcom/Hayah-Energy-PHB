import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { X, Mail, FileDown, Plus, Trash2, Send, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { formatCurrency } from '../../lib/constants';
import { apiUrl, downloadUrl, withAuth } from '../../lib/files';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const dateBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const uid = () => Math.random().toString(36).slice(2, 10);

const pdfQuery = (meta) => {
  const q = new URLSearchParams();
  if (meta.period) q.set('period', meta.period);
  if (meta.notes) q.set('notes', meta.notes);
  if (meta.medicao_id) q.set('medicao_id', meta.medicao_id);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const downloadMedicaoPdf = (projectId, meta = {}) =>
  downloadUrl(withAuth(apiUrl(`/api/projects/${projectId}/medicao/pdf${pdfQuery(meta)}`)), `medicao_${projectId}${meta.medicao_id ? `_${meta.medicao_id}` : ''}.pdf`);

/** Modal: fiscais da obra (salvos) + e-mails extras, mensagem, período/nº da medição → envia PDF como link seguro (e-mail gerenciado pela Emergent).
 *  `medicao` (opcional) = medição fechada do histórico; sem ela, envia a medição em aberto. */
export const MedicaoEnvioModal = ({ open, detail, medicao = null, onClose, onChanged }) => {
  const [fiscais, setFiscais] = useState([]);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [period, setPeriod] = useState('');
  const [copyMe, setCopyMe] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingFiscais, setSavingFiscais] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || !detail) return;
    const base = (detail.fiscais || []).map((f) => ({ ...f, _id: uid(), send: true }));
    setFiscais(base.length ? base : [{ _id: uid(), name: '', email: '', phone: '', send: true }]);
    setMessage(''); setNotes(medicao?.notes || ''); setPeriod(medicao?.period || ''); setResult(null);
  }, [open, detail, medicao]);

  const recipients = useMemo(() => fiscais.filter((f) => f.send && EMAIL_RE.test((f.email || '').trim())).map((f) => f.email.trim().toLowerCase()), [fiscais]);
  const dirtyFiscais = useMemo(() => JSON.stringify((detail?.fiscais || []).map((f) => [f.name, f.email, f.phone])) !== JSON.stringify(fiscais.filter((f) => (f.name || f.email).trim()).map((f) => [f.name, f.email, f.phone])), [detail, fiscais]);
  if (!open || !detail) return null;
  const p = detail.project;
  const total = medicao ? medicao.total : (detail.totals?.em_aberto ?? detail.totals?.realizado ?? 0);
  const count = medicao ? medicao.items_count : (detail.totals?.realizado_count || 0);
  const number = medicao ? medicao.number : (detail.medicoes?.length ? detail.next_number : null);
  const title = medicao ? `Medição nº ${medicao.number}` : (number ? `Medição nº ${number} (em aberto)` : 'Medição');
  const envios = (detail.envios || []).filter((e) => (medicao ? e.medicao_id === medicao.id : !e.medicao_id));

  const upd = (id, patch) => setFiscais((l) => l.map((f) => (f._id === id ? { ...f, ...patch } : f)));
  const add = () => setFiscais((l) => [...l, { _id: uid(), name: '', email: '', phone: '', send: true }]);
  const remove = (id) => setFiscais((l) => l.filter((f) => f._id !== id));

  const saveFiscais = async () => {
    setSavingFiscais(true);
    try {
      const { data } = await axios.put(`${API}/projects/${p.id}/medicao/fiscais`, { fiscais: fiscais.filter((f) => (f.name || f.email).trim()).map(({ name, email, phone }) => ({ name, email, phone })) });
      onChanged?.(data); toast.success('Fiscais da obra salvos');
    } catch (err) { toast.error(err?.response?.data?.detail || 'Erro ao salvar fiscais'); } finally { setSavingFiscais(false); }
  };

  const send = async () => {
    if (!recipients.length) { toast.error('Informe ao menos um e-mail válido'); return; }
    setSending(true); setResult(null);
    try {
      if (dirtyFiscais) await axios.put(`${API}/projects/${p.id}/medicao/fiscais`, { fiscais: fiscais.filter((f) => (f.name || f.email).trim()).map(({ name, email, phone }) => ({ name, email, phone })) });
      const { data } = await axios.post(`${API}/projects/${p.id}/medicao/enviar`, { recipients, message, notes, period, copy_me: copyMe, save_fiscais: true, medicao_id: medicao?.id || '' });
      setResult({ ok: true, recipients: data.recipients, filename: data.filename });
      onChanged?.(data);
      toast.success(`Medição enviada para ${data.recipients.length} destinatário(s)`);
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Erro ao enviar';
      setResult({ ok: false, error: msg }); toast.error(msg);
    } finally { setSending(false); }
  };

  return (
    <div data-testid="mo-envio-modal" className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={sending ? undefined : onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl border border-[#39FF14]/40 overflow-hidden" style={{ backgroundColor: '#0b0b0d' }}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-[#39FF14]/15 border border-[#39FF14]/40 flex items-center justify-center"><Mail className="w-5 h-5 text-[#39FF14]" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#39FF14]">Enviar aos fiscais · {title}</p>
            <h3 className="font-heading font-black text-lg text-white leading-tight truncate">{p.project_code ? `${p.project_code} · ` : ''}{p.name}</h3>
            <p className="text-[11px] text-zinc-400">{count} serviço(s) medidos · <span className="font-mono text-[#39FF14] font-bold">{formatCurrency(total)}</span>{medicao?.period ? ` · ${medicao.period}` : ''} · PDF anexo</p>
          </div>
          <button data-testid="mo-envio-close" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">Fiscais da obra <span className="text-zinc-600 normal-case tracking-normal font-normal">(ficam salvos na obra)</span></p>
              <div className="flex items-center gap-2">
                {dirtyFiscais && <button type="button" data-testid="mo-fiscais-save" disabled={savingFiscais} onClick={saveFiscais} className="text-[10px] font-bold text-[#00F0FF] hover:underline disabled:opacity-50">{savingFiscais ? 'Salvando…' : 'Salvar fiscais'}</button>}
                <button type="button" data-testid="mo-fiscais-add" onClick={add} className="text-[10px] font-bold text-black bg-[#E0FF00] px-2.5 py-1 rounded-full inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Fiscal</button>
              </div>
            </div>
            <div className="space-y-1.5">
              {fiscais.map((f) => (
                <div key={f._id} data-testid={`mo-fiscal-row-${f._id}`} className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                  <input type="checkbox" data-testid={`mo-fiscal-send-${f._id}`} checked={!!f.send} onChange={(e) => upd(f._id, { send: e.target.checked })} className="accent-[#39FF14] w-4 h-4 shrink-0" title="Enviar para este fiscal" />
                  <input data-testid={`mo-fiscal-name-${f._id}`} value={f.name || ''} onChange={(e) => upd(f._id, { name: e.target.value })} placeholder="Nome do fiscal" className="flex-1 min-w-0 px-2.5 py-1.5 bg-zinc-950 border border-white/10 rounded-lg text-xs text-white placeholder:text-zinc-600 focus:border-[#39FF14] focus:outline-none" />
                  <button type="button" data-testid={`mo-fiscal-remove-${f._id}`} onClick={() => remove(f._id)} className="sm:order-last shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-[#FF003C] hover:bg-white/5"><Trash2 className="w-3.5 h-3.5" /></button>
                  <input data-testid={`mo-fiscal-email-${f._id}`} type="email" value={f.email || ''} onChange={(e) => upd(f._id, { email: e.target.value })} placeholder="e-mail@concessionaria.com.br" className={`basis-full sm:basis-auto sm:flex-[1.4] min-w-0 px-2.5 py-1.5 bg-zinc-950 border rounded-lg text-xs text-white placeholder:text-zinc-600 focus:outline-none ${f.email && !EMAIL_RE.test(f.email.trim()) ? 'border-[#FF003C]/60' : 'border-white/10 focus:border-[#39FF14]'}`} />
                  <input data-testid={`mo-fiscal-phone-${f._id}`} value={f.phone || ''} onChange={(e) => upd(f._id, { phone: e.target.value })} placeholder="Telefone" className="hidden sm:block sm:flex-[0.7] min-w-0 px-2.5 py-1.5 bg-zinc-950 border border-white/10 rounded-lg text-xs text-white placeholder:text-zinc-600 focus:border-[#39FF14] focus:outline-none" />
                </div>
              ))}
            </div>
            <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer"><input type="checkbox" data-testid="mo-envio-copy-me" checked={copyMe} onChange={(e) => setCopyMe(e.target.checked)} className="accent-[#39FF14]" /> Enviar cópia para o meu e-mail</label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">Período da medição</label><input data-testid="mo-envio-period" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="ex.: 01/09 a 30/09/2026" className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#39FF14] focus:outline-none" /></div>
            <div><label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">Nº da medição</label><div data-testid="mo-envio-number" className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-300 font-mono">{number ? `${number}ª${medicao ? '' : ' (em aberto)'}` : 'Única'}</div></div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">Mensagem do e-mail <span className="text-zinc-600 normal-case tracking-normal font-normal">(vazio = texto padrão)</span></label>
            <textarea data-testid="mo-envio-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder={`Prezado(a) fiscal,\n\nSegue o Resumo de Mão de Obra da obra ${p.project_code || ''} — ${p.name}, totalizando ${formatCurrency(total)}. Ficamos à disposição para conferência e validação.`} className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#39FF14] focus:outline-none resize-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">Observações no PDF</label>
            <textarea data-testid="mo-envio-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Observações impressas no rodapé do resumo (opcional)" className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#39FF14] focus:outline-none resize-none" />
          </div>

          {result && (
            <div data-testid={result.ok ? 'mo-envio-success' : 'mo-envio-error'} className={`rounded-xl border p-3 text-xs ${result.ok ? 'border-[#39FF14]/40 bg-[#39FF14]/10 text-[#39FF14]' : 'border-[#FF003C]/40 bg-[#FF003C]/10 text-[#FF6B8A]'}`}>
              {result.ok ? <p className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Enviado para {result.recipients.join(', ')} · PDF (link seguro) {result.filename}</p>
                : <p className="inline-flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" /> {result.error}</p>}
            </div>
          )}

          {envios.length > 0 && (
            <div data-testid="mo-envio-history">
              <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 mb-1.5 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Envios anteriores desta medição</p>
              <div className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
                {envios.map((e) => (
                  <div key={e.id} data-testid={`mo-envio-item-${e.id}`} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${e.status === 'sent' ? 'bg-[#39FF14]' : 'bg-[#FF003C]'}`} />
                    <span className="text-zinc-400 font-mono">{dateBR(e.at)}</span>
                    <span className="text-zinc-300 truncate flex-1">{(e.recipients || []).join(', ')}</span>
                    <span className="font-mono text-zinc-400">{formatCurrency(e.total)}</span>
                    <span className={`font-bold ${e.status === 'sent' ? 'text-[#39FF14]' : 'text-[#FF003C]'}`}>{e.status === 'sent' ? 'enviado' : 'falhou'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
          <button type="button" data-testid="mo-envio-pdf" onClick={() => downloadMedicaoPdf(p.id, { period, notes, medicao_id: medicao?.id })} className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-200 bg-white/5 hover:bg-white/10 px-3 sm:px-4 py-2 rounded-full whitespace-nowrap"><FileDown className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Baixar</span> PDF</button>
          <span className="text-[11px] text-zinc-500 flex-1 min-w-0 truncate">{recipients.length} destinatário(s){copyMe ? ' + cópia' : ''}</span>
          <button type="button" data-testid="mo-envio-send" disabled={sending || !recipients.length || !count} onClick={send} className="inline-flex items-center gap-1.5 text-xs font-black text-black bg-[#39FF14] hover:bg-[#2ee010] px-4 sm:px-5 py-2 rounded-full disabled:opacity-40 whitespace-nowrap"><Send className="w-3.5 h-3.5" /> {sending ? 'Enviando…' : 'Enviar por e-mail'}</button>
        </div>
      </motion.div>
    </div>
  );
};
