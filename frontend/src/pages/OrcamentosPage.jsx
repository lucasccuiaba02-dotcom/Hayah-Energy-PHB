import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, Search, Building2, FileSignature, Wallet, CheckCircle2, Send } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { formatCurrency } from '../lib/constants';
import { API, STATUS, statusOf, fmtDate, btnGhost, btnPrimary } from '../components/orcamentos/orcamentoShared';
import { OrcamentoEditor } from '../components/orcamentos/OrcamentoEditor';
import { CompanyModal } from '../components/orcamentos/CompanyModal';

const Kpi = ({ testid, label, value, sub, color, icon: Icon }) => (
  <div data-testid={testid} className="glass-panel rounded-xl p-3 border-l-4" style={{ borderColor: color }}>
    <div className="flex items-center justify-between mb-1">
      <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">{label}</p>
      <Icon className="w-3.5 h-3.5" style={{ color }} />
    </div>
    <p className="font-mono text-xl sm:text-2xl font-black leading-none truncate" style={{ color }}>{value}</p>
    <p className="text-[10px] text-zinc-500 mt-1">{sub}</p>
  </div>
);

const OrcCard = ({ o, active, onClick }) => {
  const st = statusOf(o.status);
  return (
    <button data-testid={`orc-card-${o.id}`} onClick={onClick} className={`w-full text-left glass-panel rounded-xl p-3 border transition ${active ? 'border-[#E0FF00] bg-[#E0FF00]/[0.06]' : 'border-white/10 hover:border-white/25'}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-xs font-bold text-[#E0FF00]">{o.code}</span>
        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase" style={{ background: `${st.color}20`, color: st.color }}>{st.label}</span>
      </div>
      <p className="text-sm text-white font-bold truncate">{o.client_name || 'Sem cliente'}</p>
      <p className="text-[10px] text-zinc-500 truncate">{o.objeto || 'Sem objeto'}{o.location ? ` · ${o.location}` : ''}</p>
      <div className="flex items-center justify-between mt-2 text-[10px]">
        <span className="text-zinc-500">{fmtDate(o.base_date)} · {o.labor_count} serv · {o.material_count} mat · {o.photos_count} img</span>
        <span className="font-mono font-bold text-white">{formatCurrency(o.grand_total)}</span>
      </div>
    </button>
  );
};

export default function OrcamentosPage() {
  const [list, setList] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [companyOpen, setCompanyOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/orcamentos`);
      setList(data);
    } catch { toast.error('Falha ao carregar orçamentos'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    axios.get(`${API}/orcamentos/${selectedId}`).then(({ data }) => setDetail(data)).catch(() => { toast.error('Orçamento não encontrado'); setSelectedId(null); });
  }, [selectedId]);

  const create = async () => {
    try {
      const { data } = await axios.post(`${API}/orcamentos`, {});
      toast.success(`Orçamento ${data.code} criado`);
      await load();
      setSelectedId(data.id);
      setDetail(data);
    } catch { toast.error('Falha ao criar orçamento'); }
  };

  const onRefresh = (doc) => { setDetail(doc); load(); };
  const onDeleted = () => { setSelectedId(null); setDetail(null); load(); };
  const onCreated = (doc) => { load(); setSelectedId(doc.id); setDetail(doc); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list || []).filter((o) => (!filter || o.status === filter) && (!q || `${o.code} ${o.client_name} ${o.objeto} ${o.location}`.toLowerCase().includes(q)));
  }, [list, search, filter]);

  const kpis = useMemo(() => {
    const sum = (keys) => (list || []).filter((o) => keys.includes(o.status)).reduce((s, o) => s + (o.grand_total || 0), 0);
    const cnt = (keys) => (list || []).filter((o) => keys.includes(o.status)).length;
    return {
      total: (list || []).length,
      abertos: { v: sum(['rascunho', 'enviado']), n: cnt(['rascunho', 'enviado']) },
      carteira: { v: sum(['aprovado', 'em_execucao']), n: cnt(['aprovado', 'em_execucao']) },
      concluidos: { v: sum(['concluido']), n: cnt(['concluido']) },
    };
  }, [list]);

  return (
    <AppLayout
      title="Orçamentos"
      subtitle="Obras particulares · propostas comerciais e relatórios de conclusão"
      actions={(
        <div className="flex gap-2">
          <button data-testid="orc-company-open" onClick={() => setCompanyOpen(true)} className={btnGhost}><Building2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Dados da empresa</span></button>
          <button data-testid="orc-new" onClick={create} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Novo orçamento</button>
        </div>
      )}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi testid="orc-kpi-total" label="Orçamentos" value={kpis.total} sub="cadastrados" color="#E0FF00" icon={FileSignature} />
        <Kpi testid="orc-kpi-abertos" label="Em negociação" value={formatCurrency(kpis.abertos.v)} sub={`${kpis.abertos.n} rascunho/enviado`} color="#00F0FF" icon={Send} />
        <Kpi testid="orc-kpi-carteira" label="Aprovados" value={formatCurrency(kpis.carteira.v)} sub={`${kpis.carteira.n} aprovado/em execução`} color="#FF5E00" icon={Wallet} />
        <Kpi testid="orc-kpi-concluidos" label="Concluídos" value={formatCurrency(kpis.concluidos.v)} sub={`${kpis.concluidos.n} obra(s) entregue(s)`} color="#39FF14" icon={CheckCircle2} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        <div className={`space-y-3 ${selectedId ? 'hidden lg:block' : ''}`}>
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center gap-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <input data-testid="orc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código, cliente, objeto…" className="flex-1 bg-transparent text-sm text-white focus:outline-none" />
          </div>
          <div className="flex gap-1 flex-wrap" data-testid="orc-status-filter">
            <button data-testid="orc-filter-all" onClick={() => setFilter('')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${!filter ? 'bg-white text-black' : 'bg-white/5 text-zinc-400 border border-white/10'}`}>Todos</button>
            {STATUS.map((s) => (
              <button key={s.key} data-testid={`orc-filter-${s.key}`} onClick={() => setFilter(filter === s.key ? '' : s.key)} className="px-2 py-0.5 rounded-full text-[10px] font-bold border" style={filter === s.key ? { background: s.color, color: '#000', borderColor: s.color } : { color: s.color, borderColor: `${s.color}55`, background: `${s.color}10` }}>{s.label}</button>
            ))}
          </div>
          <div data-testid="orc-list" className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {!list ? <p className="text-zinc-500 text-sm">Carregando…</p> : filtered.length === 0 ? (
              <div data-testid="orc-empty" className="glass-panel rounded-xl p-6 text-center text-zinc-500 text-sm">
                {list.length === 0 ? 'Nenhum orçamento ainda. Clique em "Novo orçamento".' : 'Nenhum orçamento corresponde ao filtro.'}
              </div>
            ) : filtered.map((o) => <OrcCard key={o.id} o={o} active={o.id === selectedId} onClick={() => setSelectedId(o.id)} />)}
          </div>
        </div>

        <div className={`min-w-0 ${!selectedId ? 'hidden lg:block' : ''}`}>
          {!selectedId ? (
            <div data-testid="orc-placeholder" className="glass-panel rounded-2xl p-10 text-center text-zinc-500">
              <FileSignature className="w-10 h-10 mx-auto mb-3 text-zinc-600" />
              Selecione um orçamento ao lado ou crie um novo.
              <p className="text-[11px] text-zinc-600 mt-2">Fluxo: Rascunho → Enviado → Aprovado → Em execução → Concluído · PDFs: Proposta Comercial e Relatório de Conclusão</p>
            </div>
          ) : !detail ? <div className="glass-panel rounded-2xl p-10 text-center text-zinc-500">Carregando…</div> : (
            <OrcamentoEditor orc={detail} onRefresh={onRefresh} onDeleted={onDeleted} onCreated={onCreated} onBack={() => setSelectedId(null)} />
          )}
        </div>
      </div>

      {companyOpen && <CompanyModal onClose={() => setCompanyOpen(false)} />}
    </AppLayout>
  );
}
