import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { X, Save, FileDown, Camera, Upload, Trash2, Images, ClipboardCheck } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const input = 'w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none';
const label = 'text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block';
const TIPOS = [['instalacao', 'Instalação'], ['queima', 'Queima'], ['remanejamento', 'Remanejamento'], ['defeito', 'Defeito']];
const SLOT_GROUPS = [
  ['Leitura da resistência de aterramento (Ω)', ['aterr_a', 'aterr_b', 'aterr_c'], 'aterr_leituras', 'Ω'],
  ['Leitura da tensão secundária BT (V)', ['tensao_a', 'tensao_b', 'tensao_c'], 'tensao_leituras', 'V'],
  ['Fotos do transformador', ['placa', 'instalado'], null, ''],
];

const Toggle = ({ options, value, onChange, testid, color = '#E0FF00' }) => (
  <div className="flex gap-1 flex-wrap" data-testid={testid}>
    {options.map(([v, l]) => (
      <button key={v} type="button" data-testid={`${testid}-${v}`} onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase transition ${value === v ? 'text-black' : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-white'}`} style={value === v ? { background: color } : {}}>{l}</button>
    ))}
  </div>
);

const Field = ({ k, l, form, set, type = 'text', className = '', placeholder }) => (
  <div className={className}>
    <label className={label}>{l}</label>
    <input data-testid={`laudo-${k}`} type={type} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={input} placeholder={placeholder} />
  </div>
);

const Slot = ({ equipId, slot, labelText, meta, ts, equipPhotos, onChanged }) => {
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const upload = async (f) => {
    if (!f) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', f);
    try { await axios.post(`${API}/equipamentos/${equipId}/laudo/photos/${slot}`, fd); toast.success('Foto anexada'); onChanged(); } catch (e) { toast.error(e?.response?.data?.detail || 'Falha no upload'); } finally { setBusy(false); if (camRef.current) camRef.current.value = ''; if (fileRef.current) fileRef.current.value = ''; }
  };
  const fromPhoto = async (pid) => {
    try { await axios.post(`${API}/equipamentos/${equipId}/laudo/photos/${slot}/from-photo`, { photo_id: pid }); toast.success('Foto do equipamento usada'); setPick(false); onChanged(); } catch (e) { toast.error(e?.response?.data?.detail || 'Falha'); }
  };
  const remove = async () => { try { await axios.delete(`${API}/equipamentos/${equipId}/laudo/photos/${slot}`); onChanged(); } catch { toast.error('Falha ao remover'); } };
  return (
    <div data-testid={`laudo-slot-${slot}`} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-black/40 flex items-center justify-center relative">
        {meta ? <img data-testid={`laudo-slot-img-${slot}`} src={`${BACKEND_URL}${meta.url}?t=${ts}`} alt={labelText} className="w-full h-full object-cover" /> : <p className="text-[10px] text-zinc-500 text-center px-3 uppercase">Colar aqui imagem<br />{labelText}</p>}
        {meta && <button data-testid={`laudo-slot-remove-${slot}`} onClick={remove} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-zinc-300 hover:text-[#FF003C]"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>
      <div className="p-2 space-y-1.5">
        <p className="text-[10px] font-bold text-zinc-300 truncate">{labelText}</p>
        <div className="grid grid-cols-3 gap-1">
          <button data-testid={`laudo-slot-camera-${slot}`} disabled={busy} onClick={() => camRef.current?.click()} className="inline-flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg bg-[#E0FF00] text-black disabled:opacity-40"><Camera className="w-3 h-3" /></button>
          <button data-testid={`laudo-slot-upload-${slot}`} disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg border border-white/15 text-zinc-300 disabled:opacity-40"><Upload className="w-3 h-3" /></button>
          <button data-testid={`laudo-slot-pick-${slot}`} disabled={!equipPhotos.length} onClick={() => setPick((v) => !v)} title="Usar foto já cadastrada" className="inline-flex items-center justify-center gap-1 text-[10px] font-bold py-1.5 rounded-lg border border-[#00F0FF]/40 text-[#00F0FF] disabled:opacity-30"><Images className="w-3 h-3" /></button>
        </div>
        {pick && (
          <div className="grid grid-cols-3 gap-1" data-testid={`laudo-slot-picker-${slot}`}>
            {equipPhotos.map((p) => (
              <button key={p.id} data-testid={`laudo-slot-pick-${slot}-${p.id}`} onClick={() => fromPhoto(p.id)} className="aspect-square rounded overflow-hidden border border-white/10 hover:border-[#00F0FF]">
                <img src={`${API}/equipamentos/${equipId}/photos/${p.id}`} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <input ref={fileRef} data-testid={`laudo-slot-file-${slot}`} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  );
};

export const LaudoTrafoModal = ({ equip, onClose }) => {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ts, setTs] = useState(Date.now());

  const load = async (keepForm = false) => {
    try {
      const { data: d } = await axios.get(`${API}/equipamentos/${equip.id}/laudo`);
      setData(d);
      if (!keepForm) setForm(d.laudo);
      setTs(Date.now());
    } catch { toast.error('Falha ao carregar laudo'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [equip.id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setReading = (k, i, v) => setForm((f) => { const arr = [...(f[k] || ['', '', ''])]; arr[i] = v; return { ...f, [k]: arr }; });

  const save = async () => {
    setSaving(true);
    try { const { data: r } = await axios.put(`${API}/equipamentos/${equip.id}/laudo`, form); setForm(r.laudo); toast.success('Laudo salvo'); return true; } catch (e) { toast.error(e?.response?.data?.detail || 'Falha ao salvar'); return false; } finally { setSaving(false); }
  };
  const pdf = async () => {
    if (!(await save())) return;
    try {
      const { data: blob } = await axios.get(`${API}/equipamentos/${equip.id}/laudo/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `Laudo_Transformador_${(form.projeto || form.patrimonio || equip.id).replace(/[^A-Za-z0-9]/g, '')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
      toast.success('Laudo PDF gerado');
    } catch { toast.error('Falha ao gerar PDF'); }
  };

  return (
    <div className="fixed inset-0 z-[85] bg-black/85 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div data-testid="laudo-modal" className="glass-panel rounded-2xl w-full max-w-5xl max-h-[96vh] overflow-y-auto border border-white/10" style={{ backgroundColor: '#0b0b0d' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-white/10" style={{ backgroundColor: '#0b0b0d' }}>
          <ClipboardCheck className="w-5 h-5 text-[#E0FF00]" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#E0FF00]">Laudo de Transformador · padrão Energisa</p>
            <p className="text-white font-bold text-sm truncate">PAT {equip.patrimonio || '—'} · Série {equip.numero_serie || '—'} {equip.project_code ? `· Obra ${equip.project_code}` : ''}</p>
          </div>
          <button data-testid="laudo-save" disabled={saving || !form} onClick={save} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15 text-zinc-300 hover:bg-white/10 disabled:opacity-40"><Save className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{saving ? 'Salvando…' : 'Salvar'}</span></button>
          <button data-testid="laudo-pdf" disabled={saving || !form} onClick={pdf} className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#E0FF00] text-black hover:bg-[#C8E600] disabled:opacity-40"><FileDown className="w-3.5 h-3.5" /> Laudo PDF</button>
          <button data-testid="laudo-close" onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400"><X className="w-4 h-4" /></button>
        </div>

        {!form ? <p className="p-6 text-zinc-500 text-sm">Carregando…</p> : (
          <div className="p-4 space-y-5">
            <div>
              <label className={label}>Tipo do laudo</label>
              <Toggle testid="laudo-tipo" options={TIPOS} value={form.tipo_laudo} onChange={(v) => set('tipo_laudo', v)} color="#FF003C" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field k="projeto" l="Projeto / Obra" form={form} set={set} />
              <Field k="data" l="Data" form={form} set={set} type="date" />
              <Field k="localizacao" l="Localização" form={form} set={set} className="col-span-2" />
              <Field k="topologia" l="Topologia" form={form} set={set} />
              <Field k="endereco" l="Endereço" form={form} set={set} className="col-span-2 sm:col-span-3" />
            </div>

            <div className="rounded-xl border border-white/10 p-3 space-y-3">
              <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 text-center">Trafo instalado</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={label}>Configuração</label><Toggle testid="laudo-configuracao" options={[['trifasico', 'Trifásico'], ['monofasico', 'Monofásico']]} value={form.configuracao} onChange={(v) => set('configuracao', v)} /></div>
                <div><label className={label}>Classe de tensão da rede</label><Toggle testid="laudo-classe" options={[['13.8', '13,8 kV'], ['34.5', '34,5 kV']]} value={form.classe_tensao} onChange={(v) => set('classe_tensao', v)} /></div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field k="numero_serie" l="Número de série" form={form} set={set} />
                <Field k="patrimonio" l="Nº Energisa (patrimônio)" form={form} set={set} />
                <Field k="data_fabricacao" l="Data de fabricação" form={form} set={set} placeholder="MM/AAAA" />
                <Field k="marca" l="Marca / modelo / tipo" form={form} set={set} />
                <Field k="posicao_tap" l="Posição de TAP" form={form} set={set} />
                <Field k="qtd_tap" l="Qtd de TAP" form={form} set={set} />
                <Field k="impedancia" l="Impedância %" form={form} set={set} placeholder="2,34" />
                <Field k="massa_kg" l="Massa / peso (kg)" form={form} set={set} />
                <Field k="volume_oleo" l="Volume óleo isolante (L)" form={form} set={set} />
                <div><label className={label}>Tipo óleo isolante</label><Toggle testid="laudo-oleo" options={[['ovi', 'OVI'], ['omi', 'OMI']]} value={form.tipo_oleo} onChange={(v) => set('tipo_oleo', v)} color="#00F0FF" /></div>
                <div><label className={label}>Equipamento reformado</label><Toggle testid="laudo-reformado" options={[['sim', 'Sim'], ['nao', 'Não']]} value={form.reformado} onChange={(v) => set('reformado', v)} color="#FF5E00" /></div>
              </div>
            </div>

            {SLOT_GROUPS.map(([title, slots, readingKey, unit]) => (
              <div key={title} className="rounded-xl border border-white/10 p-3 space-y-3">
                <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">{title}</p>
                <div className={`grid gap-3 ${slots.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
                  {slots.map((s) => <Slot key={s} equipId={equip.id} slot={s} labelText={data.slots[s]} meta={data.photos[s]} ts={ts} equipPhotos={data.equip_photos || []} onChanged={() => load(true)} />)}
                </div>
                {readingKey && (
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i}>
                        <label className={label}>Leitura 0{i + 1} ({unit})</label>
                        <input data-testid={`laudo-${readingKey}-${i}`} value={(form[readingKey] || [])[i] || ''} onChange={(e) => setReading(readingKey, i, e.target.value)} className={`${input} font-mono`} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_280px] gap-3">
              <div><label className={label}>Observação</label><textarea data-testid="laudo-observacao" value={form.observacao || ''} onChange={(e) => set('observacao', e.target.value)} className={`${input} min-h-[72px]`} /></div>
              <Field k="encarregado" l="Nome do encarregado por extenso" form={form} set={set} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
