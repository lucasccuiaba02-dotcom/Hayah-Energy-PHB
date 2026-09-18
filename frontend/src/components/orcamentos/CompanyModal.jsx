import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Building2, Upload, X, Save } from 'lucide-react';
import { API, Field, btnGhost, btnPrimary } from './orcamentoShared';

const FIELDS = [
  ['name', 'Nome fantasia (cabeçalho)', 'sm:col-span-2'],
  ['tagline', 'Slogan / descrição curta'],
  ['legal_name', 'Razão social', 'sm:col-span-2'],
  ['cnpj', 'CNPJ'],
  ['address', 'Endereço', 'sm:col-span-2'],
  ['city', 'Cidade / UF'],
  ['phone', 'Telefone'],
  ['email', 'E-mail'],
  ['footer', 'Rodapé (linha 1)'],
  ['responsible_name', 'Responsável (assina a proposta)'],
  ['responsible_title', 'Cargo / empresa do responsável'],
  ['responsible_phone', 'Telefone do responsável'],
];

export const CompanyModal = ({ onClose }) => {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [logoTs, setLogoTs] = useState(Date.now());
  const fileRef = useRef(null);

  useEffect(() => {
    axios.get(`${API}/orcamentos/company`).then(({ data }) => setForm(data)).catch(() => toast.error('Falha ao carregar dados da empresa'));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(FIELDS.map(([k]) => [k, form[k] || '']));
      await axios.put(`${API}/orcamentos/company`, body);
      toast.success('Dados da empresa salvos');
      onClose(true);
    } catch { toast.error('Falha ao salvar'); } finally { setSaving(false); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await axios.post(`${API}/orcamentos/company/logo`, fd);
      setForm((f) => ({ ...f, logo_url: data.logo_url }));
      setLogoTs(Date.now());
      toast.success('Logo atualizada');
    } catch (e) { toast.error(e?.response?.data?.detail || 'Falha ao enviar logo'); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3" onClick={() => onClose(false)}>
      <div data-testid="orc-company-modal" className="glass-panel rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-black text-lg text-white flex items-center gap-2"><Building2 className="w-5 h-5 text-[#E0FF00]" /> Dados da empresa (cabeçalho dos PDFs)</h3>
          <button data-testid="orc-company-close" onClick={() => onClose(false)} className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400"><X className="w-4 h-4" /></button>
        </div>
        {!form ? <p className="text-zinc-500 text-sm">Carregando…</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3 flex items-center gap-4 rounded-xl border border-white/10 p-3 bg-white/[0.02]">
              <div className="w-28 h-16 rounded-lg bg-white flex items-center justify-center overflow-hidden">
                {form.logo_url ? <img data-testid="orc-company-logo-img" src={`${API}${form.logo_url}?t=${logoTs}`} alt="logo" className="max-w-full max-h-full object-contain" /> : <span className="text-[10px] text-zinc-400 font-bold">SEM LOGO</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-white font-bold">Logomarca</p>
                <p className="text-[10px] text-zinc-500">PNG ou JPG até 5MB. Aparece centralizada no topo de cada página e como marca d'água.</p>
              </div>
              <button data-testid="orc-company-logo-btn" onClick={() => fileRef.current?.click()} className={btnGhost}><Upload className="w-3.5 h-3.5" /> Enviar</button>
              <input ref={fileRef} data-testid="orc-company-logo-file" type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </div>
            {FIELDS.map(([k, l, cls]) => (
              <Field key={k} label={l} testid={`orc-company-${k}`} value={form[k] || ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={cls || ''} />
            ))}
            <div className="sm:col-span-3 flex justify-end gap-2 pt-2">
              <button onClick={() => onClose(false)} className={btnGhost}>Cancelar</button>
              <button data-testid="orc-company-save" disabled={saving} onClick={save} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {saving ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
