import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Boxes, ChevronDown, ChevronRight, Download, FileText, History, Loader, Search, Undo2, PackageCheck, Pencil, Send, Truck, Upload, Plus, MessageSquare, ClipboardCheck, RefreshCw } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TYPE_STYLE = {
  import: { color: '#A855F7', Icon: Upload },
  avulso: { color: '#E0FF00', Icon: Plus },
  edit: { color: '#FFFFFF', Icon: Pencil },
  requisicao: { color: '#FF5E00', Icon: Send },
  reenvio: { color: '#FF5E00', Icon: RefreshCw },
  separado: { color: '#39FF14', Icon: PackageCheck },
  entregue: { color: '#00F0FF', Icon: Truck },
  resposta_almox: { color: '#A855F7', Icon: MessageSquare },
  recebimento: { color: '#39FF14', Icon: ClipboardCheck },
  devolucao: { color: '#00F0FF', Icon: Undo2 },
};

const fmtQty = (v) => (v === null || v === undefined ? '' : Number(v) % 1 === 0 ? String(Number(v)) : Number(v).toFixed(2));
const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const downloadBlob = async (url, filename) => {
  const res = await axios.get(url, { responseType: 'blob' });
  const href = window.URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(href);
};

const EventRow = ({ e, showItem = false }) => {
  const s = TYPE_STYLE[e.type] || { color: '#999', Icon: History };
  return (
    <div data-testid={`ledger-event-${e.type}`} className="flex items-start gap-3 py-2 border-t border-white/5">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border" style={{ backgroundColor: `${s.color}15`, borderColor: `${s.color}50` }}>
        <s.Icon className="w-3.5 h-3.5" style={{ color: s.color }} />
      </div>
      <div className="flex-1 min-w-0 text-[11px]">
        <p className="text-white">
          <span className="font-bold" style={{ color: s.color }}>{e.type_label}</span>
          {e.qty !== null && e.qty !== undefined && <span className="ml-2 font-mono font-bold">{fmtQty(e.qty)} {e.material_id ? e.unit : ''}</span>}
          {showItem && e.item && <span className="ml-2 text-zinc-300">· {e.code ? `${e.code} · ` : ''}{e.item}</span>}
        </p>
        <p className="text-zinc-500 mt-0.5 break-words">
          <span className="font-mono text-zinc-400">{e.ts_label}</span>{e.by ? ` · ${e.by}` : ''}{e.ref ? ` · ${e.ref}` : ''}{e.detail ? ` · ${e.detail}` : ''}
        </p>
      </div>
    </div>
  );
};

const Kpi = ({ label, value, color = '#fff', testid }) => (
  <div data-testid={testid} className="rounded-xl bg-zinc-950/50 border border-white/10 px-3 py-2 min-w-0">
    <p className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 truncate">{label}</p>
    <p className="font-mono font-bold text-sm truncate" style={{ color }}>{value}</p>
  </div>
);

export const MaterialLedgerPanel = ({ projects }) => {
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [openItem, setOpenItem] = useState(null);
  const [showGeneral, setShowGeneral] = useState(false);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return !q ? projects : projects.filter((p) => `${p.project_code || ''} ${p.name || ''}`.toLowerCase().includes(q));
  }, [projects, search]);

  useEffect(() => {
    setLedger(null); setOpenItem(null); setItemFilter('');
    if (!projectId) return;
    setLoading(true);
    axios.get(`${API}/projects/${projectId}/materials/ledger`)
      .then(({ data }) => setLedger(data))
      .catch(() => toast.error('Erro ao carregar movimentação da obra'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const download = async (ext) => {
    setDownloading(ext);
    try {
      await downloadBlob(`${API}/projects/${projectId}/materials/ledger/${ext}`, `movimentacao_materiais_${ledger?.project?.code || projectId}.${ext}`);
      toast.success(`Relatório ${ext.toUpperCase()} baixado!`);
    } catch { toast.error('Erro ao gerar relatório'); } finally { setDownloading(''); }
  };

  const items = useMemo(() => {
    const q = itemFilter.trim().toLowerCase();
    const list = ledger?.items || [];
    return !q ? list : list.filter((i) => `${i.code} ${i.item}`.toLowerCase().includes(q));
  }, [ledger, itemFilter]);
  const generalEvents = useMemo(() => (ledger?.events || []).filter((e) => !e.material_id), [ledger]);
  const s = ledger?.summary;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} data-testid="material-ledger-panel" className="glass-panel rounded-2xl p-5 sm:p-6 mb-6 border-[#00F0FF]/20">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-12 h-12 shrink-0 rounded-xl flex items-center justify-center bg-[#00F0FF]/15 border border-[#00F0FF]/40">
          <Boxes className="w-6 h-6 text-[#00F0FF]" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h3 className="font-heading font-black text-xl tracking-tighter text-white">Movimentação de Materiais por Obra</h3>
          <p className="text-xs text-zinc-500 mt-1">Histórico completo de cada material: importação, avulsos, edições, requisições (total/parcial), separado/entregue, respostas do almoxarifado, recebimento e devoluções — para inventário e controle.</p>
        </div>
        {ledger && (
          <div className="flex items-center gap-2 flex-wrap">
            <button data-testid="ledger-download-pdf" onClick={() => download('pdf')} disabled={!!downloading} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-[#FF5E00] text-black hover:scale-105 transition-all disabled:opacity-50">
              <FileText className="w-4 h-4" /> {downloading === 'pdf' ? 'Gerando…' : 'PDF'}
            </button>
            <button data-testid="ledger-download-xlsx" onClick={() => download('xlsx')} disabled={!!downloading} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-[#39FF14] text-black hover:scale-105 transition-all disabled:opacity-50">
              <Download className="w-4 h-4" /> {downloading === 'xlsx' ? 'Gerando…' : 'Excel'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input data-testid="ledger-project-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar nº da obra ou nome" className="w-full bg-zinc-950/90 border border-[#00F0FF]/30 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:border-[#00F0FF] focus:outline-none" />
        </div>
        <select data-testid="ledger-project-select" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="sm:col-span-2 w-full min-w-0 bg-zinc-950/90 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-[#E0FF00] focus:outline-none">
          <option value="">Selecione a obra…</option>
          {filteredProjects.map((p) => <option key={p.id} value={p.id}>{p.project_code ? `[${p.project_code}] ` : ''}{p.name}</option>)}
        </select>
      </div>

      {loading && <p className="mt-4 text-xs text-zinc-500 inline-flex items-center gap-2"><Loader className="w-4 h-4 animate-spin" /> Montando linha do tempo…</p>}

      {ledger && s && (
        <div className="mt-5 space-y-4">
          <div data-testid="ledger-summary" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <Kpi label="Itens" value={s.items_count} testid="ledger-kpi-items" />
            <Kpi label="Qtd. obra" value={fmtQty(s.total_qty)} testid="ledger-kpi-total" />
            <Kpi label="Requisitado" value={fmtQty(s.requisitioned_qty)} color="#FF5E00" testid="ledger-kpi-req" />
            <Kpi label="Devolvido" value={fmtQty(s.returned_qty)} color="#00F0FF" testid="ledger-kpi-ret" />
            <Kpi label="Em campo" value={fmtQty(s.in_field_qty)} color="#E0FF00" testid="ledger-kpi-field" />
            <Kpi label="Entregue" value={fmtQty(s.delivered_qty)} color="#39FF14" testid="ledger-kpi-ent" />
            <Kpi label="Saldo a req." value={fmtQty(s.saldo_qty)} color="#A855F7" testid="ledger-kpi-saldo" />
            <Kpi label="Custo em campo" value={fmtBRL(s.in_field_cost)} color="#E0FF00" testid="ledger-kpi-cost" />
          </div>
          <p className="text-[10px] text-zinc-500">{s.requisitions_count} requisição(ões) · {s.returns_count} devolução(ões) · {s.events_count} evento(s) · {s.items_fully_requisitioned}/{s.items_count} itens 100% requisitados · custo total orçado {fmtBRL(s.total_cost)}</p>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input data-testid="ledger-item-filter" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder="Filtrar material por código ou descrição" className="w-full bg-zinc-950/60 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-white text-xs focus:border-[#00F0FF] focus:outline-none" />
            </div>
            {generalEvents.length > 0 && (
              <button data-testid="ledger-toggle-general" onClick={() => setShowGeneral((v) => !v)} className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10">
                {showGeneral ? 'Ocultar' : 'Ver'} eventos gerais da obra ({generalEvents.length})
              </button>
            )}
          </div>

          {showGeneral && (
            <div data-testid="ledger-general-events" className="rounded-xl bg-zinc-950/50 border border-white/10 px-3 py-1">
              {generalEvents.map((e, i) => <EventRow key={i} e={e} />)}
            </div>
          )}

          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="ledger-items-table">
                <thead>
                  <tr className="bg-white/[0.03] text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500">
                    <th className="px-2 py-2 w-6"></th>
                    <th className="text-left px-2 py-2">Código</th>
                    <th className="text-left px-2 py-2">Descrição</th>
                    <th className="px-2 py-2">Un</th>
                    <th className="px-2 py-2 text-right text-white">Qtd. obra</th>
                    <th className="px-2 py-2 text-right text-[#FF5E00]">Requis.</th>
                    <th className="px-2 py-2 text-right text-[#00F0FF]">Devolv.</th>
                    <th className="px-2 py-2 text-right text-[#E0FF00]">Em campo</th>
                    <th className="px-2 py-2 text-right text-[#39FF14]">Separado</th>
                    <th className="px-2 py-2 text-right text-[#39FF14]">Entregue</th>
                    <th className="px-2 py-2 text-right text-[#A855F7]">Saldo</th>
                    <th className="px-2 py-2 text-right">Custo campo</th>
                    <th className="px-2 py-2 text-right">Eventos</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && <tr><td colSpan={13} className="px-3 py-4 text-center text-zinc-500 italic">Nenhum material {itemFilter ? 'encontrado para o filtro' : 'cadastrado nesta obra'}.</td></tr>}
                  {items.map((it) => {
                    const open = openItem === it.id;
                    const evs = (ledger.events || []).filter((e) => e.material_id === it.id);
                    return (
                      <React.Fragment key={it.id}>
                        <tr data-testid={`ledger-item-row-${it.id}`} onClick={() => setOpenItem(open ? null : it.id)} className={`border-t border-white/5 cursor-pointer hover:bg-white/[0.03] ${open ? 'bg-[#00F0FF]/[0.05]' : ''}`}>
                          <td className="px-2 py-2 text-zinc-500">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                          <td className="px-2 py-2 font-mono text-[#E0FF00] whitespace-nowrap">{it.code || '-'}</td>
                          <td className="px-2 py-2 text-white">{it.item}{it.source === 'avulso' && <span className="ml-1 text-[9px] px-1 rounded bg-[#E0FF00]/10 text-[#E0FF00] border border-[#E0FF00]/40">avulso</span>}</td>
                          <td className="px-2 py-2 text-center text-zinc-400">{it.unit}</td>
                          <td className="px-2 py-2 text-right font-mono text-white">{fmtQty(it.qty_total)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#FF5E00]">{fmtQty(it.qty_requisitioned)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#00F0FF]">{fmtQty(it.qty_returned)}</td>
                          <td className="px-2 py-2 text-right font-mono font-bold text-[#E0FF00]">{fmtQty(it.in_field)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#39FF14]">{fmtQty(it.qty_separated)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#39FF14]">{fmtQty(it.qty_delivered)}</td>
                          <td className="px-2 py-2 text-right font-mono text-[#A855F7]">{fmtQty(it.saldo)}</td>
                          <td className="px-2 py-2 text-right font-mono text-zinc-300 whitespace-nowrap">{fmtBRL(it.in_field_cost)}</td>
                          <td className="px-2 py-2 text-right font-mono text-zinc-400">{it.events_count}</td>
                        </tr>
                        {open && (
                          <tr className="border-t border-white/5 bg-zinc-950/40">
                            <td colSpan={13} className="px-4 py-2">
                              <div data-testid={`ledger-item-events-${it.id}`}>
                                <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#00F0FF] inline-flex items-center gap-1 mb-1"><History className="w-3 h-3" /> Linha do tempo · {evs.length} evento(s) · custo unit. {fmtBRL(it.unit_cost)}</p>
                                {evs.length === 0 ? <p className="text-[11px] text-zinc-500 italic py-1">Sem movimentações registradas para este item.</p> : evs.map((e, i) => <EventRow key={i} e={e} />)}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
