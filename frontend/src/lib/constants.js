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
  { value: 'admin', label: 'Admin' },
];

export const formatCurrency = (v) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const todayISO = () => new Date().toISOString().slice(0, 10);
