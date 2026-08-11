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
- **Resend DESATIVADO** (Fev/2026 — a pedido do usuário até verificação do domínio):
  * `RESEND_API_KEY=""` (vazio) no `.env` — envio real desligado
  * Sender configurado: `Hayah Energy <noreply@hayahenergy.com.br>` (pronto para reativar quando o domínio for verificado)
  * Comportamento: PDF gerado + histórico com `email_status=skipped_no_key`, sem envio
  * Para reativar: preencher RESEND_API_KEY após verificar domínio em https://resend.com/domains
  * Endpoints que dependem: material requests, requisition resend, anexo IV D-2, checklist alerts, tomorrow schedule (todos retornam skipped)
- **Prévia PDF de Requisição** (Fev/2026):
  * `POST /api/materials/preview` — gera o PDF via `build_requisition_pdf()` e devolve `application/pdf` inline SEM criar histórico nem enviar email
  * Botão ciano "Prévia PDF" (data-testid=preview-material-request) ao lado de "Enviar Almoxarifado"
  * Modal (data-testid=material-preview-modal) com iframe embutido (data-testid=material-preview-iframe) + botões "Baixar" e "Enviar para o Almoxarifado" (fecha o modal e chama handleSend)
  * Testes: `/app/backend/tests/test_materials_preview.py` (2/2 verdes)

## Onda 3-A (Fev/2026) — melhorias solicitadas pelo gerente
- **Scrollbar horizontal visível no Faturamento** (`.hayah-hscroll` em App.css) — barra amarela grossa (12px) na esteira, facilita rolagem com mouse
- **Números KPI enormes na Faturamento** — KpiCard agora com `text-4xl font-black` colorido no valor. Colunas do kanban mostram total em `text-lg font-bold` colorido
- **Sidebar rolável verticalmente** (`.hayah-sidebar-scroll` classe custom) — quando há muitos ícones, rola sem cortar
- **Texto preto legível em light mode** — inversões usam `#0a0a0a` com `font-weight: 700/900` para números e headings, garantindo contraste
- **Botão "Baixar Modelo" no header do Almoxarifado** — sempre visível (não depende de obra selecionada). Botão "Exportar lista" aparece na tabela quando há materiais
- **Modelo Excel padrão** (`GET /api/materials/template`) — 6 colunas COD ITEM · DESCRIÇÃO ITEM · QTD · UNIDADE · PREÇO · VLR TOTAL + linha de exemplo em cinza. Cabeçalho amarelo, bordas, larguras ajustadas
- **Exportar lista atual da obra** (`GET /api/projects/{id}/materials/export`) — mesmo layout, populado com os materiais atuais + linha TOTAL GERAL no rodapé
- **Parser aceita "VLR TOTAL"**: se planilha já traz o total, respeita; senão calcula `preço × qtd`. Novos keywords: "cod item", "descricao item", "vlr total"

## Onda 2 (Fev/2026) — enums e novas coleções
- **Almoxarifado resposta**: novo `POST /api/projects/{id}/materials/{req_id}/response` com status enum (`separado`, `baixado`, `separado_parcial`, `na_doca`, `faltam_materiais`, `devolvido`, `aguardando_fornecedor`, `outro`) + responsible + notes + missing_items. UI mostra chip colorido (data-testid=req-warehouse-chip-{id}) no header do `RequisitionRow` e formulário completo dentro do expand com select + responsável + textareas (data-testid=req-warehouse-status/responsible/missing/notes/save).
- **Desligamento por data específica**: novo campo `shutdown_dates: List[str]` em ProjectCreate/Update/Response. Checkbox por data no ProjectDrawer (data-testid=schedule-entry-shutdown-{idx}). CalendarioPage só mostra ⚠️ nos dias que estão no `shutdown_dates` (data-testid=cal-shutdown-{team}-{date}-{id}). Backwards compatible: se `shutdown_dates` estiver vazio, mantém legado `shutdown_info` como flag geral.
- **Improdutividade**: nova coleção `team_unproductivity` + 3 endpoints (GET/POST/DELETE /api/team-unproductivity). Motivos (`chuva`, `falta_material`, `falta_equipe`, `quebra_equipamento`, `espera_desligamento`, `acesso_bloqueado`, `acidente`, `retrabalho`, `outro`), com hours_lost e notes. Nova página `/improdutividade` no sidebar (ícone TrendingDown) e novo perm-tab.

## Backlog (P1/P2)
- **Onda 2 (próximo)**: campo de resposta almoxarifado (status separado/baixado/parcial/na_doca/faltam_materiais + responsável) · marcar dia específico como "com desligamento" em obra multi-data · nova aba Improdutividade com motivos padrão
- **Onda 3 (próximo)**: fotos por ponto P1/P2/P3 + dossiê melhorado · pastas por obra (Fotos/Materiais/Projeto) · 4 relatórios novos (Equipe/Indisponibilidade/Improdutividade/Retorno)
- Cloudflare 520 em GET /api/projects — investigar payload/pagination
- Split de server.py em routers (3260 linhas)
- Fotos em GridFS; Cache OSRM; TSP 2-opt
- WhatsApp Business API oficial

## Onda 1 (Fev/2026) — melhorias rápidas
- **Tema Dark/Light**: `/contexts/ThemeContext.jsx` + `data-theme` no `<html>` + persistência em localStorage + detecção de preferência do sistema. Botão sol/lua no header (data-testid=theme-toggle). CSS override em `App.css` inverte fundos, textos e bordas em [data-theme="light"], mantém CTAs coloridos.
- **KPI % No Prazo** (Dashboard): novo card ciano `data-testid=kpi-on-time-pct` calculando `round(no_prazo/(no_prazo+vencidas)*100)`. Row de KPIs virou grid 5 colunas.
- **Filtro data no Calendário**: input `data-testid=cal-jump-date` no header — usuário pula direto pra qualquer data.
- **Filtro data na Carteira**: par de inputs `data-testid=carteira-start-date` / `carteira-end-date` filtra por `p.start_date`. Botão × pra limpar.
- **Filtro tipo obra no Top 10** (Análise): select `data-testid=top-type-filter` acima da lista.
- **Botão Retorno Programação**: repositionado para ficar destacado + badge `data-testid=pending-returns-badge` com contagem vermelha quando há retornos pendentes (usa `/api/programacao/pending-returns`).

## Credenciais
Ver `/app/memory/test_credentials.md`.
