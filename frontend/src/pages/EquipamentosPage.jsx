import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Plus, X, Zap, Package, Upload, Edit3, Trash2, Camera, Search, Filter, Image as ImageIcon,
} from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { PinchZoomImage } from '../components/PinchZoomImage';
import { todayISO } from '../lib/constants';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const TIPO_OPTIONS = [
  { value: 'transformador', label: 'Transformador', color: '#E0FF00', icon: Zap },
  { value: 'religador', label: 'Religador', color: '#00F0FF', icon: Zap },
  { value: 'regulador_tensao', label: 'Regulador de Tensão', color: '#FF5E00', icon: Zap },
];
const TIPO_LABEL = TIPO_OPTIONS.reduce((a, t) => { a[t.value] = t.label; return a; }, {});
const TIPO_COLOR = TIPO_OPTIONS.reduce((a, t) => { a[t.value] = t.color; return a; }, {});

const emptyForm = {
  tipo: 'transformador',
  patrimonio: '', numero_serie: '', codigo_material: '', descricao: '',
  potencia: '', data_fabricacao: '', condicao: 'novo',
  fabricante: '', tensao_primaria: '', tensao_secundaria: '', notas: '',
};

const EquipCard = ({ equip, onEdit, onDelete, onOpenPhotos }) => {
  const color = TIPO_COLOR[equip.tipo] || '#94A3B8';
  const photosLen = (equip.photos || []).length;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      data-testid={`equip-card-${equip.id}`}
      className="glass-panel rounded-2xl p-4 border relative"
      style={{ borderColor: `${color}30` }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}15`, border: `1px solid ${color}40` }}>
          <Zap className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
              {TIPO_LABEL[equip.tipo]}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${equip.condicao === 'novo' ? 'bg-[#39FF14]/20 text-[#39FF14] border border-[#39FF14]/40' : 'bg-[#FFB800]/20 text-[#FFB800] border border-[#FFB800]/40'}`}>
              {equip.condicao === 'novo' ? 'Novo' : 'Reforma'}
            </span>
          </div>
          <p className="text-white font-bold text-sm truncate">{equip.descricao || '—'}</p>
          <p className="text-[11px] text-zinc-500 font-mono">
            Patrimônio: <span className="text-white">{equip.patrimonio || '—'}</span> · Série: <span className="text-white">{equip.numero_serie || '—'}</span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
        <div>
          <p className="text-zinc-500 text-[9px] uppercase tracking-wider">Código Material</p>
          <p className="text-white font-mono">{equip.codigo_material || '—'}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-[9px] uppercase tracking-wider">Potência</p>
          <p className="text-white font-mono">{equip.potencia || '—'}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-[9px] uppercase tracking-wider">Data Fabricação</p>
          <p className="text-white font-mono">{equip.data_fabricacao || '—'}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-[9px] uppercase tracking-wider">Fabricante</p>
          <p className="text-white truncate">{equip.fabricante || '—'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button data-testid={`equip-photos-${equip.id}`} onClick={() => onOpenPhotos(equip)} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-full ${photosLen >= 3 ? 'bg-[#39FF14]/15 text-[#39FF14] border border-[#39FF14]/40' : 'bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/40'}`}>
          <Camera className="w-3 h-3" /> {photosLen}/3 fotos
        </button>
        <button data-testid={`equip-edit-${equip.id}`} onClick={() => onEdit(equip)} className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-[#E0FF00] flex items-center justify-center">
          <Edit3 className="w-3 h-3" />
        </button>
        <button data-testid={`equip-delete-${equip.id}`} onClick={() => onDelete(equip)} className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-[#FF003C] flex items-center justify-center">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
};

const EquipModal = ({ open, initial, onClose, onSaved }) => {
  const [form, setForm] = useState(initial || emptyForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(initial || emptyForm); }, [initial]);
  if (!open) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isEdit = !!initial?.id;

  const save = async () => {
    if (!form.descricao) { toast.error('Descrição obrigatória'); return; }
    setSaving(true);
    try {
      const url = isEdit ? `${API}/equipamentos/${initial.id}` : `${API}/equipamentos`;
      const { data } = isEdit ? await axios.patch(url, form) : await axios.post(url, form);
      toast.success(isEdit ? 'Equipamento atualizado' : 'Equipamento cadastrado');
      onSaved({ ...(initial || {}), ...form, id: data.id || initial?.id });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro');
    } finally { setSaving(false); }
  };

  return (
    <div data-testid="equip-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()} className="glass-panel rounded-2xl border border-[#E0FF00]/40 max-w-2xl w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-lg">{isEdit ? 'Editar Equipamento' : 'Novo Equipamento'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block">Tipo</label>
            <div className="grid grid-cols-3 gap-2">
              {TIPO_OPTIONS.map((t) => (
                <button key={t.value} data-testid={`equip-tipo-${t.value}`} onClick={() => set('tipo', t.value)}
                  className={`px-3 py-2 rounded-lg text-[11px] font-bold uppercase transition ${form.tipo === t.value ? 'text-black' : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-white'}`}
                  style={form.tipo === t.value ? { background: t.color } : {}}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {[
            ['patrimonio', 'Nº Patrimônio', 'text'], ['numero_serie', 'Nº Série', 'text'],
            ['codigo_material', 'Código do Material', 'text'], ['descricao', 'Descrição', 'text'],
            ['potencia', 'Potência (ex: 75 kVA)', 'text'], ['data_fabricacao', 'Data Fabricação', 'date'],
            ['fabricante', 'Fabricante', 'text'],
            ['tensao_primaria', 'Tensão Primária (kV)', 'text'], ['tensao_secundaria', 'Tensão Secundária (V)', 'text'],
          ].map(([k, l, t]) => (
            <div key={k}>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block">{l}</label>
              <input data-testid={`equip-${k}`} type={t} value={form[k]} onChange={(e) => set(k, e.target.value)}
                className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-[#E0FF00] focus:outline-none" />
            </div>
          ))}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block">Condição</label>
            <div className="flex gap-2">
              {[['novo', 'Novo', '#39FF14'], ['reforma', 'Reforma', '#FFB800']].map(([v, l, c]) => (
                <button key={v} data-testid={`equip-cond-${v}`} onClick={() => set('condicao', v)}
                  className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-bold uppercase transition ${form.condicao === v ? 'text-black' : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-white'}`}
                  style={form.condicao === v ? { background: c } : {}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1 block">Observações</label>
            <textarea data-testid="equip-notas" rows={2} value={form.notas} onChange={(e) => set('notas', e.target.value)}
              className="w-full bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-[#E0FF00] focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-bold bg-white/5 border border-white/10 text-zinc-400 hover:text-white">Cancelar</button>
          <button data-testid="equip-save" disabled={saving} onClick={save} className="px-5 py-2 rounded-full text-xs font-bold bg-[#E0FF00] hover:bg-[#C8E600] text-black disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const PhotosModal = ({ open, equip, onClose, onChange }) => {
  const [photos, setPhotos] = useState(equip?.photos || []);
  const [uploading, setUploading] = useState(false);
  const [viewingIdx, setViewingIdx] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => { setPhotos(equip?.photos || []); }, [equip]);
  if (!open || !equip) return null;

  const upload = async (file) => {
    if (!file) return;
    if (photos.length >= 3) { toast.error('Máximo de 3 fotos'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await axios.post(`${API}/equipamentos/${equip.id}/photos`, fd);
      const next = [...photos, data];
      setPhotos(next);
      onChange && onChange(next);
      toast.success('Foto adicionada');
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro no upload');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (pid) => {
    if (!window.confirm('Remover esta foto?')) return;
    try {
      await axios.delete(`${API}/equipamentos/${equip.id}/photos/${pid}`);
      const next = photos.filter((p) => p.id !== pid);
      setPhotos(next);
      onChange && onChange(next);
      toast.info('Foto removida');
    } catch (err) {
      toast.error('Erro');
    }
  };

  return (
    <div data-testid="equip-photos-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()} className="glass-panel rounded-2xl border border-[#00F0FF]/40 max-w-2xl w-full p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-bold text-lg">Fotos do Equipamento</h3>
            <p className="text-[11px] text-zinc-500">{equip.descricao || '—'} · Máx 3 fotos ({photos.length}/3)</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {photos.map((p, idx) => (
            <div key={p.id} data-testid={`equip-photo-${p.id}`} className="relative rounded-lg overflow-hidden border border-white/10 aspect-square bg-black/40 group">
              <button
                type="button"
                data-testid={`equip-photo-view-${p.id}`}
                onClick={() => setViewingIdx(idx)}
                className="w-full h-full cursor-zoom-in"
                title="Ampliar (pinça 2 dedos para zoom)"
              >
                <img src={`${API}/equipamentos/${equip.id}/photos/${p.id}`} alt={p.filename} className="w-full h-full object-cover" />
              </button>
              <button data-testid={`equip-photo-del-${p.id}`} onClick={() => remove(p.id)} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#FF003C]/80 hover:bg-[#FF003C] text-white flex items-center justify-center">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {photos.length < 3 && (
            <button data-testid="equip-photo-upload" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="aspect-square rounded-lg border-2 border-dashed border-[#00F0FF]/40 bg-[#00F0FF]/[0.03] hover:bg-[#00F0FF]/[0.08] flex flex-col items-center justify-center gap-2 text-[#00F0FF] disabled:opacity-50">
              {uploading ? <span className="text-xs">Enviando…</span> : (
                <>
                  <Camera className="w-8 h-8" />
                  <span className="text-[11px] font-bold">Adicionar foto</span>
                  <span className="text-[10px] text-zinc-500">até 10MB</span>
                </>
              )}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </div>
      </motion.div>
      {viewingIdx !== null && photos[viewingIdx] && (
        <div
          data-testid="equip-photo-lightbox"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setViewingIdx(null); }}
        >
          <button
            type="button"
            data-testid="equip-photo-lightbox-close"
            onClick={(e) => { e.stopPropagation(); setViewingIdx(null); }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center border border-white/20 z-10"
          >
            ✕
          </button>
          <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/60 border border-white/20 text-[11px] text-zinc-300 font-mono z-10">
            {viewingIdx + 1}/{photos.length} · pinça 2 dedos ou duplo-toque para zoom
          </div>
          <PinchZoomImage
            src={`${API}/equipamentos/${equip.id}/photos/${photos[viewingIdx].id}`}
            alt={photos[viewingIdx].filename}
            className="w-full h-full"
            resetKey={viewingIdx}
            testid="equip-lightbox-img"
          />
        </div>
      )}
    </div>
  );
};

export const EquipamentosPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tipoFilter, setTipoFilter] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [photosEquip, setPhotosEquip] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = tipoFilter ? `?tipo=${tipoFilter}` : '';
      const { data } = await axios.get(`${API}/equipamentos${params}`);
      setItems(data);
    } catch (err) {
      console.error('equip load', err);
      toast.error('Erro ao carregar equipamentos');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [tipoFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      (it.descricao || '').toLowerCase().includes(q) ||
      (it.patrimonio || '').toLowerCase().includes(q) ||
      (it.numero_serie || '').toLowerCase().includes(q) ||
      (it.codigo_material || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const openNew = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (equip) => { setEditing(equip); setModalOpen(true); };
  const removeEquip = async (equip) => {
    if (!window.confirm(`Remover ${equip.descricao}?`)) return;
    try {
      await axios.delete(`${API}/equipamentos/${equip.id}`);
      toast.info('Equipamento removido');
      setItems((s) => s.filter((x) => x.id !== equip.id));
    } catch { toast.error('Erro'); }
  };

  // Contadores por tipo
  const counters = useMemo(() => {
    const c = { transformador: 0, religador: 0, regulador_tensao: 0 };
    items.forEach((it) => { if (c[it.tipo] !== undefined) c[it.tipo] += 1; });
    return c;
  }, [items]);

  return (
    <AppLayout title="Equipamentos" subtitle="Cadastro e rastreio de transformadores, religadores e reguladores">
      {/* Barra de contadores por tipo */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {TIPO_OPTIONS.map((t) => (
          <motion.div key={t.value} data-testid={`equip-counter-${t.value}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-2xl p-3 border" style={{ borderColor: `${t.color}30` }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${t.color}15`, border: `1px solid ${t.color}40` }}>
                <t.icon className="w-4 h-4" style={{ color: t.color }} />
              </div>
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">{t.label}</p>
                <p className="font-mono text-lg font-black text-white leading-none">{counters[t.value]}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="glass-panel rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input data-testid="equip-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por descrição, patrimônio, série ou código…"
            className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:border-[#E0FF00] focus:outline-none" />
        </div>
        <select data-testid="equip-filter-tipo" value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)}
          className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-[#E0FF00] focus:outline-none">
          <option value="">Todos os tipos</option>
          {TIPO_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button data-testid="equip-add" onClick={openNew} className="ml-auto inline-flex items-center gap-2 bg-[#E0FF00] hover:bg-[#C8E600] text-black text-xs font-bold px-4 py-2 rounded-full">
          <Plus className="w-4 h-4" /> Novo Equipamento
        </button>
      </div>

      {loading ? (
        <p className="text-center text-zinc-500 py-8 text-sm">Carregando…</p>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center">
          <Package className="w-12 h-12 text-zinc-600 mx-auto mb-2" />
          <p className="text-white font-bold">Nenhum equipamento cadastrado</p>
          <p className="text-[11px] text-zinc-500 mt-1">Clique em "Novo Equipamento" para começar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((eq) => (
            <EquipCard key={eq.id} equip={eq} onEdit={openEdit} onDelete={removeEquip} onOpenPhotos={setPhotosEquip} />
          ))}
        </div>
      )}

      <EquipModal
        open={modalOpen}
        initial={editing}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSaved={() => load()}
      />
      <PhotosModal
        open={!!photosEquip}
        equip={photosEquip}
        onClose={() => setPhotosEquip(null)}
        onChange={(next) => {
          setItems((s) => s.map((x) => x.id === photosEquip.id ? { ...x, photos: next } : x));
          setPhotosEquip((e) => e ? { ...e, photos: next } : e);
        }}
      />
    </AppLayout>
  );
};
