import React from 'react';
import { Field, inputCls, labelCls } from './orcamentoShared';

const CLIENT_FIELDS = [
  ['name', 'Cliente / Solicitante', 'text', 'sm:col-span-2'],
  ['contact', 'Contato', 'text'],
  ['phone', 'Telefone / WhatsApp', 'text'],
  ['email', 'E-mail', 'email'],
  ['document', 'CPF / CNPJ', 'text'],
  ['address', 'Endereço', 'text', 'sm:col-span-2'],
  ['city', 'Cidade / UF', 'text'],
];

export const OrcamentoClientTab = ({ form, set, setClient }) => {
  const scopeText = (form.scope_items || []).join('\n');
  const scopeCount = (form.scope_items || []).filter((s) => s.trim()).length;
  return (
    <div className="space-y-5" data-testid="orc-tab-cliente">
      <div>
        <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Cliente</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {CLIENT_FIELDS.map(([k, l, t, cls]) => (
            <Field key={k} label={l} testid={`orc-client-${k}`} type={t} value={form.client[k] || ''} onChange={(e) => setClient(k, e.target.value)} className={cls || ''} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500 mb-2">Objeto & local</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Objeto da proposta (descrição do serviço)" testid="orc-objeto" textarea value={form.objeto} onChange={(e) => set('objeto', e.target.value)} className="sm:col-span-3" placeholder="Ex.: Substituição de poste e estruturas de média tensão no Posto de Combustíveis…" />
          <Field label="Local do projeto" testid="orc-location" value={form.location} onChange={(e) => set('location', e.target.value)} className="sm:col-span-1" placeholder="Cuiabá/MT" />
          <Field label="Data base" testid="orc-base-date" type="date" value={form.base_date || ''} onChange={(e) => set('base_date', e.target.value)} />
          <Field label="Validade (dias)" testid="orc-validity-days" type="number" min="1" value={form.validity_days} onChange={(e) => set('validity_days', e.target.value)} />
          <Field label="Observações internas (não saem no PDF)" testid="orc-notes" textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="sm:col-span-3" />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-zinc-500">Escopo do fornecimento</p>
          <span data-testid="orc-scope-count" className="text-[10px] font-bold text-[#00F0FF]">{scopeCount} item(ns)</span>
        </div>
        <label className={labelCls}>Um item por linha — sai numerado no PDF</label>
        <textarea
          data-testid="orc-scope-text"
          className={`${inputCls} min-h-[160px] font-mono text-[12px] leading-5 resize-y`}
          value={scopeText}
          onChange={(e) => set('scope_items', e.target.value.split('\n'))}
          placeholder={'LEVANTAMENTO IN LOCO\nPLANEJAMENTO DE EXECUÇÃO\nDISPONIBILIZAÇÃO DE EQUIPE ESPECIALIZADA LINHA VIVA\nINSTALAÇÃO DE POSTE…'}
        />
        {scopeCount > 0 && (
          <ol data-testid="orc-scope-preview" className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 text-[11px] text-zinc-400 list-decimal pl-5">
            {form.scope_items.filter((s) => s.trim()).map((s, i) => <li key={i} className="truncate">{s}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
};
