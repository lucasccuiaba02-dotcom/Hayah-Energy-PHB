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
  { value: 'bloqueado',   label: 'Bloqueado',          color: '#94A3B8' },
];
export const ITEM_WAREHOUSE_STATUS_LABEL = ITEM_WAREHOUSE_STATUS.reduce((acc, s) => { acc[s.value] = s; return acc; }, {});

export const PERMISSION_TABS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'carteira', label: 'Carteira' },
  { value: 'programacao', label: 'Programação' },
  { value: 'calendario', label: 'Calendário' },
  { value: 'operacional', label: 'Operacional' },
  { value: 'geolocalizacao', label: 'Geolocalização' },
  { value: 'materiais', label: 'Materiais' },
  { value: 'analise', label: 'Análise' },
  { value: 'relatorios', label: 'Relatórios' },
  { value: 'equipes', label: 'Equipes' },
  { value: 'improdutividade', label: 'Improdutividade' },
  { value: 'admin', label: 'Admin' },
];

export const formatCurrency = (v) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const todayISO = () => new Date().toISOString().slice(0, 10);
