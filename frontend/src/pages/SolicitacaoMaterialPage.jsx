import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { toast } from 'sonner';
import { AppLayout } from '../components/AppLayout';
import { Package, Upload, Send, FileText, X } from 'lucide-react';
import { PROJECT_TYPE_LABEL, formatCurrency } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const SolicitacaoMaterialPage = () => {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [notes, setNotes] = useState('');
  const [materialPdf, setMaterialPdf] = useState(null);
  const [projectPdf, setProjectPdf] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    axios.get(`${API}/projects`).then(({ data }) => setProjects(data));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedProject) {
      toast.error('Selecione um projeto');
      return;
    }
    setSending(true);
    try {
      const formData = new FormData();
      formData.append('project_id', selectedProject);
      formData.append('notes', notes);
      if (materialPdf) formData.append('material_pdf', materialPdf);
      if (projectPdf) formData.append('project_pdf', projectPdf);

      const { data } = await axios.post(`${API}/materials/request`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data.status === 'sent') {
        toast.success('Solicitação enviada ao almoxarifado!');
      } else if (data.status === 'skipped') {
        toast.success('Solicitação registrada. (E-mail não enviado — configure RESEND_API_KEY)');
      } else {
        toast.error(`Falha ao enviar: ${data.error || 'erro desconhecido'}`);
      }
      // Reset form
      setSelectedProject('');
      setNotes('');
      setMaterialPdf(null);
      setProjectPdf(null);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao enviar solicitação');
    } finally {
      setSending(false);
    }
  };

  const selected = projects.find((p) => p.id === selectedProject);

  return (
    <AppLayout title="Solicitação de Material" subtitle="Envie a lista ao almoxarifado com PDFs anexos">
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl mx-auto space-y-6"
        data-testid="material-request-form"
      >
        <div className="glass-panel rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-[#FF5E00]/10 border border-[#FF5E00]/40 flex items-center justify-center">
              <Package className="w-6 h-6 text-[#FF5E00]" />
            </div>
            <div>
              <h2 className="font-heading font-black text-2xl tracking-tighter text-white">Nova Solicitação</h2>
              <p className="text-xs text-zinc-500">O e-mail incluirá os PDFs anexados</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                Projeto
              </label>
              <select
                data-testid="material-project-select"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                required
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#E0FF00] focus:outline-none transition-all"
              >
                <option value="">Selecione um projeto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code ? `[${p.project_code}] ` : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <div className="glass-panel rounded-xl p-4 space-y-1">
                <p className="text-xs text-zinc-500">Detalhes do projeto</p>
                <p className="text-sm text-white"><span className="text-zinc-500">Tipo:</span> {PROJECT_TYPE_LABEL[selected.project_type]}</p>
                {selected.location && <p className="text-sm text-white"><span className="text-zinc-500">Localidade:</span> {selected.location}</p>}
                {selected.team_name && <p className="text-sm text-white"><span className="text-zinc-500">Equipe:</span> {selected.team_name}</p>}
                <p className="text-sm text-white"><span className="text-zinc-500">Programado:</span> {formatCurrency(selected.programmed_value)}</p>
              </div>
            )}

            <div>
              <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">
                Observações
              </label>
              <textarea
                data-testid="material-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:border-[#E0FF00] focus:outline-none transition-all"
                placeholder="Observações adicionais para o almoxarifado..."
              />
            </div>

            <FileUpload
              testid="material-pdf-upload"
              label="Lista de Materiais (PDF)"
              file={materialPdf}
              onChange={setMaterialPdf}
              color="#00F0FF"
            />

            <FileUpload
              testid="project-pdf-upload"
              label="Projeto da Obra (PDF)"
              file={projectPdf}
              onChange={setProjectPdf}
              color="#E0FF00"
            />

            <button
              type="submit"
              data-testid="send-material-request"
              disabled={sending}
              className="w-full bg-[#FF5E00] hover:bg-[#E55400] text-black font-bold py-4 rounded-full transition-all transform hover:scale-[1.01] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Send className="w-5 h-5" />
              {sending ? 'Enviando...' : 'Enviar ao Almoxarifado'}
            </button>
          </div>
        </div>
      </motion.form>
    </AppLayout>
  );
};

const FileUpload = ({ testid, label, file, onChange, color }) => (
  <div>
    <label className="text-xs tracking-[0.2em] uppercase font-bold text-zinc-500 block mb-2">{label}</label>
    <label
      className="glass-panel rounded-lg p-4 cursor-pointer flex items-center justify-between transition-all hover:border-white/20"
      style={{ borderColor: file ? `${color}40` : undefined }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}15` }}>
          {file ? <FileText className="w-5 h-5" style={{ color }} /> : <Upload className="w-5 h-5 text-zinc-400" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-white truncate">{file ? file.name : 'Clique para anexar PDF'}</p>
          {file && (
            <p className="text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB</p>
          )}
        </div>
      </div>
      {file && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onChange(null); }}
          className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C] flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      <input
        data-testid={testid}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        className="hidden"
      />
    </label>
  </div>
);
