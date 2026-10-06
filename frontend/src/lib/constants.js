// Constants shared across the frontend
export const PROJECT_TYPES = [
  { value: 'anexo_iv', label: 'ANEXO IV' },
  { value: 'po', label: 'P.O' },
  { value: 'nivel_tensao', label: 'Nível de Tensão' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'particular', label: 'Particular' },
  { value: 'auditoria', label: 'AUDITORIA' },
  { value: 'judicial', label: 'JUDICIAL' },
  { value: 'diretoria', label: 'DIRETORIA' },
];

export const TIPO_SERVICO = [
  { value: '', label: '— Não definido —' },
  { value: 'extensao_rede_bt', label: 'Extensão de Rede BT' },
  { value: 'extensao_rede_mt', label: 'Extensão de Rede MT' },
  { value: 'extensao_rede_monofasica_rural', label: 'Extensão Rede Monofásica Rural' },
  { value: 'regulador', label: 'Regulador' },
  { value: 'religador', label: 'Religador' },
  { value: 'troca_trafo_mono', label: 'Troca Trafo Mono' },
  { value: 'troca_trafo_tri', label: 'Troca Trafo Tri' },
];

export const MUNICIPIOS = [
  'CUIABÁ', 'VÁRZEA GRANDE', 'SANTO ANTÔNIO DO LEVERGER', 'ROSÁRIO OESTE',
  'ACORIZAL', 'BARÃO DO MELGAÇO', 'POCONÉ', 'NOSSA SENHORA DO LIVRAMENTO', 'CHAPADA DOS GUIMARÃES',
];

export const PROJECT_TYPE_LABEL = PROJECT_TYPES.reduce((acc, t) => { acc[t.value] = t.label; return acc; }, {});
export const TIPO_SERVICO_LABEL = TIPO_SERVICO.reduce((acc, t) => { acc[t.value] = t.label; return acc; }, {});

export const EXECUTION_STATUS = [
  { value: 'aguardando_programacao', label: 'Aguardando Programação', color: '#94A3B8' },
  { value: 'programado', label: 'Programado', color: '#00F0FF' },
  { value: 'em_execucao', label: 'Em Execução', color: '#E0FF00' },
  { value: 'a_reprogramar', label: 'A Reprogramar', color: '#FF5E00' },
  { value: 'executada', label: 'Executada', color: '#39FF14' },
  { value: 'concluido', label: 'Concluído', color: '#39FF14' },
  { value: 'suspenso', label: 'Suspenso', color: '#A855F7' },
  { value: 'cancelado', label: 'Cancelado', color: '#FF003C' },
];

export const EXECUTION_STATUS_LABEL = EXECUTION_STATUS.reduce((acc, s) => { acc[s.value] = s; return acc; }, {});

export const MATERIAL_STATUS = [
  { value: 'pending', label: 'Pendente', color: '#FF003C' },
  { value: 'partial', label: 'Parcial', color: '#FF5E00' },
  { value: 'complete', label: 'Total', color: '#39FF14' },
];
export const MATERIAL_STATUS_LABEL = MATERIAL_STATUS.reduce((acc, s) => { acc[s.value] = s; return acc; }, {});

export const RESCHEDULE_REASONS = [
  { value: 'frota', label: 'Frota' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'chuva', label: 'Chuva' },
  { value: 'acesso', label: 'Acesso' },
  { value: 'almoxarifado', label: 'Almoxarifado / material' },
  { value: 'outro', label: 'Outro' },
];

export const UNAVAILABILITY_REASONS = [
  { value: 'frota', label: 'Frota' },
  { value: 'chuva', label: 'Chuva' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'acesso', label: 'Acesso' },
  { value: 'ferias', label: 'Férias' },
  { value: 'treinamento', label: 'Treinamento' },
  { value: 'manutencao_veiculo', label: 'Manutenção Veículo' },
  { value: 'outro', label: 'Outro' },
];

export const IMPRODUTIVIDADE_REASONS = [
  { value: 'chuva', label: 'Chuva / Clima ruim' },
  { value: 'falta_material', label: 'Falta de material' },
  { value: 'falta_equipe', label: 'Falta de equipe' },
  { value: 'quebra_equipamento', label: 'Quebra de equipamento/veículo' },
  { value: 'espera_desligamento', label: 'Espera por desligamento' },
  { value: 'acesso_bloqueado', label: 'Acesso bloqueado / cliente' },
  { value: 'acidente', label: 'Acidente / incidente' },
  { value: 'retrabalho', label: 'Retrabalho' },
  { value: 'outro', label: 'Outro' },
];
export const IMPRODUTIVIDADE_REASON_LABEL = IMPRODUTIVIDADE_REASONS.reduce((acc, r) => { acc[r.value] = r.label; return acc; }, {});

export const WAREHOUSE_RESPONSE_STATUS = [
  { value: 'separado', label: 'Separado (completo)', color: '#39FF14' },
  { value: 'baixado', label: 'Baixado no sistema', color: '#00F0FF' },
  { value: 'separado_parcial', label: 'Separado parcialmente', color: '#FF5E00' },
  { value: 'na_doca', label: 'Está na doca', color: '#E0FF00' },
  { value: 'faltam_materiais', label: 'Faltam materiais específicos', color: '#FF003C' },
  { value: 'devolvido', label: 'Devolvido', color: '#A855F7' },
  { value: 'aguardando_fornecedor', label: 'Aguardando fornecedor', color: '#94A3B8' },
  { value: 'outro', label: 'Outro', color: '#94A3B8' },
];
export const WAREHOUSE_RESPONSE_LABEL = WAREHOUSE_RESPONSE_STATUS.reduce((acc, s) => { acc[s.value] = s; return acc; }, {});

// Unidades de medida disponíveis para materiais (Fev/2026)
export const MATERIAL_UNITS = [
  { value: 'UN', label: 'UN' },
  { value: 'PC', label: 'PC' },
  { value: 'PÇ', label: 'PÇ' },
  { value: 'KG', label: 'KG' },
  { value: 'M',  label: 'M (metros)' },
  { value: 'M²', label: 'M²' },
  { value: 'M³', label: 'M³' },
  { value: 'L',  label: 'Litros' },
  { value: 'CX', label: 'Caixa' },
  { value: 'PAR',label: 'Par' },
  { value: 'RL', label: 'Rolo' },
];

// Status do material no almoxarifado (por item — Fev/2026)
export const ITEM_WAREHOUSE_STATUS = [
  { value: '',            label: '—',                 color: '#71717a' },
  { value: 'na_doca',     label: 'Na doca (separado)', color: '#E0FF00' },
  { value: 'baixado',     label: 'Baixado (RMA)',      color: '#00F0FF' },
  { value: 'devolvido',   label: 'Devolvido (DMA)',    color: '#A855F7' },
  { value: 'em_falta',    label: 'Em falta',           color: '#FF003C' },
  { value: 'em_transito', label: 'Em trânsito',        color: '#FF5E00' },
  { value: 'despadronizado', label: 'Despadronizado',  color: '#A3A3A3' },
  { value: 'bloqueado',   label: 'Bloqueado',          color: '#94A3B8' },
];
export const ITEM_WAREHOUSE_STATUS_LABEL = ITEM_WAREHOUSE_STATUS.reduce((acc, s) => { acc[s.value] = s; return acc; }, {});

export const PERMISSION_TABS = [
  { value: 'campo', label: 'Modo Campo' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'carteira', label: 'Carteira' },
  { value: 'programacao', label: 'Programação' },
  { value: 'calendario', label: 'Calendário' },
  { value: 'operacional', label: 'Operacional' },
  { value: 'geolocalizacao', label: 'Geolocalização' },
  { value: 'materiais', label: 'Materiais' },
  { value: 'analise', label: 'Análise / Faturamento' },
  { value: 'relatorios', label: 'Relatórios' },
  { value: 'equipes', label: 'Equipes' },
  { value: 'improdutividade', label: 'Improdutividade' },
  { value: 'avanco', label: 'Avanço Físico' },
  { value: 'orcamentos', label: 'Orçamentos' },
  { value: 'medicao', label: 'Medição M.O.' },
  { value: 'estoque', label: 'Estoque / Equipamentos' },
  { value: 'documentos', label: 'Documentos' },
  { value: 'settings', label: 'Configurações' },
  { value: 'admin', label: 'Admin' },
];

// Set/2026 · Cores operacionais (Improdutividade / Indisponibilidade): vermelho = segurança/pessoas, laranja = frota/material/acesso,
// azul = clima, verde = planejado, cinza = outros
export const OP_COLORS = { red: '#FF003C', orange: '#FF5E00', blue: '#3B82F6', green: '#39FF14', gray: '#94A3B8' };
export const IMPROD_REASON_COLOR = {
  chuva: OP_COLORS.blue, falta_material: OP_COLORS.orange, falta_equipe: OP_COLORS.red, quebra_equipamento: OP_COLORS.orange,
  espera_desligamento: OP_COLORS.orange, acesso_bloqueado: OP_COLORS.orange, acidente: OP_COLORS.red, retrabalho: OP_COLORS.gray, outro: OP_COLORS.gray,
};
export const UNAV_REASON_COLOR = {
  frota: OP_COLORS.orange, chuva: OP_COLORS.blue, temporal: OP_COLORS.blue, seguranca: OP_COLORS.red, acesso: OP_COLORS.orange,
  ferias: OP_COLORS.green, treinamento: OP_COLORS.green, manutencao_veiculo: OP_COLORS.orange, outro: OP_COLORS.gray,
};
export const OP_COLOR_LEGEND = [
  { color: OP_COLORS.red, label: 'Segurança / equipe' },
  { color: OP_COLORS.orange, label: 'Frota / material / acesso / desligamento' },
  { color: OP_COLORS.blue, label: 'Clima' },
  { color: OP_COLORS.green, label: 'Planejado (férias / treinamento)' },
  { color: OP_COLORS.gray, label: 'Outros' },
];
// Jornada comercial de 8h: R$/hora = meta diária da equipe ÷ 8 (default R$ 4.000/dia → R$ 500/h)
export const TEAM_DAILY_DEFAULT = 4000;
export const teamDayCost = (team) => Number(team?.daily_target || TEAM_DAILY_DEFAULT);
export const teamHourCost = (team) => teamDayCost(team) / 8;

export const formatCurrency = (v) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Set/2026 · linha viva por data: se a obra tem hot_line_dates, só nesses dias; legado → flag requires_hot_line
export const hotLineOn = (p, date) => ((p?.hot_line_dates || []).length ? p.hot_line_dates.includes(date) : !!p?.requires_hot_line);
export const todayISO = () => new Date().toISOString().slice(0, 10);

// Fev/2026 · Heurística "swap-on-read" para materiais legados importados com o
// parser bugado (que gravava o CÓDIGO no campo `item` e deixava `code` vazio).
// Aplica na renderização quando: code está vazio E o texto do item parece um
// código (sem espaços, curto, alfanumérico). Retorna sempre { code, description }.
const _CODE_LIKE_RE = /^[A-Za-z0-9][A-Za-z0-9\-_./]{0,29}$/;
export const looksLikeMaterialCode = (text) => {
  if (!text) return false;
  const s = String(text).trim();
  return _CODE_LIKE_RE.test(s) && !/\s/.test(s);
};
export const resolveMaterialCodeAndDesc = (m) => {
  const code = String(m?.code || m?.codigo || m?.code_material || '').trim();
  const desc = String(m?.description || m?.descricao || m?.item || m?.name || m?.material_name || '').trim();
  if (!code && looksLikeMaterialCode(desc)) {
    // Legado: item guardava o código. Swap na renderização.
    return { code: desc, description: '' };
  }
  return { code, description: desc };
};
