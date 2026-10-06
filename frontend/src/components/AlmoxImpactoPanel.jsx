import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { AlertOctagon, Plus, Trash2, Clock, Users, DollarSign, Settings2, ChevronDown, ChevronRight, Loader } from 'lucide-react';
import { formatCurrency, todayISO } from '../lib/constants';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const inp = 'bg-zinc-950/80 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#FF5E00]';
const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

const Kpi = ({ testid, icon: Icon, label, value, color }) => (
  <div data-testid={testid} className="rounded-xl border p-3" style={{ borderColor: `${color}40`, background: `${color}0d` }}>
    <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500 inline-flex items-center gap-1"><Icon className="w-3 h-3" style={{ color }} /> {label}</p>
    <p className="font-mono text-xl font-black mt-1" style={{ color }}>{value}</p>
  </div>
);

const Breakdown = ({ title, rows, total, testid }) => (
  <div data-testid={testid} className="rounded-xl border border-white/10 p-3">
    <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">{title}</p>
    {rows.length === 0 ? <p className="text-[11px] text-zinc-600 italic">Sem ocorrências no mês.</p> : rows.slice(0, 8).map((r) => (
      <div key={r.label} className="mb-1.5">
        <div className="flex items-center justify-between text-[11px]"><span className="text-zinc-200 truncate max-w-[70%]">{r.label}</span><span className="font-mono text-white">{formatCurrency(r.custo)} <span className="text-zinc-500">· {r.horas}h</span></span></div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-[#FF5E00]" style={{ width: `${total ? Math.max(3, (r.custo / total) * 100) : 0}%` }} /></div>
      </div>
    ))}
  </div>
);

/** Out/2026 · Impacto do almoxarifado (HH) — ocorrências manuais + lançamentos automáticos do Retorno da Programação. */
export const AlmoxImpactoPanel = ({ projects = [] }) => {
  const [open, setOpen] = useState(true);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hhRate, setHhRate] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const [form, setForm] = useState({ project_id: '', date: todayISO(), tipo: 'espera_doca', hours: '', members: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    axios.get(`${API}/almoxarifado/impacto`, { params: { month } }).then(({ data: d }) => { setData(d); setHhRate(d.config?.hh_rate ?? ''); }).catch(() => toast.error('Erro ao carregar impacto do almoxarifado')).finally(() => setLoading(false));
  };
  useEffect(load, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const tipos = data?.tipos || {};
  const selectedProject = useMemo(() => projects.find((p) => p.id === form.project_id), [projects, form.project_id]);

  const saveCfg = async () => {
    try {
      const v = hhRate === '' ? null : Number(hhRate);
      await axios.put(`${API}/almoxarifado/impacto/config`, { hh_rate: v });
      toast.success(v ? `R$/HH fixo = ${formatCurrency(v)} (novas ocorrências)` : 'Usando meta diária ÷ 8');
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao salvar'); }
  };

  const add = async () => {
    if (!form.hours && form.tipo !== 'separada_nao_atendida') { toast.error('Informe as horas perdidas'); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/almoxarifado/impacto/ocorrencias`, { ...form, project_id: form.project_id || null, hours: Number(form.hours) || 0, members: form.members ? Number(form.members) : null, team_id: selectedProject?.team_id || null });
      toast.success('Ocorrência registrada');
      setForm((f) => ({ ...f, hours: '', members: '', description: '' }));
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao registrar'); }
    finally { setSaving(false); }
  };

  const remove = async (it) => {
    if (!window.confirm('Excluir esta ocorrência?')) return;
    try { await axios.delete(`${API}/almoxarifado/impacto/ocorrencias/${it.id}`); toast.success('Ocorrência excluída'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const t = data?.totals || {};
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} data-testid="almox-impacto-panel" className="glass-panel rounded-2xl overflow-hidden border border-[#FF5E00]/30">
      <button type="button" data-testid="almox-impacto-toggle" onClick={() => setOpen((v) => !v)} className="w-full p-4 flex items-center gap-3 text-left">
        <div className="w-10 h-10 rounded-xl bg-[#FF5E00]/10 border border-[#FF5E00]/40 flex items-center justify-center shrink-0"><AlertOctagon className="w-5 h-5 text-[#FF5E00]" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#FF5E00]">Impacto do almoxarifado (HH)</p>
          <p className="text-xs text-zinc-500 truncate">Programações não atendidas por material, obras separadas e não atendidas, espera na doca — prejuízo em horas e R$</p>
        </div>
        {data && <span data-testid="almox-impacto-total-chip" className="font-mono text-sm font-black text-[#FF5E00]">{formatCurrency(t.custo || 0)}</span>}
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <input data-testid="almox-impacto-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inp} />
            <button type="button" data-testid="almox-impacto-cfg-toggle" onClick={() => setShowCfg((v) => !v)} className="text-[10px] font-bold text-zinc-300 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10"><Settings2 className="w-3 h-3" /> Valor da hora</button>
            {showCfg && (
              <div data-testid="almox-impacto-cfg" className="flex items-center gap-1.5 flex-wrap text-[11px] text-zinc-400">
                <span>R$/HH fixo</span>
                <input data-testid="almox-impacto-hh-rate" type="number" min="0" step="0.01" value={hhRate} onChange={(e) => setHhRate(e.target.value)} placeholder="vazio = meta ÷ 8" className={`${inp} w-32`} />
                <button type="button" data-testid="almox-impacto-cfg-save" onClick={saveCfg} className="text-[10px] font-black text-black bg-[#FF5E00] px-3 py-1.5 rounded-full">Salvar</button>
                <span className="text-zinc-600">{data?.config?.hh_rate ? `custo = horas × pessoas × ${formatCurrency(data.config.hh_rate)}` : 'custo = horas × (meta diária da equipe ÷ 8)'}</span>
              </div>
            )}
            {loading && <Loader className="w-4 h-4 animate-spin text-[#FF5E00]" />}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi testid="almox-impacto-kpi-ocorrencias" icon={AlertOctagon} label="Ocorrências" value={t.ocorrencias ?? 0} color="#FF5E00" />
            <Kpi testid="almox-impacto-kpi-horas" icon={Clock} label="Horas perdidas" value={`${t.horas ?? 0}h`} color="#E0FF00" />
            <Kpi testid="almox-impacto-kpi-hh" icon={Users} label="HH (homem-hora)" value={t.hh ?? 0} color="#00F0FF" />
            <Kpi testid="almox-impacto-kpi-custo" icon={DollarSign} label="Prejuízo estimado" value={formatCurrency(t.custo || 0)} color="#FF003C" />
          </div>

          <div className="grid md:grid-cols-3 gap-2">
            <Breakdown testid="almox-impacto-por-tipo" title="Por situação" rows={data?.por_tipo || []} total={t.custo} />
            <Breakdown testid="almox-impacto-por-obra" title="Por obra" rows={data?.por_obra || []} total={t.custo} />
            <Breakdown testid="almox-impacto-por-equipe" title="Por equipe" rows={data?.por_equipe || []} total={t.custo} />
          </div>

          <div data-testid="almox-impacto-form" className="rounded-xl border border-white/10 p-3 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <label className="col-span-2 md:col-span-2 text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Obra
              <select data-testid="almox-impacto-form-project" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={`${inp} w-full mt-0.5`}>
                <option value="">— sem obra (geral) —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code ? `${p.project_code} · ` : ''}{p.name}{p.team_name ? ` (${p.team_name})` : ''}</option>)}
              </select>
            </label>
            <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Data
              <input data-testid="almox-impacto-form-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${inp} w-full mt-0.5`} />
            </label>
            <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Situação
              <select data-testid="almox-impacto-form-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={`${inp} w-full mt-0.5`}>
                {Object.entries(tipos).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Horas
              <input data-testid="almox-impacto-form-hours" type="number" min="0" step="0.5" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} className={`${inp} w-full mt-0.5`} />
            </label>
            <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Pessoas
              <input data-testid="almox-impacto-form-members" type="number" min="1" step="1" value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value })} placeholder="equipe" className={`${inp} w-full mt-0.5`} />
            </label>
            <input data-testid="almox-impacto-form-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição (ex.: equipe esperou 2h na doca; material separado e obra não atendida)" className={`${inp} col-span-2 md:col-span-5 w-full`} />
            <button type="button" data-testid="almox-impacto-form-save" onClick={add} disabled={saving} className="text-[11px] font-black text-black bg-[#FF5E00] px-3 py-2 rounded-full inline-flex items-center justify-center gap-1 disabled:opacity-60">{saving ? <Loader className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Lançar</button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-[11px]" data-testid="almox-impacto-table">
              <thead><tr className="text-[9px] tracking-[0.15em] uppercase font-bold text-zinc-500 bg-white/[0.02]">
                <th className="text-left px-2 py-2">Data</th><th className="text-left px-2 py-2">Obra · equipe</th><th className="text-left px-2 py-2">Situação</th><th className="text-right px-2 py-2">Horas</th><th className="text-right px-2 py-2">HH</th><th className="text-right px-2 py-2">R$</th><th className="text-left px-2 py-2">Descrição</th><th className="px-2 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {(data?.items || []).length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-zinc-600 italic">Nenhuma ocorrência em {month.split('-').reverse().join('/')}.</td></tr>}
                {(data?.items || []).map((it) => (
                  <tr key={it.id} data-testid={`almox-impacto-row-${it.id}`} className="hover:bg-white/[0.02]">
                    <td className="px-2 py-1.5 font-mono text-zinc-300 whitespace-nowrap">{dateBR(it.date)}</td>
                    <td className="px-2 py-1.5 text-white"><span className="font-mono text-[#E0FF00]">{it.project_code || ''}</span> {it.project_name || <span className="text-zinc-500">geral</span>}{it.team_name ? <span className="text-zinc-500"> · {it.team_name}</span> : null}</td>
                    <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold border border-[#FF5E00]/40 text-[#FF5E00]">{it.tipo_label}</span>{it.source === 'retorno' && <span className="ml-1 text-[9px] text-zinc-500">auto</span>}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-white">{it.hours}h</td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-300">{it.hh}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold text-[#FF003C]">{formatCurrency(it.cost || 0)}</td>
                    <td className="px-2 py-1.5 text-zinc-400 max-w-[260px] truncate" title={it.description}>{it.description}</td>
                    <td className="px-2 py-1.5 text-right"><button type="button" data-testid={`almox-impacto-del-${it.id}`} onClick={() => remove(it)} className="text-zinc-500 hover:text-[#FF003C]"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
};
