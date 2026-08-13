# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx + openpyxl + resend 2.34
- Integrações: **Resend (email — ATIVO)**, Web Push VAPID, OSRM público, Photon (geocoding), Emergent Object Storage, Emergent LLM key
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos (abas no sidebar)
Dashboard, **Buscar Obras**, Operacional, Carteira, Programação, Calendário, **Faturamento**, Geolocalização, Materiais, **Estoque**, Análise, Relatórios, Equipes, Improdutividade, Indisponibilidade, Admin

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

## Novidades Fev/2026 (Ondas)

- **Workspace Compartilhado / Multi-tenant (iter21)** — 🏢 fix crítico: usuários novos aprovados por um admin herdam o workspace do admin (`owner_id = admin.actor_id`) e vêem exatamente os mesmos projetos, equipes, estoque, etc, com filtro por permissões. Admins mantêm workspace próprio (owner_id = null). Solução transparente: `get_current_user` reescreve `current_user["_id"]` para `owner_id` (fallback = próprio _id) e expõe `actor_id` para checagens de identidade (usado em admin_delete_user). Backfill idempotente aplicado no seed: todos os usuários `role=user` sem owner_id ficam apontando para o `ADMIN_EMAIL` primário. Validado end-to-end via curl (usuário novo → aprovado por lucasc → vê os 4 projetos do lucasc com permissões limitadas).

- **Segurança & Sessões (iter20)** — 🚨 revogação global aplicada AGORA no owner (lucasc.cuiaba02@gmail.com sv=2). Recursos:
  - JWT com `sv` (session_version) embutido; `get_current_user` rejeita 401 quando `token.sv < user.session_version`.
  - `POST /api/auth/change-password` (body: current+new_password) — valida senha atual, exige 8+ chars, bumpa sv, re-emite token novo para o dispositivo atual (via httpOnly cookie).
  - `POST /api/auth/logout-all-devices` — bumpa sv, invalida tudo em outros aparelhos, retorna access_token novo pro dispositivo atual.
  - `POST /api/admin/users/{id}/force-logout` — admin desconecta outro usuário.
  - `POST /api/admin/users/{id}/reset-password` — admin define senha temporária + revoga sessões antigas.
  - **Frontend**: página `/configuracoes` (nav-configuracoes) com formulário Trocar senha (força visual) + botão Desconectar outros dispositivos. AdminUsuariosPage ganhou botões `admin-force-logout-{id}` e `admin-reset-pass-{id}`.
  - **Seed**: `.env` ADMIN_EMAIL/PASSWORD atualizados para o owner real. Sandbox admin `admin@projectmatrix.com`/`Admin@123` mantido para o testing agent via seed adicional.
  - Migração idempotente: `session_version` backfilled para 0 em todos os usuários existentes.
  - Permission `settings` adicionada a ALL_PERMISSIONS.

- **Aviso de Backlog Faturamento (iter17)**: endpoints `/api/faturamento/backlog-alerts` (GET) e `/notify` (POST), cron 09:15 broadcast push com `requireInteraction`, beep two-tone WebAudio + `showNotification` local no FaturamentoPage, toggle `Volume2/VolumeX` persistido em `localStorage.hayah_backlog_sound`.
- **Página de Arquivos consolidada (Google Drive style) (iter17)**: ProjectDetailPage com 2 abas (`pd-tab-operacional`, `pd-tab-arquivos`), a segunda com Documentos + Materiais + Fotos-por-Ponto. Upload de foto envia `point` e auto-incrementa (P1→P2).
- **Onda 1 (iter18)** — 7 ajustes rápidos (PDF Requisição 7 colunas com Código+Descrição+Un; busca por obra em /materiais; unidade dropdown; scroll horizontal Faturamento; scroll vertical Sidebar; status almoxarifado por item; headers CSV EN/PT).
- **Onda 2 — Módulo ESTOQUE (iter19)** — nova aba `/estoque` com:
  1. **8 endpoints** `/api/estoque{,/kpis,/families,/import,/export,/{id}}` (CRUD + import xlsx/csv + export csv)
  2. **Cálculos automáticos** por item: `net = qty_physical - qty_system`, `accuracy = 1 - |net|/max(qty_system,qty_physical,1)`, `value_physical/system/diff`, `is_low_stock`, `is_divergent`
  3. **KPIs globais**: Valor Físico Total, Valor Sistêmico Total, Acuracidade média, Itens em Alerta (low_stock), Divergentes, contagem de famílias/grupos
  4. **Import xlsx/csv sistêmico**: auto-detecta cabeçalho contendo COD/DESCRIÇÃO/UNID em qualquer linha das primeiras 15 (via helper `_pick_col`); modos `merge` (default) e `replace_system_only` (zera qty_system dos itens ausentes). Bug fix (iter19): removido `'material'` das keywords de descrição para não colidir com `SITUAÇÃO MATERIAL` do template Satélite.
  5. **Frontend `EstoquePage.jsx`**: KPI cards + toolbar (busca, filtros família/grupo, chips estoque baixo/divergentes, agrupar por), tabela editável (edições inline em qty_system/qty_physical/unit_value com defaultValue+onBlur), modais Edit e Import.
  6. **Permissão `estoque`** adicionada a `ALL_PERMISSIONS`.
  Testado por testing_agent v3 (iteration 19) — 12/12 pytest verde após o fix do `_pick_col`.
  1. **PDF Requisição** 7 colunas: Código · Descrição · Un · Solicitado · Separado · Baixado · Entregue. `material_requisition_pdf.py` usa Paragraph para wrap; widths [22,55,12,22,20,20,22]mm.
  2. **Aba Materiais - busca por obra**: input `material-project-search` filtra dropdown por `project_code` OU `name` (case-insensitive), badge `material-search-count` mostra matches/total.
  3. **Unidade de medida editável**: dropdown `mat-unit-{id}` com 11 opções (UN/PC/PÇ/KG/M/M²/M³/L/CX/PAR/RL) - PATCH persiste imediato.
  4. **Faturamento scroll horizontal**: botões `fat-scroll-left/right` visíveis no desktop, scrollBy 560px smooth, `pipelineRef` + `refreshScrollState` deferido 50/300ms. Fix: `<main>` recebeu `min-w-0 overflow-hidden` para constrair overflow real.
  5. **Sidebar scroll vertical**: botões `sidebar-scroll-up/down` no AppLayout com `navRef`, disabled quando no topo/base.
  6. **Warehouse status por item**: dropdown colorido `mat-warehouse-status-{id}` com 7 opções ({} + na_doca / baixado / devolvido / em_falta / em_transito / bloqueado). Backend PATCH aceita `unit, warehouse_status, code, item, notes` (string) e `qty_*` (numérico).
  7. **CSV headers em inglês**: HEADER_KEYWORDS agora aceita `code/cod/quantity/qty/unit/cost/price/description/total` além dos PT-BR.
  Testado por testing_agent v3 (iteration 18) — 7/7 pytest OK, E2E OK. Bug fetchHistory → reloadProjects corrigido pelo testing agent.
- Matriz Programação com datas nas COLUNAS, equipes nas LINHAS
- Buscar Obras + Retorno de Programação + Indisponibilidade
- Geolocalização com FitBounds, WhatsApp, drop-pin UTM
- **Almoxarifado** com header + tabela editável (solicitado/separado/baixado/entregue) + PDF de Requisição (reportlab + QR) + histórico + confirmação de recebimento com camera capture
- **Faturamento (esteira)** — 8 estágios com KPIs, filtro por período, kanban horizontal, modal NF, auto-transição de obra concluída
- **Push Notifications** com `PushBlockedHelpModal` — instruções por navegador quando bloqueado
- **Smart Material Parser** para template `Satelite-atualxxMODELO.xlsx`:
- **[11/Fev/2026] Aviso de Backlog Faturamento**: `_scan_stuck_billing_projects` + endpoint GET `/api/faturamento/backlog-alerts` (auth) e POST `/api/faturamento/backlog-alerts/notify` (trigger manual). Novo cron job diário `backlog_daily_check_job` às 09:15 (America/Cuiaba) que dispara `broadcast_push` com tag `backlog-radar` + `requireInteraction: true`. Frontend: FaturamentoPage toca beep two-tone (WebAudio 880Hz→660Hz) + `showNotification` local quando a contagem de `stuck_projects` muda. Botão toggle Volume2/VolumeX (`fat-backlog-sound-toggle`) persiste em `localStorage.hayah_backlog_sound`. Ping animado + badge vermelho no cabeçalho do Radar. Testado por testing_agent v3 (iteration 17) — 4/4 pytest OK, E2E OK.
- **[11/Fev/2026] Página de Arquivos consolidada (Google Drive style)** em ProjectDetailPage: 2 abas `pd-tab-operacional` (checklist + fotos + diário) e `pd-tab-arquivos` (view unificada com 3 blocos):
    - **Documentos** (`pd-arquivos-docs`) — upload PDF/imagem (`pd-attachment-upload`), lista com abrir/remover
    - **Materiais** (`pd-arquivos-materiais`) — tabela item/qtd/un/total
    - **Fotos por Ponto** (`pd-arquivos-fotos`) — agrupadas por P1/P2/P3... com preview + click-to-open
   Também: upload de foto agora envia `point` e auto-incrementa (P1→P2). Testado por testing_agent v3 (iteration 17).
- **[11/Fev/2026] Fix**: JSX syntax error em `ProjectDetailPage.jsx` (resíduo malformado deixado por edit anterior) removido.
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

## Onda 3-B (Fev/2026) — dossiê fotográfico + 4 relatórios + pastas de arquivos
- **Fotos por ponto (P1/P2/P3...)**: novo campo `point` no upload de fotos. Input `data-testid=pd-photo-point` com auto-incremento (P1 → P2 → P3 após cada envio). Badge amarelo no card da foto (data-testid=pd-photo-point-{id}). Ordenação natural P1, P2, ...,P10, P11 no PDF do dossiê.
- **Diário de Obra melhorado** (`daily_log_pdf.py`): fotos agora ordenadas por ponto no PDF, com legenda `<b>P1</b> · ANTES · 2026-02-10 09:15`. Header do dossiê explicativo.
- **4 novos relatórios CSV** (com BOM UTF-8 para Excel):
  * `GET /api/reports/teams` — produção por equipe (obras, concluídas, vencidas, valores, % pago)
  * `GET /api/reports/unavailability` — indisponibilidade (data, equipe, motivo, obs)
  * `GET /api/reports/unproductivity` — improdutividade (data, equipe, motivo, horas perdidas) + linha TOTAL
  * `GET /api/reports/returns` — retorno da programação (executada/a_reprogramar/programada + motivo)
  * Todos aceitam `?start=YYYY-MM-DD&end=YYYY-MM-DD`
- **4 cards novos na aba Relatórios** (data-testid=report-card-teams / -unavailability / -unproductivity / -returns) com botão CSV colorido. Seção separada "Relatórios Operacionais (CSV)" acima da notificação de amanhã.

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
