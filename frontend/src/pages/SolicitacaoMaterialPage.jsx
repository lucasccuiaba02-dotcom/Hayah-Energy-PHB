import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { AppLayout } from '../components/AppLayout';
import { Package, Send, FileText, MapPin, Users, Calendar, Hash, PenLine, CheckCircle2 } from 'lucide-react';
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
  const [me, setMe] = useState(null);

  useEffect(() => {
    axios.get(`${API}/projects`).then(({ data }) => setProjects(data));
    axios.get(`${API}/auth/me`).then(({ data }) => {
      setMe(data);
      setSignatureName(data?.name || '');
    }).catch(() => {});
  }, []);

  const selected = useMemo(() => projects.find((p) => p.id === selectedProject), [projects, selectedProject]);
  const materials = selected?.materials_list || [];

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
      const body = { [field]: Number(value) || 0 };
      await axios.patch(`${API}/projects/${selected.id}/materials/${item.id}`, body);
      // Refresh single project data
      const { data } = await axios.get(`${API}/projects`);
      setProjects(data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSavingRow(null);
    }
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
        toast.success(`Enviado ao almoxarifado! (${data.attachments_count || 0} anexo(s))`);
      } else if (data.status === 'skipped') {
        toast.info('Registrado — e-mail não enviado (configure RESEND_API_KEY)');
      } else {
        toast.error(`Falha: ${data.error || 'erro'}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao enviar');
    } finally {
      setSending(false);
    }
  };

  return (
    <AppLayout title="Almoxarifado" subtitle="Controle solicitado · separado · baixado · entregue e envie ao almoxarifado">
      <div className="max-w-6xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="w-12 h-12 rounded-xl bg-[#FF5E00]/10 border border-[#FF5E00]/40 flex items-center justify-center">
              <Package className="w-6 h-6 text-[#FF5E00]" />
            </div>
            <div className="flex-1 min-w-[220px]">
              <h2 className="font-heading font-black text-2xl tracking-tighter text-white">Requisição de Almoxarifado</h2>
              <p className="text-xs text-zinc-500">Selecione a obra, ajuste as quantidades e envie por e-mail</p>
            </div>
            <button
              data-testid="send-material-request"
              onClick={handleSend}
              disabled={sending || !selectedProject}
              className="bg-[#FF5E00] hover:bg-[#E55400] text-black font-bold px-6 py-3 rounded-full transition-all disabled:opacity-40 inline-flex items-center gap-2"
            >
              <Send className="w-4 h-4" /> {sending ? 'Enviando…' : 'Enviar Almoxarifado'}
            </button>
          </div>

          {/* Header: obra, equipe, data, localidade, assinatura */}
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
              <input
                data-testid="material-date"
                type="date"
                defaultValue={todayISO()}
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-[#E0FF00] focus:outline-none"
              />
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
              <input
                data-testid="material-signature"
                type="text"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="Nome de quem assina"
                className="w-full bg-zinc-950/90 border border-[#E0FF00]/30 rounded-lg px-3 py-2 text-white focus:border-[#E0FF00] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 flex items-center gap-1 mb-1">Observações</label>
            <textarea
              data-testid="material-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ex.: Priorizar cabos e postes para amanhã"
              className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#E0FF00] focus:outline-none"
            />
          </div>
        </motion.div>

        {/* Materials table with 4 qty columns editable */}
        {selectedProject && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#00F0FF] inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Materiais desta obra ({materials.length})
              </p>
              {materials.length === 0 && (
                <p className="text-[11px] text-zinc-500 italic">Nenhum material. Importe a lista (Excel/CSV) no cadastro da obra.</p>
              )}
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
                          <td className="px-2 py-2">
                            <QtyInput
                              testid={`qty-requested-${m.id}`}
                              value={qs}
                              saving={savingRow === m.id + ':qty_requested'}
                              onCommit={(v) => patchItem(m, 'qty_requested', v)}
                              color="#fff"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <QtyInput
                              testid={`qty-separated-${m.id}`}
                              value={Number(m.qty_separated ?? 0)}
                              saving={savingRow === m.id + ':qty_separated'}
                              onCommit={(v) => patchItem(m, 'qty_separated', v)}
                              color="#39FF14"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <QtyInput
                              testid={`qty-baixado-${m.id}`}
                              value={Number(m.qty_written_off ?? 0)}
                              saving={savingRow === m.id + ':qty_written_off'}
                              onCommit={(v) => patchItem(m, 'qty_written_off', v)}
                              color="#FF5E00"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <QtyInput
                              testid={`qty-delivered-${m.id}`}
                              value={qent}
                              saving={savingRow === m.id + ':qty_delivered'}
                              onCommit={(v) => patchItem(m, 'qty_delivered', v)}
                              color="#00F0FF"
                            />
                          </td>
                          <td className="px-2 py-2 text-right">
                            {complete ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#39FF14]">
                                <CheckCircle2 className="w-3 h-3" /> OK
                              </span>
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
      </div>
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
