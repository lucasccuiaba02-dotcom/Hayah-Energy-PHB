// Fev/2026 · Editor da APR (Análise Preliminar de Risco) — versão digital.
// Fiel ao modelo físico: header + EPIs + EPCs + Riscos + Procedimentos (Sim/Não/N.A)
// + Medidas de controle + Observações + Assinaturas (canvas) + Linha Viva/Morta.
// Também expõe download em PDF e persistência via /api/aprs.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { X, Save, FileDown, Zap, ShieldCheck, Trash2, Plus, PenLine, Loader, WifiOff, ClipboardCheck } from 'lucide-react';
import { EPI_ITEMS_VIVA, EPC_ITEMS_VIVA, RISK_ITEMS_VIVA, PROCEDIMENTOS_VIVA, CHECKLIST_SECTIONS } from '../lib/aprLists';
import { enqueue } from '../lib/offline';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const EMPTY_CHECKLISTS = { ferramental: { items: {}, obs: '' }, epi: { items: {}, obs: '' }, epc: { items: {}, obs: '' } };
const CHECK_STATUS = [['c', 'C', '#39FF14', 'Conforme'], ['nc', 'NC', '#FF003C', 'Não conforme'], ['na', 'N/A', '#E0FF00', 'Não se aplica']];
const newClientId = () => `apr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Listas fiéis ao PDF anexado pelo usuário
export const EPI_ITEMS = [
  ['vestimenta_anti_chama', 'Vestimenta anti-chama'],
  ['botina_seguranca', 'Botina de segurança'],
  ['luvas_borracha_tensao', 'Luvas de Borracha (classe de tensão)'],
  ['luva_cobertura', 'Luva de Cobertura p/ luva isolante'],
  ['linha_de_vida', 'Linha de vida'],
  ['trava_quedas', 'Trava-quedas'],
  ['luvas_vaqueta', 'Luvas de vaqueta'],
  ['capacete', 'Capacete'],
  ['talabarte_corda', 'Talabarte ajustável de corda'],
  ['vestimenta_abelha', 'Vestimenta proteção contra abelha'],
  ['balaclava', 'Balaclava'],
  ['oculos_protecao', 'Óculos e proteção'],
  ['protetor_facial', 'Protetor facial'],
  ['cinto_paraquedista', 'Cinto paraquedista'],
  ['perneira', 'Perneira'],
  ['vestimenta_chuva', 'Vestimenta impermeável p/ chuva'],
];
export const EPC_ITEMS = [
  ['cone_sinalizacao', 'Cone de sinalização'],
  ['load_buster', 'Load buster'],
  ['conjunto_aterramento', 'Conjunto de aterramento'],
  ['faixa_sinalizacao', 'Faixa de sinalização'],
  ['vara_manobra', 'Vara de Manobra'],
  ['calco_veiculo', 'Calço para veículo'],
  ['cobertura_lencol', 'Cobertura / Lençol'],
  ['bastao_pega_tudo', 'Bastão Pega tudo'],
  ['detector_tensao', 'Detector de tensão'],
  ['descensor_blocante', 'Descensor Blocante 12mm'],
  ['escada_adequada', 'Escada tamanho adequado'],
  ['ferramentas_isoladas', 'Ferramentas isoladas'],
  ['caminhao_guindauto', 'Caminhão guindauto'],
  ['caminhao_linha_viva', 'Caminhão Linha Viva (C. duplo)'],
];
export const RISK_ITEMS = [
  ['lesoes_fisicas', 'Lesões Físicas'],
  ['curto_circuito', 'Curto Circuito'],
  ['abalroamento', 'Abalroamento/Colisão'],
  ['choque_eletrico', 'Choque Elétrico'],
  ['derrapagem', 'Derrapagem'],
  ['queda_estrutura', 'Queda de Escadas/Estruturas'],
  ['deslizamento', 'Deslizamento'],
  ['choque_mecanico', 'Choque mecânico'],
  ['queda_materiais', 'Queda de materiais/ferramentas'],
  ['ataque_animais', 'Ataque de animais e insetos'],
  ['queda_altura', 'Queda em altura'],
  ['risco_ergonomico', 'Risco Ergonômico'],
  ['atropelamento', 'Atropelamento'],
];
export const PROCEDIMENTOS = [
  ['condicao_fisica', 'O(s) colaborador(es) se encontram em condições física, mental e emocional para realizar sua função?'],
  ['supervisor_definido', 'Definido o supervisor no planejamento da tarefa?'],
  ['horario_ciente', 'Todos cientes do horário de início/término do desligamento?'],
  ['seccionamento_definido', 'Está definido quem irá realizar o seccionamento da rede?'],
  ['pontos_aterramento', 'Definidos os pontos de aterramento temporário com equipotencialização?'],
  ['detector_testado', 'O detector de tensão foi testado antes da utilização?'],
  ['procedimentos_conhecidos', 'Todos conhecem os procedimentos e o que irão executar?'],
  ['escadas_inspecionadas', 'Escadas inspecionadas com cordas para amarrar topo e base?'],
  ['estrutura_ancoragem', 'Estrutura de ancoragem da linha de vida oferece segurança?'],
  ['operador_guindauto', 'Operador do guindauto está capacitado?'],
  ['guindauto_patolado', 'Guindauto calçado, lanças abertas e patolado?'],
  ['rede_energizada', 'Existe ponto energizado ou cruzamento com linha energizada? Todos cientes?'],
  ['veiculo_estacionado', 'Veículo estacionado/calçado/sinalizado com livre trânsito?'],
  ['epis_disponiveis', 'Todos EPI/EPC/ferramentas necessários e adequados disponíveis?'],
  ['sinalizacao_area', 'Previsto a sinalização da área de trabalho?'],
  ['local_desobstruido', 'Local desobstruído, boa visibilidade e acesso?'],
  ['controle_coi', 'Tarefa está sob controle do COI?'],
  ['condicoes_estruturas', 'Analisadas condições físicas das estruturas incluindo base do poste?'],
  ['seccionamento_ditais', 'Necessário seccionamento? (DITAIS)'],
  ['bloqueio_religamento_ditais', 'Necessário bloqueio de religamento? (DITAIS)'],
  ['sinalizacao_nao_opere', '"Não opere este equipamento" e retirada dos cartuchos previstos? (DITAIS)'],
  ['teste_ausencia_tensao', 'Previsto teste de ausência de tensão? (DITAIS)'],
  ['conjuntos_aterramento', 'Previsto aterramento suficiente da área de trabalho? (DITAIS)'],
  ['protecao_energizados', 'Prevista proteção de elementos energizados na zona de risco? (DITAIS)'],
  ['acidentes_medicao', 'Existem situações de acidente na caixa de medição?'],
  ['posicionamento_escada', 'Procurou-se o melhor posicionamento para a escada?'],
  ['outras_situacoes', 'Outras situações de risco observadas? (detalhar em observações)'],
];

// ─── Canvas de assinatura reutilizável ──────────────────────────────────────
const SignaturePad = ({ value, onChange, testid }) => {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = value;
    }
  }, [value]);

  const getPos = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * (c.width / rect.width), y: (t.clientY - rect.top) * (c.height / rect.height) };
  };

  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = getPos(e); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = getPos(e);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    onChange('');
  };

  return (
    <div className="relative">
      <canvas
        data-testid={testid}
        ref={canvasRef}
        width={400}
        height={100}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        className="w-full h-24 rounded border border-white/20 bg-white cursor-crosshair touch-none"
        style={{ touchAction: 'none' }}
      />
      <button
        type="button"
        onClick={clear}
        data-testid={`${testid}-clear`}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px] font-bold hover:bg-black/80"
        title="Limpar assinatura"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

// ─── Editor principal (modal fullscreen) ────────────────────────────────────
export const APREditor = ({ projectId, project, teams = [], initialApr = null, initialLineType = null, onClose, onSaved }) => {
  const team = useMemo(() => teams.find((t) => t.id === project?.team_id) || null, [teams, project]);
  const teamMembers = team ? (team.members || []) : [];

  const [apr, setApr] = useState(() => initialApr ? { ...initialApr, checklists: { ...EMPTY_CHECKLISTS, ...(initialApr.checklists || {}) } } : {
    line_type: initialLineType || (project?.requires_hot_line ? 'viva' : 'morta'),
    os_number: '',
    client_id: newClientId(),
    header: {
      date: new Date().toISOString().slice(0, 10),
      task: project?.name || '',
      area: 'Rural',
      team_number: team?.name || '',
      location: project?.location || '',
      professionals_count: teamMembers.length || 1,
      company: 'HAYAH ENERGY',
      os_number: project?.project_code || '',
    },
    epis: {},
    epcs: {},
    riscos: {},
    procedimentos: {},
    medidas_extra: [],
    observacoes: '',
    supervisor: { nome: team?.supervisor || '', matricula: '', assinatura: '' },
    executores: [],
    checklists: EMPTY_CHECKLISTS,
  });
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const isLive = apr.line_type === 'viva';
  const LISTS = isLive
    ? { epi: EPI_ITEMS_VIVA, epc: EPC_ITEMS_VIVA, risk: RISK_ITEMS_VIVA, proc: PROCEDIMENTOS_VIVA }
    : { epi: EPI_ITEMS, epc: EPC_ITEMS, risk: RISK_ITEMS, proc: PROCEDIMENTOS };
  const accent = isLive ? '#FF003C' : '#E0FF00';

  const toggle = (section, key) => setApr((s) => ({ ...s, [section]: { ...s[section], [key]: !s[section][key] } }));
  const setYNA = (key, val) => setApr((s) => ({ ...s, procedimentos: { ...s.procedimentos, [key]: val } }));
  const setHeader = (k, v) => setApr((s) => ({ ...s, header: { ...s.header, [k]: v } }));
  const setSup = (k, v) => setApr((s) => ({ ...s, supervisor: { ...s.supervisor, [k]: v } }));
  const setCheckItem = (sec, k, val) => setApr((s) => ({ ...s, checklists: { ...s.checklists, [sec]: { ...(s.checklists?.[sec] || { items: {} }), items: { ...(s.checklists?.[sec]?.items || {}), [k]: val } } } }));
  const setCheckObs = (sec, obs) => setApr((s) => ({ ...s, checklists: { ...s.checklists, [sec]: { ...(s.checklists?.[sec] || { items: {} }), obs } } }));
  const setCheckAll = (sec, items, status) => setApr((s) => ({ ...s, checklists: { ...s.checklists, [sec]: { ...(s.checklists?.[sec] || {}), items: Object.fromEntries(items.map(([k]) => [k, { ...(s.checklists?.[sec]?.items?.[k] || {}), status }])) } } }));

  const addExecutor = () => setApr((s) => ({ ...s, executores: [...s.executores, { nome: '', matricula: '', assinatura: '' }] }));
  const removeExecutor = (idx) => setApr((s) => ({ ...s, executores: s.executores.filter((_, i) => i !== idx) }));
  const setExec = (idx, k, v) => setApr((s) => ({ ...s, executores: s.executores.map((ex, i) => i === idx ? { ...ex, [k]: v } : ex) }));

  const save = async () => {
    if (!projectId) { toast.error('Sem obra selecionada'); return; }
    setSaving(true);
    const clientId = apr.client_id || newClientId();
    const { id: _id, _offline, created_at, created_by, updated_at, project_id: _pid, ...rest } = apr;
    const payload = { ...rest, client_id: clientId, os_number: apr.os_number || apr.header?.os_number || '' };
    const saveOffline = () => {
      enqueue({ type: 'apr', projectId, aprId: initialApr?.id || null, data: payload });
      const local = { ...payload, id: initialApr?.id || null, project_id: projectId, created_at: initialApr?.created_at || new Date().toISOString(), _offline: true };
      setApr((s) => ({ ...s, client_id: clientId }));
      toast.info('Sem sinal — APR salva no celular. Sincroniza automaticamente ao voltar a internet.');
      onSaved?.(local, { offline: true });
    };
    try {
      if (!navigator.onLine) { saveOffline(); return; }
      let saved;
      if (initialApr?.id) {
        const { data } = await axios.patch(`${API}/aprs/${initialApr.id}`, payload);
        saved = data;
      } else {
        const { data } = await axios.post(`${API}/projects/${projectId}/aprs`, payload);
        saved = data;
      }
      toast.success('APR salva');
      onSaved?.(saved, { offline: false });
    } catch (err) {
      if (!err?.response) saveOffline();
      else toast.error(err?.response?.data?.detail || 'Erro ao salvar APR');
    } finally { setSaving(false); }
  };

  const downloadPdf = async () => {
    if (!initialApr?.id) { toast.info('Salve a APR antes de exportar o PDF'); return; }
    try {
      const res = await axios.get(`${API}/aprs/${initialApr.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `APR_${apr.os_number || initialApr.id}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error('Erro ao gerar PDF'); }
  };

  return (
    <div data-testid="apr-editor" className="fixed inset-0 z-[70] bg-black/95 backdrop-blur-xl overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-[#050505]/90 backdrop-blur border-b border-white/10 py-3 px-1">
          <button data-testid="apr-close" onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 text-white flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.2em] uppercase font-bold" style={{ color: accent }}>Análise Preliminar de Risco{isLive ? ' · LINHA VIVA' : ''}</p>
            <h2 className="text-white font-bold truncate">{project?.name || 'Obra'}</h2>
          </div>
          {!online && <span data-testid="apr-offline-badge" className="text-[10px] font-bold px-2 py-1 rounded-full bg-[#FF5E00]/15 border border-[#FF5E00]/40 text-[#FF5E00] inline-flex items-center gap-1"><WifiOff className="w-3 h-3" /> offline</span>}
          <button data-testid="apr-download-pdf" onClick={downloadPdf} disabled={!initialApr?.id || !online} className="text-xs font-bold px-3 py-2 rounded-full bg-white/5 border border-white/10 text-white flex items-center gap-1 disabled:opacity-40" title={!initialApr?.id ? 'Salve primeiro' : !online ? 'PDF só com internet' : 'Baixar PDF'}>
            <FileDown className="w-3 h-3" /> PDF
          </button>
          <button data-testid="apr-save" onClick={save} disabled={saving} className="text-xs font-black px-4 py-2 rounded-full bg-[#E0FF00] text-black flex items-center gap-1 disabled:opacity-60">
            {saving ? <Loader className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} {online ? 'Salvar' : 'Salvar offline'}
          </button>
        </div>

        {/* Linha Viva / Morta */}
        <div className="grid grid-cols-2 gap-2">
          {[['morta', 'LINHA MORTA', '#00795c'], ['viva', 'LINHA VIVA', '#FF003C']].map(([val, lbl, color]) => (
            <button
              key={val}
              data-testid={`apr-linetype-${val}`}
              onClick={() => setApr((s) => ({ ...s, line_type: val }))}
              className="rounded-2xl p-4 border-2 flex items-center justify-center gap-2 font-black text-sm transition-all"
              style={{
                borderColor: apr.line_type === val ? color : 'rgba(255,255,255,0.1)',
                backgroundColor: apr.line_type === val ? `${color}22` : 'transparent',
                color: apr.line_type === val ? color : '#aaa',
              }}
            >
              <Zap className="w-4 h-4" /> {lbl}
            </button>
          ))}
        </div>
        {isLive && (
          <div data-testid="apr-viva-notice" className="rounded-xl border border-[#FF003C]/40 bg-[#FF003C]/[0.08] p-3 text-[11px] text-zinc-200">
            <b className="text-[#FF003C]">APR LINHA VIVA (rede energizada · NR-10 SEP):</b> EPI/EPC, riscos e procedimentos específicos para trabalho em linha viva. Exige equipe habilitada, comunicação com o COD e bloqueio de religamento automático.
          </div>
        )}

        {/* Identificação */}
        <Section title="IDENTIFICAÇÃO">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="Data" testid="apr-date" type="date" value={apr.header.date} onChange={(v) => setHeader('date', v)} />
            <Field label="OS Nº" testid="apr-os" value={apr.header.os_number || apr.os_number} onChange={(v) => { setHeader('os_number', v); setApr((s) => ({ ...s, os_number: v })); }} />
            <Field label="Nº Equipe" testid="apr-team-num" value={apr.header.team_number} onChange={(v) => setHeader('team_number', v)} />
            <Field label="Área" testid="apr-area" value={apr.header.area} onChange={(v) => setHeader('area', v)} />
            <Field label="Tarefa" testid="apr-task" span={2} value={apr.header.task} onChange={(v) => setHeader('task', v)} />
            <Field label="Local" testid="apr-location" span={2} value={apr.header.location} onChange={(v) => setHeader('location', v)} />
            <Field label="Nº profissionais" testid="apr-prof-count" type="number" value={apr.header.professionals_count} onChange={(v) => setHeader('professionals_count', Number(v) || 0)} />
            <Field label="Empresa" testid="apr-company" value={apr.header.company} onChange={(v) => setHeader('company', v)} />
          </div>
        </Section>

        {/* EPIs + EPCs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Section title="EPIs — O QUE SERÁ UTILIZADO?">
            <div className="grid grid-cols-1 gap-1">
              {LISTS.epi.map(([k, lbl]) => (
                <CheckLine key={k} testid={`apr-epi-${k}`} label={lbl} checked={!!apr.epis[k]} onToggle={() => toggle('epis', k)} />
              ))}
              <input
                data-testid="apr-epi-outros"
                placeholder="Outros…"
                value={apr.epis.outros || ''}
                onChange={(e) => setApr((s) => ({ ...s, epis: { ...s.epis, outros: e.target.value } }))}
                className="mt-2 w-full text-xs bg-zinc-950/60 border border-white/10 rounded px-2 py-1 text-white"
              />
            </div>
          </Section>
          <Section title="EPCs / FERRAMENTAS">
            <div className="grid grid-cols-1 gap-1">
              {LISTS.epc.map(([k, lbl]) => (
                <CheckLine key={k} testid={`apr-epc-${k}`} label={lbl} checked={!!apr.epcs[k]} onToggle={() => toggle('epcs', k)} />
              ))}
              <input
                data-testid="apr-epc-outros"
                placeholder="Outros…"
                value={apr.epcs.outros || ''}
                onChange={(e) => setApr((s) => ({ ...s, epcs: { ...s.epcs, outros: e.target.value } }))}
                className="mt-2 w-full text-xs bg-zinc-950/60 border border-white/10 rounded px-2 py-1 text-white"
              />
            </div>
          </Section>
        </div>

        {/* Riscos */}
        <Section title="RISCOS POTENCIAIS">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
            {LISTS.risk.map(([k, lbl]) => (
              <CheckLine key={k} testid={`apr-risk-${k}`} label={lbl} checked={!!apr.riscos[k]} onToggle={() => toggle('riscos', k)} />
            ))}
          </div>
          <input
            data-testid="apr-risk-outros"
            placeholder="Outros riscos…"
            value={apr.riscos.outros || ''}
            onChange={(e) => setApr((s) => ({ ...s, riscos: { ...s.riscos, outros: e.target.value } }))}
            className="mt-2 w-full text-xs bg-zinc-950/60 border border-white/10 rounded px-2 py-1 text-white"
          />
        </Section>

        {/* Procedimentos preliminares */}
        <Section title={isLive ? 'PROCEDIMENTOS PRELIMINARES — LINHA VIVA (NR-10 SEP)' : 'PROCEDIMENTOS PRELIMINARES / MEDIDAS GERAIS DE CONTROLE'}>
          <div className="space-y-1">
            {LISTS.proc.map(([k, q], i) => (
              <div key={k} data-testid={`apr-proc-${k}`} className="flex items-start justify-between gap-2 py-1.5 border-b border-white/5">
                <p className="text-[11px] text-zinc-300 flex-1">{i + 1}. {q}</p>
                <div className="flex gap-1 flex-shrink-0">
                  {['sim', 'nao', 'na'].map((v) => (
                    <button
                      key={v}
                      data-testid={`apr-proc-${k}-${v}`}
                      onClick={() => setYNA(k, apr.procedimentos[k] === v ? '' : v)}
                      className="text-[10px] font-black px-2 py-1 rounded border transition-all"
                      style={{
                        color: apr.procedimentos[k] === v ? (v === 'sim' ? '#39FF14' : v === 'nao' ? '#FF003C' : '#E0FF00') : '#666',
                        borderColor: apr.procedimentos[k] === v ? (v === 'sim' ? '#39FF14' : v === 'nao' ? '#FF003C' : '#E0FF00') : 'rgba(255,255,255,0.1)',
                        backgroundColor: apr.procedimentos[k] === v ? (v === 'sim' ? '#39FF1420' : v === 'nao' ? '#FF003C20' : '#E0FF0020') : 'transparent',
                      }}
                    >{v === 'sim' ? 'SIM' : v === 'nao' ? 'NÃO' : 'N/A'}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Set/2026 · Checklists de inspeção — Ferramental / EPI / EPC (C · NC · N.A.) */}
        {CHECKLIST_SECTIONS.map(([sec, title, items]) => (
          <InspectionChecklist
            key={sec}
            sec={sec}
            title={title}
            items={items}
            data={apr.checklists?.[sec] || { items: {}, obs: '' }}
            onItem={(k, val) => setCheckItem(sec, k, val)}
            onObs={(v) => setCheckObs(sec, v)}
            onAll={(status) => setCheckAll(sec, items, status)}
          />
        ))}

        {/* Observações */}
        <Section title="OBSERVAÇÕES GERAIS">
          <textarea
            data-testid="apr-observacoes"
            rows={3}
            value={apr.observacoes}
            onChange={(e) => setApr((s) => ({ ...s, observacoes: e.target.value }))}
            className="w-full text-xs bg-zinc-950/60 border border-white/10 rounded px-2 py-2 text-white"
            placeholder="Anote riscos não pré-identificados, condições do local, medidas extras…"
          />
        </Section>

        {/* Assinatura Supervisor + Executores */}
        <Section title="ASSINATURAS">
          <div className="space-y-3">
            <SignatureBlock
              role="Supervisor / Encarregado"
              testid="apr-supervisor"
              signer={apr.supervisor}
              onChange={setSup}
              teamMembers={teamMembers}
            />
            {apr.executores.map((ex, idx) => (
              <SignatureBlock
                key={idx}
                role={`Executor / Eletricista ${idx + 1}`}
                testid={`apr-executor-${idx}`}
                signer={ex}
                onChange={(k, v) => setExec(idx, k, v)}
                onRemove={() => removeExecutor(idx)}
                teamMembers={teamMembers}
              />
            ))}
            <button
              data-testid="apr-add-executor"
              onClick={addExecutor}
              className="w-full py-2 rounded-lg border-2 border-dashed border-white/20 text-zinc-400 hover:text-[#E0FF00] hover:border-[#E0FF00]/40 flex items-center justify-center gap-2 text-xs font-bold"
            >
              <Plus className="w-4 h-4" /> Adicionar eletricista/executor
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
};

const Section = ({ title, children }) => (
  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-xl border border-white/10 p-3">
    <p className="text-[9px] tracking-[0.2em] uppercase font-black text-[#E0FF00] mb-2">{title}</p>
    {children}
  </motion.div>
);

// Set/2026 · Checklist de inspeção (Conforme / Não conforme / N.A.) com observação por item
const InspectionChecklist = ({ sec, title, items, data, onItem, onObs, onAll }) => {
  const marks = data.items || {};
  const done = items.filter(([k]) => marks[k]?.status).length;
  const nc = items.filter(([k]) => marks[k]?.status === 'nc').length;
  return (
    <Section title={`${title} — CONFORME · NÃO CONFORME · N.A.`}>
      <div data-testid={`apr-chk-${sec}`} className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <ClipboardCheck className="w-4 h-4 text-zinc-400" />
          <p data-testid={`apr-chk-${sec}-summary`} className="text-[11px] text-zinc-400 flex-1">{done}/{items.length} inspecionados{nc > 0 ? <span className="text-[#FF003C] font-bold"> · {nc} não conforme</span> : ''}</p>
          <button data-testid={`apr-chk-${sec}-all-c`} onClick={() => onAll('c')} className="text-[10px] font-bold px-2 py-1 rounded-full border border-[#39FF14]/40 text-[#39FF14] bg-[#39FF14]/10">Todos conformes</button>
          <button data-testid={`apr-chk-${sec}-all-na`} onClick={() => onAll('na')} className="text-[10px] font-bold px-2 py-1 rounded-full border border-white/10 text-zinc-400">Todos N/A</button>
        </div>
        {items.map(([k, lbl]) => {
          const m = marks[k] || {};
          return (
            <div key={k} data-testid={`apr-chk-${sec}-${k}`} className="py-1.5 border-b border-white/5">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-[11px] flex-1 ${m.status === 'nc' ? 'text-[#FF003C] font-bold' : 'text-zinc-300'}`}>{lbl}</p>
                <div className="flex gap-1 flex-shrink-0">
                  {CHECK_STATUS.map(([v, l, c, tip]) => (
                    <button
                      key={v}
                      data-testid={`apr-chk-${sec}-${k}-${v}`}
                      title={tip}
                      onClick={() => onItem(k, { ...m, status: m.status === v ? '' : v })}
                      className="text-[10px] font-black w-9 py-1 rounded border transition-all"
                      style={{
                        color: m.status === v ? '#000' : c,
                        borderColor: m.status === v ? c : `${c}40`,
                        backgroundColor: m.status === v ? c : 'transparent',
                      }}
                    >{l}</button>
                  ))}
                </div>
              </div>
              {m.status === 'nc' && (
                <input
                  data-testid={`apr-chk-${sec}-${k}-obs`}
                  placeholder="Descreva a não conformidade / ação tomada…"
                  value={m.obs || ''}
                  onChange={(e) => onItem(k, { ...m, obs: e.target.value })}
                  className="mt-1 w-full text-xs bg-[#FF003C]/[0.06] border border-[#FF003C]/30 rounded px-2 py-1 text-white"
                />
              )}
            </div>
          );
        })}
        <input
          data-testid={`apr-chk-${sec}-obs`}
          placeholder="Observações gerais deste checklist…"
          value={data.obs || ''}
          onChange={(e) => onObs(e.target.value)}
          className="mt-2 w-full text-xs bg-zinc-950/60 border border-white/10 rounded px-2 py-1 text-white"
        />
      </div>
    </Section>
  );
};

const Field = ({ label, testid, type = 'text', value, onChange, span = 1 }) => (
  <label className={`col-span-${span === 2 ? '2' : '1'} block`}>
    <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold">{label}</span>
    <input
      data-testid={testid}
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="mt-0.5 w-full bg-zinc-950/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#E0FF00]"
    />
  </label>
);

const CheckLine = ({ testid, label, checked, onToggle }) => (
  <button data-testid={testid} onClick={onToggle} className="flex items-center gap-2 py-1 text-left group">
    <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all ${checked ? 'bg-[#E0FF00] border-[#E0FF00]' : 'border-zinc-600'}`}>
      {checked && <span className="text-black text-[10px] font-black">✓</span>}
    </span>
    <span className={`text-[11px] ${checked ? 'text-white font-bold' : 'text-zinc-400'} group-hover:text-white`}>{label}</span>
  </button>
);

const SignatureBlock = ({ role, testid, signer, onChange, onRemove, teamMembers }) => (
  <div data-testid={testid} className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
    <div className="flex items-center justify-between">
      <p className="text-[10px] tracking-[0.15em] uppercase font-bold text-[#E0FF00]">{role}</p>
      {onRemove && (
        <button data-testid={`${testid}-remove`} onClick={onRemove} className="text-[#FF003C] w-6 h-6 rounded bg-white/5 border border-white/10 flex items-center justify-center" title="Remover">
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
    <div className="grid grid-cols-3 gap-2">
      <div className="col-span-2">
        <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold">Nome</span>
        <select
          data-testid={`${testid}-name`}
          value={teamMembers.includes(signer.nome) ? signer.nome : '__manual'}
          onChange={(e) => {
            if (e.target.value === '__manual') return;
            onChange('nome', e.target.value);
          }}
          className="mt-0.5 w-full bg-zinc-950/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#E0FF00]"
        >
          <option value="">— Selecionar da equipe —</option>
          {teamMembers.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value="__manual">✎ Digitar manualmente</option>
        </select>
        {!teamMembers.includes(signer.nome) && (
          <input
            data-testid={`${testid}-name-manual`}
            placeholder="Digite o nome"
            value={signer.nome}
            onChange={(e) => onChange('nome', e.target.value)}
            className="mt-1 w-full bg-zinc-950/60 border border-white/10 rounded px-2 py-1 text-xs text-white"
          />
        )}
      </div>
      <div>
        <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold">Matrícula</span>
        <input
          data-testid={`${testid}-matricula`}
          value={signer.matricula || ''}
          onChange={(e) => onChange('matricula', e.target.value)}
          className="mt-0.5 w-full bg-zinc-950/60 border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-[#E0FF00]"
        />
      </div>
    </div>
    <div>
      <span className="text-[9px] tracking-[0.15em] uppercase text-zinc-500 font-bold flex items-center gap-1">
        <PenLine className="w-3 h-3" /> Assinatura (desenhe com o dedo)
      </span>
      <SignaturePad
        testid={`${testid}-sig`}
        value={signer.assinatura}
        onChange={(v) => onChange('assinatura', v)}
      />
    </div>
  </div>
);
