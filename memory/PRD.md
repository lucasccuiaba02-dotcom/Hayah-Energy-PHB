# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx + openpyxl + resend 2.34
- Integrações: **Resend (email — ATIVO)**, Web Push VAPID, OSRM público, Photon (geocoding), Emergent Object Storage, Emergent LLM key
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos (abas no sidebar)
Dashboard, **Buscar Obras**, Operacional, Carteira, Programação, Calendário, **Faturamento**, Geolocalização, Materiais, Análise, Relatórios, Equipes, Indisponibilidade, Admin

## Regras chave
- `project_code` único (409)
- Duplicar obra limpa código/programação/histórico/fotos, sufixa " (cópia)"
- **Permissões open-by-default**: se `permissions=[]` → libera TODAS as abas
- **`schedule_entries`**: multi-data + multi-equipe por obra
- Status `cancelado` ou `suspenso` exige `cancel_reason`
- **Auto-transição**: `execution_status=concluido` sem `billing_stage` → `recebimento_tecnico`
- **Radar de Backlog**: obras não-pagas há > 15 dias no mesmo estágio são flagged `is_stuck`

## Endpoints principais
- Auth: POST /api/auth/{register,login}, GET /api/auth/me
- Projects: CRUD /api/projects
- Dashboard: GET /api/dashboard/kpis
- **Faturamento**: GET /api/faturamento/pipeline (retorna pipeline/stages/totals/backlog_value/paid_value/**lead_times**/**lead_buckets**/**stuck_projects**/**stuck_threshold_days**), PUT /api/projects/{id}/billing-stage
- Materiais: POST /api/projects/{id}/materials-import (smart parser template Satelite)
- Emails/Push: mantidos

## Feito em Fev/2026 (últimas iterações)
- Multi-data via `schedule_entries` + calendário mostra várias equipes/dia
- Matriz Programação com datas nas COLUNAS, equipes nas LINHAS
- Buscar Obras + Retorno de Programação + Indisponibilidade
- Geolocalização com FitBounds, WhatsApp, drop-pin UTM
- **Almoxarifado** com header + tabela editável (solicitado/separado/baixado/entregue) + PDF de Requisição (reportlab + QR) + histórico + confirmação de recebimento com camera capture
- **Faturamento (esteira)** — 8 estágios com KPIs, filtro por período, kanban horizontal, modal NF, auto-transição de obra concluída
- **Push Notifications** com `PushBlockedHelpModal` — instruções por navegador quando bloqueado
- **Smart Material Parser** para template `Satelite-atualxxMODELO.xlsx`:
  * Varre TODAS as abas (18 no template real)
  * Prioriza sheets com nome contendo "req"/"material"/"solicit" (score 1000) sobre DIÁRIO DE OBRA (50)
  * Detecta header em qualquer linha (headers "QNTD ORÇADA" na linha 15 do Satelite real)
  * Prefere colunas "QNTD ORÇADA/SOLICITADA" sobre "SEPARADA/USADA/DEVOLVIDA"
  * Filtra rows TOTAL/SUBTOTAL/#N/A/#REF/#VALUE
  * Testes: `/app/backend/tests/test_materials_smart_parser.py` (3 fake), `test_satelite_real_file.py` (2 com arquivo real fixture)
- **Lead Time Indicators** no `/api/faturamento/pipeline`:
  * `lead_times`: dict `stage_A→stage_B` → `{avg_days, samples}` calculado varrendo `billing_history`
  * `lead_buckets`: 4 buckets agregados (Recebimento→Fechamento, Fechamento→Fiscalização, Fiscalização→Aprovada, Aprovada→Pago)
  * UI: 4 LeadCards abaixo do filtro de período
- **Radar de Backlog** (obras paradas):
  * `stuck_projects[]` com id, project_code, name, billing_stage, days_in_stage, programmed_value
  * `stuck_threshold_days`: 15 (não incluí `pago` na verificação)
  * Cada card do kanban recebe `days_in_stage` + `is_stuck` — badge vermelho "Xd parado" quando aplicável
  * Seção "Radar de Backlog" abaixo do kanban lista obras paradas com valor total, ordenadas por dias parados (mais crítico primeiro), clique abre o modal de detalhe
- **Resend ATIVO** (Fev/2026):
  * `RESEND_API_KEY` configurada no `.env`
  * Sender: `Hayah Energy <onboarding@resend.dev>` (modo teste — só entrega para emails verificados na conta Resend, ou `delivered@resend.dev`)
  * **Próxima etapa**: verificar domínio próprio (ex.: `grupoatualmt.com.br`) em https://resend.com/domains para entregar aos destinatários reais em `NOTIFICATION_EMAILS`/`WAREHOUSE_EMAIL`
  * Endpoints já usam `send_email_via_resend()` em: material requests, requisition resend, anexo IV D-2, checklist alerts, tomorrow schedule

## Backlog (P1/P2)
- Verificação de domínio Resend (deixar de usar `onboarding@resend.dev`)
- Cloudflare 520 em GET /api/projects — investigar payload/pagination
- Split de server.py em routers (3229 linhas)
- Fotos em GridFS; Cache OSRM; TSP 2-opt
- WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
