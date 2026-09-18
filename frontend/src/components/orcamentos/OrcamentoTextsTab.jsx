import React from 'react';
import { Field } from './orcamentoShared';

const TEXTS = [
  ['intro_text', 'Texto de apresentação (página 2)'],
  ['labor_notes', 'Nota abaixo do valor de Mão de Obra'],
  ['material_notes', 'Nota de Materiais'],
  ['payment_terms', 'Condições de pagamento (uma por linha)'],
  ['validity_text', 'Validade da proposta'],
  ['mobilization_text', 'Prazo de mobilização'],
  ['delivery_text', 'Prazo de entrega / início'],
  ['taxes_text', 'Impostos'],
];

const Toggle = ({ testid, checked, onChange, label, hint }) => (
  <label className="flex items-start gap-2 text-[12px] text-zinc-300 cursor-pointer select-none glass-panel rounded-xl p-3 border border-white/10">
    <input data-testid={testid} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#E0FF00]" />
    <span><b className="text-white">{label}</b><br /><span className="text-[10px] text-zinc-500">{hint}</span></span>
  </label>
);

export const OrcamentoTextsTab = ({ form, set }) => (
  <div className="space-y-5" data-testid="orc-tab-textos">
    <div>
      <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Proposta comercial · o que o cliente vê</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Toggle testid="orc-include-labor-table" checked={form.include_labor_table} onChange={(v) => set('include_labor_table', v)} label="Detalhar composição da mão de obra" hint="Desligado = só o valor total (como na proposta modelo)" />
        <Toggle testid="orc-include-material-table" checked={form.include_material_table} onChange={(v) => set('include_material_table', v)} label="Detalhar lista de materiais com preços" hint="Desligado = só o valor total dos materiais" />
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {TEXTS.map(([k, l]) => (
        <Field key={k} label={l} testid={`orc-text-${k}`} textarea value={form[k] || ''} onChange={(e) => set(k, e.target.value)} className={k === 'intro_text' || k === 'labor_notes' ? 'sm:col-span-2' : ''} />
      ))}
    </div>
    <div>
      <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Relatório de conclusão</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Executado por" testid="orc-executed-by" value={form.executed_by || ''} onChange={(e) => set('executed_by', e.target.value)} placeholder="Equipe / responsável" />
        <Field label="Início da execução" testid="orc-started-at" type="date" value={form.started_at || ''} onChange={(e) => set('started_at', e.target.value)} />
        <Field label="Término" testid="orc-finished-at" type="date" value={form.finished_at || ''} onChange={(e) => set('finished_at', e.target.value)} />
        <Field label="Observações da execução (saem no relatório)" testid="orc-completion-notes" textarea value={form.completion_notes || ''} onChange={(e) => set('completion_notes', e.target.value)} placeholder="Serviços executados conforme escopo, pendências, recomendações…" className="sm:col-span-3" />
      </div>
    </div>
  </div>
);
