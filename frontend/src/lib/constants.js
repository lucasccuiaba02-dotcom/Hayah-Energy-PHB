// Constants shared across the frontend
export const PROJECT_TYPES = [
  { value: 'anexo_iv', label: 'ANEXO IV' },
  { value: 'po', label: 'P.O' },
  { value: 'nivel_tensao', label: 'Nível de Tensão' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'particular', label: 'Particular' },
  { value: 'extensao_rede_bt', label: 'Extensão de Rede BT' },
  { value: 'extensao_rede_mt', label: 'Extensão de Rede MT' },
  { value: 'extensao_rede_monofasica_rural', label: 'Extensão Rede Monofásica Rural' },
  { value: 'regulador', label: 'Regulador' },
  { value: 'religador', label: 'Religador' },
  { value: 'troca_trafo_mono', label: 'Troca Trafo Mono' },
  { value: 'troca_trafo_tri', label: 'Troca Trafo Tri' },
];

export const PROJECT_TYPE_LABEL = PROJECT_TYPES.reduce((acc, t) => {
  acc[t.value] = t.label;
  return acc;
}, {});

export const EXECUTION_STATUS = [
  { value: 'aguardando_inicio', label: 'Aguardando Início', color: '#94A3B8' },
  { value: 'programado', label: 'Programado', color: '#00F0FF' },
  { value: 'em_execucao', label: 'Em Execução', color: '#E0FF00' },
  { value: 'concluido', label: 'Concluído', color: '#39FF14' },
  { value: 'cancelado', label: 'Cancelado', color: '#FF003C' },
];

export const EXECUTION_STATUS_LABEL = EXECUTION_STATUS.reduce((acc, s) => {
  acc[s.value] = s;
  return acc;
}, {});

export const MATERIAL_STATUS = [
  { value: 'pending', label: 'Pendente', color: '#FF003C' },
  { value: 'partial', label: 'Parcial', color: '#FF5E00' },
  { value: 'complete', label: 'Total', color: '#39FF14' },
];

export const MATERIAL_STATUS_LABEL = MATERIAL_STATUS.reduce((acc, s) => {
  acc[s.value] = s;
  return acc;
}, {});

export const formatCurrency = (v) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
