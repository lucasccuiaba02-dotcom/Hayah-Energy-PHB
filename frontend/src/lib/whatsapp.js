const digits = (p) => String(p || '').replace(/\D/g, '');

export const WAREHOUSE_PHONE_KEY = 'hayah_warehouse_phone';

export function openWhatsApp(text, phone = '') {
  const num = digits(phone);
  const clean = String(text || '').replace(/\uFE0F/g, '');
  const url = num ? `https://wa.me/${num}?text=${encodeURIComponent(clean)}` : `https://wa.me/?text=${encodeURIComponent(clean)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const brl = (v) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const brDate = (iso) => (iso && iso.length >= 10 ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const appUrl = () => window.location.origin;

export function vencidasText(items) {
  const total = items.reduce((s, p) => s + (p.programmed_value || 0), 0);
  const lines = [`*HAYAH ENERGY · ⚠️ ${items.length} obra(s) vencida(s)*`, ''];
  items.slice(0, 15).forEach((p) => lines.push(`• *${p.project_code || '—'}* ${(p.name || '').slice(0, 40)} — venceu ${brDate(p.expiry_date)}${p.dias_vencida ? ` (há ${p.dias_vencida}d)` : ''} · ${brl(p.programmed_value)}`));
  if (items.length > 15) lines.push(`… e mais ${items.length - 15} obra(s)`);
  lines.push('', `Total: *${brl(total)}*`, '', `Abrir: ${appUrl()}/carteira?filter=vencidas`);
  return lines.join('\n');
}

export function backlogText(items, stageLabel, threshold = 15) {
  const total = items.reduce((s, p) => s + (p.actual_value || p.programmed_value || 0), 0);
  const lines = [`*HAYAH ENERGY · 💰 Faturamento preso — ${items.length} obra(s)*`, `_Paradas há mais de ${threshold} dias no mesmo estágio_`, ''];
  items.slice(0, 15).forEach((p) => lines.push(`• *${p.project_code || '—'}* ${(p.name || '').slice(0, 40)} — ${stageLabel(p.billing_stage)} há ${p.days_in_stage}d · ${brl(p.actual_value || p.programmed_value)}`));
  if (items.length > 15) lines.push(`… e mais ${items.length - 15} obra(s)`);
  lines.push('', `Total: *${brl(total)}*`, '', `Abrir: ${appUrl()}/faturamento?view=backlog`);
  return lines.join('\n');
}

export function lowStockText(items) {
  const lines = [`*HAYAH ENERGY · 📦 Estoque baixo — ${items.length} item(ns)*`, ''];
  items.slice(0, 20).forEach((i) => lines.push(`🔴 *${i.code}* ${(i.description || '').slice(0, 40)} — ${i.qty_physical} ${i.unit} (mín. ${i.min_stock})`));
  if (items.length > 20) lines.push(`… e mais ${items.length - 20} item(ns)`);
  lines.push('', `Abrir: ${appUrl()}/estoque?low=1`);
  return lines.join('\n');
}

export function orcamentoText(o, totals) {
  const c = o.client || {};
  const lines = [`*HAYAH ENERGY · Proposta Comercial Nº ${o.code}*`, ''];
  if (c.name) lines.push(`*Cliente:* ${c.name}${c.city ? ` – ${c.city}` : ''}`);
  if (o.objeto) lines.push(`*Objeto:* ${o.objeto}`);
  if (o.location) lines.push(`*Local:* ${o.location}`);
  lines.push('', `Mão de obra: ${brl(totals.labor_total)}`, `Materiais: ${brl(totals.material_total)}`, `*Total da obra: ${brl(totals.grand_total)}*`);
  if (o.payment_terms) lines.push('', `*Pagamento:* ${String(o.payment_terms).split('\n').filter(Boolean).join(' · ')}`);
  lines.push(`Validade: ${o.validity_days || 30} dias a partir de ${brDate(o.base_date)}`, '', 'A proposta completa em PDF segue em anexo/e-mail.');
  return lines.join('\n');
}
