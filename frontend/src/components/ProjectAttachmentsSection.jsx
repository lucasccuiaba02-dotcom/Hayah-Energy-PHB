import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { FileText, Package, Upload, Download, Trash2 } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const formatBytes = (n) => {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const formatCurrency = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export const ProjectAttachmentsSection = ({ project }) => {
  const [attachments, setAttachments] = useState(project?.attachments?.filter((a) => !a.is_deleted) || []);
  const [materials, setMaterials] = useState(project?.materials_list || []);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const pdfInputRef = useRef(null);
  const csvInputRef = useRef(null);

  useEffect(() => {
    setAttachments(project?.attachments?.filter((a) => !a.is_deleted) || []);
    setMaterials(project?.materials_list || []);
  }, [project?.id]);

  if (!project?.id) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 space-y-2">
        <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 inline-flex items-center gap-1">
          <FileText className="w-3 h-3" /> Anexos & Materiais
        </p>
        <p className="text-[11px] text-zinc-500 italic">
          Salve a obra primeiro para anexar o projeto em PDF ou importar a lista de materiais.
        </p>
      </div>
    );
  }

  const uploadPdf = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('kind', 'project_pdf');
      fd.append('file', file);
      const { data } = await axios.post(`${API}/projects/${project.id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachments((prev) => [...prev, data]);
      toast.success(`Anexo enviado: ${data.filename}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro no upload');
    } finally {
      setUploading(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const removeAtt = async (attId) => {
    if (!window.confirm('Remover este anexo?')) return;
    try {
      await axios.delete(`${API}/projects/${project.id}/attachments/${attId}`);
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
      toast.success('Anexo removido');
    } catch { toast.error('Erro ao remover'); }
  };

  const openAtt = async (att) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/projects/${project.id}/attachments/${att.id}`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast.error('Erro ao abrir arquivo'); }
  };

  const importCsv = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('replace', 'true');
      const { data } = await axios.post(`${API}/projects/${project.id}/materials-import`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMaterials(data.items || []);
      toast.success(`${data.imported} itens importados · ${formatCurrency(data.estimated_cost)}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao importar planilha');
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const totalCost = materials.reduce((s, i) => s + (i.total_cost || 0), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-[#E0FF00]/40 bg-[#E0FF00]/[0.03] p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#E0FF00] inline-flex items-center gap-1">
            <FileText className="w-3 h-3" /> Projeto em PDF ({attachments.length})
          </p>
          <button
            type="button"
            data-testid="upload-pdf-btn"
            onClick={() => pdfInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#E0FF00] hover:bg-[#C8E600] text-black px-3 py-1.5 rounded-full disabled:opacity-60"
          >
            <Upload className="w-3 h-3" /> {uploading ? 'Enviando…' : 'Anexar PDF'}
          </button>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf,image/*"
            className="hidden"
            data-testid="upload-pdf-input"
            onChange={(e) => uploadPdf(e.target.files?.[0])}
          />
        </div>
        {attachments.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">Nenhum anexo. Aceita PDF ou imagens até 25MB.</p>
        ) : (
          <div className="space-y-1">
            {attachments.map((a) => (
              <div key={a.id} data-testid={`attachment-row-${a.id}`} className="flex items-center gap-2 rounded-lg bg-zinc-950/60 border border-white/10 px-2 py-1.5 text-xs">
                <FileText className="w-3 h-3 text-[#E0FF00] flex-shrink-0" />
                <span className="text-white truncate flex-1">{a.filename}</span>
                <span className="text-zinc-500 font-mono text-[10px]">{formatBytes(a.size)}</span>
                <button
                  type="button"
                  data-testid={`attachment-open-${a.id}`}
                  onClick={() => openAtt(a)}
                  className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 text-[#00F0FF] flex items-center justify-center"
                >
                  <Download className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  data-testid={`attachment-remove-${a.id}`}
                  onClick={() => removeAtt(a.id)}
                  className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 text-[#FF003C] flex items-center justify-center"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-[#00F0FF]/40 bg-[#00F0FF]/[0.03] p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#00F0FF] inline-flex items-center gap-1">
              <Package className="w-3 h-3" /> Lista de Materiais ({materials.length})
            </p>
            {materials.length > 0 && (
              <p className="text-[10px] text-zinc-400 font-mono mt-0.5">Total estimado: <b className="text-white">{formatCurrency(totalCost)}</b></p>
            )}
          </div>
          <button
            type="button"
            data-testid="import-materials-btn"
            onClick={() => csvInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#00F0FF] hover:bg-[#00D0DD] text-black px-3 py-1.5 rounded-full disabled:opacity-60"
          >
            <Upload className="w-3 h-3" /> {importing ? 'Importando…' : 'Importar Excel/CSV'}
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            data-testid="import-materials-input"
            onChange={(e) => importCsv(e.target.files?.[0])}
          />
        </div>
        {materials.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">
            Aceita colunas <b>item · quantidade · unidade · preco</b> ou o template <b>Satelite.xlsx</b> (detecta aba e cabeçalho automaticamente, ignora TOTAL/SUBTOTAL). Excel (.xlsx) ou CSV.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-lg bg-zinc-950/60 border border-white/10">
            <table className="w-full text-[11px]">
              <thead className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 bg-white/[0.03]">
                <tr>
                  <th className="text-left px-2 py-1.5">Item</th>
                  <th className="text-right px-2 py-1.5">Qtd</th>
                  <th className="text-left px-2 py-1.5">Un</th>
                  <th className="text-right px-2 py-1.5">Preço</th>
                  <th className="text-right px-2 py-1.5">Total</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.id} data-testid={`material-row-${m.id}`} className="border-t border-white/5">
                    <td className="px-2 py-1 text-white">{m.item}</td>
                    <td className="px-2 py-1 text-right font-mono text-zinc-300">{m.quantity}</td>
                    <td className="px-2 py-1 text-zinc-400">{m.unit}</td>
                    <td className="px-2 py-1 text-right font-mono text-zinc-300">{formatCurrency(m.unit_cost)}</td>
                    <td className="px-2 py-1 text-right font-mono text-white font-bold">{formatCurrency(m.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
