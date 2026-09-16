# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx + openpyxl + resend 2.34
- Integrações: **Resend (email — ATIVO)**, Web Push VAPID, OSRM público, Photon (geocoding), Emergent Object Storage, Emergent LLM key
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos (abas no sidebar)
Dashboard, **Buscar Obras**, Operacional, Carteira, Programação, Calendário, **Faturamento**, **Avanço Físico**, Geolocalização, Materiais, **Estoque**, Análise, Relatórios, Equipes, Improdutividade, Indisponibilidade, Admin

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
- **[16/Set/2026] Almoxarifado responsivo (celular 390px)** — `SolicitacaoMaterialPage`: título/ícone em uma linha (`min-w-0`), "Baixar Modelo" do topo oculto em telas pequenas (existe na seção de materiais), ações em `grid grid-cols-2` no mobile (`materials-actions`; Enviar ocupa 2 colunas; ícones ocultos <sm nos 2 botões menores), busca + select empilhados (`flex-col sm:flex-row`, sem `min-w-[180/220px]`), grid do formulário `grid-cols-1 md:grid-cols-3` com `min-w-0`, ações da lista de materiais em grid 2 colunas no mobile, tabela mantém rolagem interna (`materials-table-scroll` + dica "arraste para o lado" só no mobile), modais (devolução/avulso) com grids `sm:` e tabela da devolução com `overflow-x-auto`, tabela de itens da parcial no histórico com `overflow-x-auto`. Verificado via screenshot: `scrollWidth === 390`, sem elementos fora da viewport além do scroller interno da tabela; desktop inalterado.
- **[16/Set/2026] Devolução de sobras + Baixa por remessa (iter30 · 13/13 backend + frontend OK)**
  - **Devolução**: `POST /api/projects/{id}/materials/returns` `{date, returned_by, reason, notes, items:[{material_id, qty}]}` → `project.material_returns[]` (`id, created_at, date, registered_by, returned_by, reason, notes, items[], total_qty`); 400 se qty > `net_requisitioned` (em campo) ou sem itens. `DELETE .../materials/returns/{return_id}`. `ProjectResponse.material_returns`. `_requisition_balance` agora expõe `qty_returned`, `net_requisitioned` (bruto − devolvido), `return_count`, `returned_qty`; `saldo = total − net`. Devolução NÃO altera Entregue (decisão: só volta ao saldo a requisitar). PDF/email da parcial usam "Já Req." = net.
  - **Baixa por remessa**: `GET /api/projects/{id}/requisitions/{req_id}/items` (itens normalizados da remessa — parcial via `items[]`, total via `materials_snapshot` casando `material_id` ou nome — com `qty_separated/qty_delivered` já registrados) e `POST .../requisitions/{req_id}/fulfillment` `{responsible, notes, items:[{material_id, qty_separated, qty_delivered}]}` → salva `req.fulfillment` e recalcula `materials_list[].qty_separated/qty_delivered` como **soma das remessas com baixa** (itens sem baixa continuam manuais). Reenvio → 400.
  - Frontend `SolicitacaoMaterialPage`: botão `materials-return-open` (desabilitado sem material em campo) → modal `return-modal` (`return-date`, `return-by`, `return-reason` select, `return-notes`, por item `return-qty-{id}` + `return-all-{id}`, `return-save`); seção `returns-history` (`return-row-{id}`, `return-delete-{id}`); coluna saldo mostra `mat-returned-{id}` "−N". Histórico: chip `req-fulfillment-chip-{id}` "Entregue X / Y" (verde se completo) e, ao expandir, bloco `req-fulfillment-block-{id}` (`req-ful-sep-{req}-{mat}`, `req-ful-ent-{req}-{mat}`, `req-ful-fill-sep-{id}`, `req-ful-fill-ent-{id}`, `req-ful-responsible-{id}`, `req-ful-notes-{id}`, `req-ful-save-{id}`).
  - Testes: `backend/tests/test_iteration30.py`.
- **[16/Set/2026] Requisição PARCIAL de almoxarifado (iter29 · 10/10 backend + frontend OK)**
  - Backend `server.py`: `_requisition_balance(project)` (saldo por item a partir do histórico; ignora reenvios; legado sem `material_id` casa por nome), `_partial_selection()` (valida `items=[{id,qty}]`, 400 se vazio/qty 0/id inexistente), `_req_rebuild_args()` (regera PDF de parcial). Novo `GET /api/projects/{id}/materials/requisition-balance` → `items[{id,qty_total,qty_requisitioned,saldo,over}]`, `partial_count`, `next_seq`, `fully_requisitioned`, `total_qty`, `requisitioned_qty`. `POST /materials/preview` e `POST /materials/request` aceitam `requisition_type=parcial` + `items` (multipart). Histórico ganha `requisition_type` ('total'|'parcial'), `seq`, `items[]` (material_id, qty, qty_total, qty_done_before, saldo_after); `materials_snapshot` agora tem `material_id` e, na parcial, só os itens escolhidos. Reenvio herda tipo/seq/items. Email da parcial: banner "REQUISIÇÃO PARCIAL nº X · a de b itens" + colunas Qtd. Obra / Já Req. / Nesta Req. / Saldo.
  - PDF `material_requisition_pdf.build_requisition_pdf(..., items=None, partial=None)`: título "Requisição PARCIAL de Almoxarifado", subtítulo "Remessa parcial nº X · a de b itens", banner laranja e tabela com as 4 colunas de saldo.
  - Frontend `SolicitacaoMaterialPage`: botão `materials-partial-toggle`; barra `partial-bar` (`partial-selected-count`, `partial-over-warning`, `partial-select-pending`, `partial-clear`); coluna "Já req. / Saldo" (`mat-balance-{id}`) sempre visível; em modo parcial coluna "Levar" (`partial-check-{id}`) + "Nesta req." (`partial-qty-{id}`, default = saldo, laranja se acima do saldo → `window.confirm` no envio); botão vira "Enviar Parcial (N)"; badges `materials-fully-requisitioned` ("100% requisitado") / `materials-requisitioned-progress`. Histórico: `req-partial-badge-{id}` "PARCIAL nº X" e tabela `req-partial-items-{id}` ao expandir.
  - **Bug pré-existente corrigido**: modal "Adicionar avulso" estava dentro de `RequisitionRow` (ReferenceError `avulsoOpen`) e quebrava a página sempre que a obra tinha histórico → movido para o componente principal.
  - Testes: `backend/tests/test_iteration29.py`.
- **[15/Set/2026] Quantitativo operacional — novos itens (estruturas + equipamentos)**
  - Campos novos na obra: `estruturas_primarias`, `estruturas_secundarias`, `religadores_qty`, `reguladores_qty` (ProjectCreate/Update/Response + `ProjectDrawer` inputs `project-estr-primarias-input`, `project-estr-secundarias-input`, `project-religadores-input`, `project-reguladores-input`). Removidos do formulário: Ligações novas, Religações, Desligamentos (campos legados continuam no banco/modelo, só não são exibidos).
  - `avanco_fisico.BASE_ITEMS` = postes, km_rede, estruturas_primarias, estruturas_secundarias, transformadores, religadores, reguladores. `LEGACY_ITEMS` (ligacoes/religacoes/desligamentos) só aparecem em obras que já tinham lançamentos nesses itens (rótulo "(legado)") — lançamento novo em item removido retorna 400.
  - Dashboard `kpi-operational-row`: Postes · Km Rede · Estr. Primárias · Estr. Secundárias · Trafos · Religadores · Reguladores · Concluídas Mês · Dias Adiantados (backend `operacional` ganhou `estruturas_primarias/estruturas_secundarias/religadores/reguladores`; chaves antigas mantidas).
  - Testado via curl (criação com quantitativos, lista de itens do avanço, lançamento aceito/rejeitado, KPIs) + screenshot (drawer e dashboard).
- **[15/Set/2026] Login — fundo com tema de engenharia elétrica (rotação automática)**
  - `LoginPage.jsx`: `HERO_IMAGES` (6 fotos Unsplash: cesto aéreo, linha viva, poste/caminhão-cesto, trabalho em altura, rede ao pôr do sol, postes e cabos), troca a cada 7s com cross-fade (framer-motion `AnimatePresence`) + leve zoom, pré-carregamento, overlay escuro para legibilidade. Legenda `login-hero-caption` e pontos clicáveis `login-hero-dot-{i}`. Mobile (`<lg`): mesma imagem esmaecida (`login-hero-mobile`) atrás do card. Testado via screenshot (desktop 1920 e mobile 390, sem overflow).
- **[15/Set/2026] Avanço Físico — regra "mostrar todas" (iter28)**
  - Pedido do usuário (obras 0122600622/0122600699): listar **todas** as obras ≥ limite exceto **canceladas/suspensas**; `aguardando_programacao` (e legado None/"") entra com aviso `avanco-not-scheduled-{id}` "Aguardando programação — sem data no calendário"; concluídas seguem ocultas por toggle. `totals.not_scheduled` no resumo; ordenação ativas → aguardando → concluídas. Lookup só aponta valor abaixo do limite / concluída / suspensa-cancelada. `eligible` = valor ≥ limite e status ∉ {cancelado, suspenso}.
  - Nota: a versão publicada precisa de novo deploy para receber a correção.
- **[15/Set/2026] BUG: obras programadas não apareciam no Avanço Físico (iter27)**
  - Causa: `update_project` (PUT) não mudava `execution_status` para `programado` ao programar obra já cadastrada (só o POST fazia) → ficava "Aguardando Programação"/vazio e a aba excluía.
  - Fix: (1) `update_project` auto-seta `programado` quando `is_scheduled` + datas e status vazio/aguardando (sem status explícito no payload); (2) backfill idempotente no `startup_db`; (3) `avanco_fisico._status()` (efetivo) + `SCHEDULED_NO_STATUS_Q` na listagem; (4) `GET /api/avanco/lookup?q=` diagnostica motivos (valor abaixo do limite / não programada / concluída / suspensa-cancelada) e a UI mostra cards `avanco-lookup-{id}` "Por que não aparece?" quando a busca não encontra nada, com atalho "Mostrar concluídas".
- **[15/Set/2026] Escolher fotos do PDF de Avanço Físico**
  - Backend: `GET /api/projects/{id}/avanco/photos` → catálogo (`photos[]` com id/source photo|attachment/point/label/uploaded_at/thumb(data_url)/caption + `default_ids` = 6 mais recentes). `GET .../avanco/pdf?photo_ids=a,b` inclui só as escolhidas (`photo_ids=none` → sem galeria; sem parâmetro → padrão 6 recentes).
  - Frontend: `components/AvancoPdfModal.jsx` (`avanco-pdf-modal`, `avanco-pdf-photo-{id}` com `data-selected`, `avanco-pdf-select-all/none`, `avanco-pdf-generate`, `avanco-pdf-modal-close`) usado pelo botão `avanco-download-pdf` (AvancoFisicoPage) e `pd-avanco-pdf` (ProjectDetailPage). Grade 2–3 colunas com thumbs, checkbox visual e data.
- **[15/Set/2026] Avanço Físico — filtro de status + fotos no PDF**
  - `GET /api/avanco/projects` agora lista só **programado / a_reprogramar / em_execucao** (`ACTIVE_STATUS`); `?include_completed=1` inclui concluido/executada; `totals.hidden_completed` conta as ocultas. Aguardando programação / suspenso / cancelado ficam fora. `eligible` do detalhe exige status ativo ou concluído (card na obra não aparece em aguardando).
  - UI: checkbox `avanco-toggle-completed` ("Mostrar concluídas") com badge `avanco-hidden-completed`; subtítulo e empty-state explicam a regra.
  - PDF: seção **REGISTRO FOTOGRÁFICO** (até 6 fotos, 3 por linha) com fotos do diário/checklist (`project.photos[].data_url`, mais recentes primeiro) + anexos de imagem do object storage (`attachments` com content_type image/*). `build_router` recebe `storage_get`; endpoint aceita `?max_photos=`.
- **[15/Set/2026] Relatório de Avanço Físico em PDF**
  - `backend/avanco_pdf.py` (`build_avanco_pdf`, reportlab, A4 1 página quando possível): cabeçalho Hayah, identificação da obra, 5 KPIs (eficiência com fundo verde/amarelo/vermelho), **Curva S** desenhada com `reportlab.graphics.LinePlot` (planejado tracejado × realizado), tabela de itens com barra de avanço, controle de materiais (solicitado/entregue/aplicado/saldo, pendências em vermelho), últimos 25 lançamentos, assinaturas (Hayah / Fiscal-Cliente) e rodapé com paginação.
  - Endpoint `GET /api/projects/{id}/avanco/pdf` (router avanco). Botões: `avanco-download-pdf` (AvancoFisicoPage, header do detalhe) e `pd-avanco-pdf` (ProjectDetailPage, card Avanço Físico). Download via blob `avanco_fisico_{codigo}.pdf`.
- **[15/Set/2026] Avanço Físico — obras de ticket grande (iter26)**
  - **Backend** `backend/avanco_fisico.py` (router montado em server.py): `GET/POST /api/avanco/threshold` (app_settings `avanco_threshold`, default R$ 45.000, POST só admin), `GET /api/avanco/projects` (obras ≥ limite, exclui cancelado; totals + resumo por obra), `GET /api/projects/{id}/avanco` (summary, items, custom_items, weights, entries, curve, materials, eligible), `POST/DELETE /api/projects/{id}/avanco/entries`, `PUT /api/projects/{id}/avanco/items` (custom_items + weights). Dados no doc da obra: `progress_entries[]`, `avanco_custom_items[]`, `avanco_weights{}`. `PATCH /projects/{id}/materials/{item}` aceita `qty_applied`.
  - **Cálculo**: itens = quantitativos > 0 (postes, trafos, km_rede, ligações, religações, desligamentos) + etapas custom; `% físico = Σ peso × min(1, exec/plan) / Σ pesos`; `% financeiro = actual/programmed`; `% tempo = (hoje − 1ª data programada) / (expiry_date|end_date − 1ª data)`; `eficiência = %físico ÷ %tempo`; `R$/dia = actual / dias trabalhados (datas programadas ≤ hoje ∪ datas de lançamento)` vs `team.daily_target`. Curva S: planejado linear × realizado acumulado por data.
  - **Frontend**: `pages/AvancoFisicoPage.jsx` (/avanco, nav-avanco, perm `avanco`): totals, lista lateral com busca, detalhe com 5 KPIs, lançamento rápido, "Etapas & pesos", Curva S (recharts), itens, controle de materiais com "Aplicado" editável, timeline com remoção. `components/AvancoWidgets.jsx` (AvancoQuickEntry/AvancoItemsTable/AvancoTimeline/ProgressBar/effColor) reutilizado em `ProjectDetailPage` (card `pd-avanco-card` na aba Operacional só se `eligible`). `components/AvancoThresholdSection.jsx` no Admin. Testes: `backend/tests/test_iteration26.py` (11/11).
- **[15/Set/2026] Equipamentos na Obra (ProjectDetailPage · aba Arquivos)**
  - Nova seção `pd-arquivos-equipamentos` entre Materiais e Fotos por Ponto: fetch `GET /api/equipamentos?project_id={id}`; header com contagem por tipo (trafos/religadores/reguladores) + botão `pd-equip-open-page` (→ /equipamentos); cada linha `pd-equip-{id}` mostra tipo, condição, potência, descrição, patrimônio/série/código/fabricante e até 3 miniaturas de fotos (`pd-equip-photo-{fid}`). Empty state orienta vincular na aba Equipamentos.
- **[15/Set/2026] Carteira Vencimento/Status · Operacional só HOJE · Equipamentos↔Obra · Matriz Programação (iter25)**
  - **Carteira**: coluna **Vencimento** após Nome (`VencimentoCell`: vermelho vencida + "vencida há Nd", laranja ≤7d + "vence em Nd", cinza ok, "—" vazio; inativas nunca colorem). Coluna **Status** (ex-"Prog.") mostra badge real de `execution_status`. Nome exibe `project_code` acima.
  - **Operacional** `GET /api/operacional/today`: só obras com a data de HOJE (America/Cuiaba) em `schedule_entries[].date` (fallback `start_date==hoje`), exclui concluido/cancelado/suspenso, agrupa pela(s) equipe(s) da entrada (obra com 2 equipes aparece nos 2 grupos). Item traz `teams_today[]` e `shutdown_today`. UI mostra "Hoje com: A + B" e "Desligamento Confirmado? · HOJE".
  - **Equipamentos**: `EquipamentoBody` + listagem ganharam `project_id/project_code/project_name`; `GET /api/equipamentos?project_id=` filtra. Modal com `ProjectPicker` (busca por código/nome, `equip-project-search/option/selected/clear`), badge `equip-project-badge-{id}` no card (link /projeto/:id) ou "Sem obra"; busca da página filtra por obra. (Não exibido na página da obra — opção do usuário.)
  - **Programação (matriz)**: coluna de HOJE com fundo amarelo + badge HOJE (`th[data-today]`), datas passadas com "passado" e células com opacidade; cards com código, badges LV/DESL./2ª, nome, local, equipe, badge de status e valor.
  - Seeds: `backend/tests/seed_operacional_hoje.py` (OPHOJE-01..05 + equipamento PAT-OPHOJE). Testes: `backend/tests/test_iteration25.py` (8/8).
- **[15/Set/2026] Dashboard — Vencidas por Data Vencimento + KPIs de Carteira + Financeiro/Tempo médio corrigidos (iter24)**
  - **Vencidas** (`/api/dashboard/kpis`): agora usam `expiry_date` (Data Vencimento do cadastro). Excluem concluído/executada/suspenso/cancelado; obra SEM `expiry_date` não conta. Cada item traz `dias_vencida`. `no_prazo`/`vencendo_amanha` também por `expiry_date`. `manager-kpis.operational.overdue` idem.
  - **Modal Obras Vencidas** (`components/VencidasModal.jsx`, `vencidas-modal`): clique no KPI `kpi-vencidas-card` abre lista detalhada (código, status, tipo, local, equipe, programada, venceu em, há N dias, valor) com botões `Abrir obra` (→ /projeto/:id) e `Ver na Carteira`.
  - **KPIs de Carteira** (`kpi-carteira-row`): bloco `carteira` no endpoint — `apta` (aguardando_programacao + a_reprogramar + em_execucao) **com valor = Σ `labor_cost` (mão de obra cadastrada)** e `pct_value` sobre a M.O. total da carteira (campo `value_basis: "labor_cost"`, `programmed_value` exposto como referência); `nao_apta` (cancelado + suspenso), `programadas` (programado), `concluidas` (concluido + executada) com valor = programmed_value. Todos com `count/value/actual_value/pct_count/pct_value`. Cards clicáveis → `/carteira?filter=apta|nao_apta|programadas|completed`.
  - **Financeiro**: `valor_faturado` = Σ actual_value com `billing_stage=pago` (+`faturado_count`); `valor_pendente_faturamento` = Σ actual_value de concluídas/executadas não pagas (+`pendente_count`); **Receita Mês** = Σ actual_value executadas no mês vs `meta_mes` (contract_targets mês → default → 336k) com `receita_pct`, `pago_mes`, `pago_mes_count`.
  - **Tempo médio**: cada chave virou `{avg, samples}`. Datas reais: `received_date → 1ª data programada`; `1ª programada → exec_date` (execution_finished_at / último daily_return executado / end_date se concluída); `exec → 1ª entrada em billing_history ≥ em_fechamento`; `em_fechamento → pago`. UI mostra `—`/"sem dados suficientes" quando `samples=0`.
  - **CarteiraPage**: filtros `?filter=` agora suportam `vencidas` (por expiry_date), `vencendo`, `apta`, `nao_apta`, `programadas`, além de `completed`/`active`.
  - Seed de teste: `backend/tests/seed_dashboard_kpis.py` (prefixo DASHKPI-). Testes: `backend/tests/test_dashboard_kpis_v2.py` (13/13 verdes).
- **[13/Fev/2026] Meta configurável por equipe + Meta contratual editável no Admin + Alerta automático**
  - **Meta por Equipe**: campo `daily_target` (R$/dia) em `Team` model + endpoints POST/PUT + `TeamDrawer` com input dedicado (default R$ 4.000) + card em `EquipesPage` mostrando meta diária e projeção mensal (×22 dias)
  - **Meta Contratual no Admin**: nova collection `contract_targets` (mês específico ou "default" global) + 3 endpoints (`GET/POST/DELETE /admin/contract-target`) + componente `ContractTargetSection.jsx` na `AdminUsuariosPage` com formulário de edição, badge da meta vigente + fallback (mês → global → sistema R$ 336k) e histórico completo com botão de remover
  - **Alerta de Meta**: computado on-the-fly em `manager-kpis` — dispara quando `<25%` dos dias úteis restantes E `<75%` da meta atingida. Severidade `critical` (<50%) ou `warning`. Banner destacado no topo da AnalisePage com mensagem calculando quanto/dia é preciso para recuperar
  - Backend `manager-kpis`: `daily_target_total` = soma dinâmica das metas por equipe ativa; `expected_monthly` por equipe usa `team.daily_target × 22 dias úteis`
- **[13/Fev/2026] Meta contratual R$ 336k/mês + Meta diária R$ 4k/equipe**
  - Backend: constantes `MONTHLY_CONTRACT_TARGET=336000` e `TEAM_DAILY_TARGET=4000`
  - Novo campo `targets` em `/analytics/manager-kpis` com `monthly_pct`, `monthly_gap`, `daily_target_total`, `business_days_in_month`, `expected_monthly_per_team`, `team_daily_perf[]`
  - Custos de perda recalibrados: **R$ 500/h** (jornada 8h × R$4k/dia) e **R$ 4.000/dia**
  - Frontend `AnalisePage`: nova barra de progresso destacada com % atingido, quanto falta, meta diária/equipe, meta diária total (Nº equipes × R$ 4k), e ranking de aderência por equipe (produção do mês / R$ 4k × 22 dias úteis)
- **[13/Fev/2026] Análise: Prejuízos Operacionais + Filtro de equipes cadastradas**
  - Backend `/analytics/manager-kpis`: novos campos `losses.unproductive_cost`, `losses.unavailable_cost`, `losses.reschedule_count`, `losses.reschedule_events`, `losses.reschedule_lost_value`
  - Backend `/analytics/advanced` e `manager-kpis`: só considera equipes cadastradas na aba Equipes **E** com ≥1 membro OU supervisor (filtra placeholders "Equipe 1/2/3" vazios e "Sem equipe")
  - Frontend `AnalisePage.jsx`: nova seção "Prejuízos Operacionais" com 4 cards — Improdutividade (R$ 100/h), Indisponibilidade (R$ 800/dia), Retornos de Programação (valor programado não realizado), Prejuízo Total
  - Empty state do gráfico de Produtividade por Equipe orienta cadastrar membros/supervisor na aba Equipes
- **[13/Fev/2026] Service Worker v3 — App shell offline completo**
  - `public/sw.js` reescrito: precache do shell (`/`, `/index.html`, `/manifest.json`), network-first para navegação com fallback ao shell cacheado, stale-while-revalidate para assets estáticos, cache-first para imagens, network-first + fallback JSON para `/api/*`
  - Cache versionado (`hayah-v3-2026-02-*`) com limpeza automática de versões antigas
  - `lib/offline.js`: registro com update automático + polling de update a cada 30 min + escuta mensagens de PUSH_NAV/SYNC_REQUEST
  - `index.html`: manifest link, PWA meta tags (apple-mobile-web-app), theme-color
  - **Testado**: app carrega 100% offline após primeira visita — banner "SEM SINAL" aparece, dashboard e sidebar continuam navegáveis, endpoints em cache retornam dados
- **[13/Fev/2026] Lightbox de fotos em Equipamentos com Pinch Zoom**
  - `EquipamentosPage.jsx`: adicionado estado `viewingIdx`, integrado `PinchZoomImage` com resetKey + testids para lightbox
- Multi-data via `schedule_entries` + calendário mostra várias equipes/dia
- Matriz Programação com datas nas COLUNAS, equipes nas LINHAS
- Buscar Obras + Retorno de Programação + Indisponibilidade
- Geolocalização com FitBounds, WhatsApp, drop-pin UTM
- **Almoxarifado** com header + tabela editável (solicitado/separado/baixado/entregue) + PDF de Requisição (reportlab + QR) + histórico + confirmação de recebimento com camera capture
- **Faturamento (esteira)** — 8 estágios com KPIs, filtro por período, kanban horizontal, modal NF, auto-transição de obra concluída
- **Push Notifications** com `PushBlockedHelpModal` — instruções por navegador quando bloqueado

## Novidades Fev/2026 (Ondas)

- **Pinch-Zoom nas fotos (iter38, 11/Fev/2026)** — 🔍 novo componente `components/PinchZoomImage.jsx` com pointer events unificados: pinça 2 dedos para zoom (1× a 6×), arraste para pan, duplo-toque alterna 1× ⇄ 2.5×, roda do mouse com Ctrl para desktop. HUD `{scale}x` amarelo no canto quando ampliado + botão `Ajustar` que reseta. Aplicado no `pd-lightbox` da aba Arquivos das obras + novo viewer em Equipamentos (`equip-photo-viewer`) — clique na thumb abre fullscreen com PinchZoomImage e navegação prev/next entre as 3 fotos. Dica de gesto exibida abaixo da imagem: "Pinça 2 dedos para zoom · Duplo-toque para 2.5× · Arraste para navegar".** — 🖨️ visual formal para impressão + visualização de fotos:
  1. **APR PDF reescrito** (`apr_pdf.py`): estilo engenharia elétrica — cabeçalho `HAYAH ENERGY` sobre fundo azul-marinho + tarja LINHA VIVA (vermelho) ou LINHA MORTA (verde). EPIs/EPCs selecionados agora aparecem com ícone `✓ verde` em bold + descrição destacada; itens não marcados ficam em cinza claro. Procedimentos: coluna dedicada SIM/NÃO/N/A com **célula colorida sólida** (verde-esmeralda / vermelho-tijolo / âmbar) só na resposta escolhida — impossível confundir na impressão. Assinatura do supervisor com fundo amarelo-claro para destaque. Rodapé com Pág. X + info completa.
  2. **Diário de Obra reescrito** (`daily_log_pdf.py`): também A4 branco profissional. Cabeçalho preto. Identificação em grid 2 colunas com labels chumbo. Checklist Operacional com badge colorido `✓ CONFERIDO` (verde) ou `✗ PENDENTE` (vermelho). Fotos em galeria 2×N com caption `PONTO · LABEL · timestamp`. Bloco de assinatura do encarregado no final.
  3. **Lightbox de fotos** (`ProjectDetailPage.jsx`): `<a href={data_url}>` não funcionava em muitos celulares (data URLs base64 gigantes travam o browser). Substituído por lightbox fullscreen: clicando na thumb abre `pd-lightbox` com foto grande, título (ponto+label), timestamp, botão `Baixar`, `← Anterior / Próxima →` para navegar entre todas as fotos ordenadas por ponto, e fechar por clique fora ou botão ✕. Funciona nativo no celular.
  Testado E2E: APR PDF 10.7 KB, 2 páginas com destaque visual; Daily 3.6 KB com checklist colorido. Frontend renderiza lightbox nas fotos.

- **APR Digital (Análise Preliminar de Risco) — Fiel ao PDF do usuário (iter36, 11/Fev/2026)** — 🛡️ formulário digital completo:
  1. **Backend**: `backend/apr_pdf_constants.py` com listas oficiais (16 EPIs, 14 EPCs, 13 Riscos, 27 Procedimentos) extraídas por AI do PDF anexado. `backend/apr_pdf.py` gera PDF fiel via ReportLab com cabeçalho colorido (verde=Linha Morta, vermelho=Linha Viva), tabelas de EPI/EPC/Risco/Procedimentos (Sim/Não/N.A), medidas extras não pré-identificadas, observações e **bloco de assinaturas com imagens** vindas do canvas (base64 → PIL Image no PDF). Endpoints em `server.py`: `POST /projects/{id}/aprs` (criar), `GET /projects/{id}/aprs` (listar), `GET/PATCH/DELETE /aprs/{id}`, `GET /aprs/{id}/pdf` (download com filename `APR_{os}.pdf`). Coleção MongoDB: `aprs`.
  2. **Frontend**: novo componente `components/APREditor.jsx` — modal fullscreen com:
     - Seletor Linha Viva/Morta com cores no header
     - Bloco de identificação (data, OS, tarefa, área, equipe, local, nº profissionais, empresa)
     - 2 grids de checklist EPIs+EPCs + grid de riscos (checkboxes tipo pill amarelo quando marcado)
     - 27 procedimentos com 3 botões coloridos SIM/NÃO/N/A (verde/vermelho/amarelo)
     - Observações gerais textarea
     - Bloco de assinaturas: **Supervisor + N Executores dinâmicos** — cada um com dropdown que lista membros da equipe (`teams.find(t.id === project.team_id).members`) OU digitação manual, campo matrícula, e **SignaturePad canvas** com toque/mouse (touch-action:none) + botão limpar. Assinatura salva como data URL PNG.
     - Botões `[Salvar]` (POST/PATCH) e `[PDF]` (download).
  3. **Ganchos de acesso**:
     - **ProjectDetailPage** (aba Operacional): novo card vermelho "APR — Segurança" com botão `[Nova APR]` e lista de APRs existentes (`pd-apr-item-{id}`) clicáveis para editar. Também: `?apr=1` na URL abre editor automaticamente.
     - **ProgramacaoPage** (cards de obra): novo botão `<Truck>` vermelho (`hoje-apr-{id}`) ao lado do edit — abre `/obras/:id?apr=1` em nova aba.
  4. Testado E2E via curl: APR criada, listada, PDF gerado com 5.7 KB, assinaturas base64 do supervisor incluídas.

- **Barra global Offline/Sync Pendente (iter35, 11/Fev/2026)** — 📶 aviso fixo em TODAS as rotas:
  - Novo componente `components/OfflineBanner.jsx` (`data-testid="global-offline-banner"`) montado direto em `App.js` dentro do `<BrowserRouter>` — aparece inclusive em rotas que não usam `AppLayout` (como `ProjectDetailPage`).
  - Dois estados visuais: (1) **SEM SINAL** (vermelho `#FF003C`, WifiOff icon) — "Você está offline. Alterações serão sincronizadas quando o sinal voltar" ou "N foto(s) salvas no celular"; (2) **FOTOS AGUARDANDO SYNC** (laranja `#FF5E00`, Upload icon) — "N foto(s) aguardando envio" com botão `[SINCRONIZAR AGORA]` (`global-offline-sync-now`) que chama `syncPhotoQueue` na hora. Quando termina sem pendências, mostra "✓ Tudo sincronizado".
  - Detecção: escuta `window.online`/`offline` events + polling leve na fila IDB a cada 6s (para pegar novas fotos enfileiradas em outra aba/página).
  - Botão `X` (`global-offline-dismiss`) permite ao usuário ocultar temporariamente; reaparece na próxima mudança de estado (online/offline).
  - Verificado E2E com Playwright: inserido item na IDB → banner vermelho ao ir offline → banner laranja com "Sincronizar agora" ao voltar online.

- **Offline Fotos (IndexedDB) + Compartilhar Avulso no WhatsApp (iter34, 11/Fev/2026)** — 📱 dois pedidos entregues:
  1. **Fotos offline com IndexedDB** ✅ — novo módulo `lib/photoQueue.js` com IDB (`hayah_offline_photos.queue`) porque localStorage não suporta blobs grandes (>5MB). Funções: `enqueuePhoto({projectId, file, label, point})`, `getQueuedPhotos()`, `syncPhotoQueue(axios, API, onProgress)` e `getQueuedPhotoCount()`. Integrado em `ProjectDetailPage.confirmPhotoUpload`: se `navigator.onLine === false`, salva no IDB; se online mas o POST falhar (timeout/rede), também enfileira. Auto-sync: dispara em `window.online` + na montagem se já online. Badge `pd-pending-photos-badge` (laranja `#FF5E00` com contador) aparece no header ao lado do wifi icon quando existem fotos pendentes. Toast informa quando fotos sincronizam automaticamente.
  2. **Compartilhar item avulso no WhatsApp** ✅ — botão verde WhatsApp `<MessageCircle>` (`mat-whatsapp-{id}`) ao lado do badge AVULSO em cada linha da tabela do Almoxarifado. Ao clicar: se não houver telefone salvo, `window.prompt` pede o WhatsApp do almoxarife (com DDI+DDD, ex: 5565999998888) e persiste em `localStorage['hayah_warehouse_phone']`. Depois abre `https://wa.me/{phone}?text=...` em nova aba com mensagem estruturada em Markdown do WhatsApp: `*🟡 MATERIAL AVULSO*`, obra, local, código, descrição, quantidade, preço, total, justificativa (dos notes), link direto pro projeto (com fotos), quem solicitou. Botão adicional no header `materials-whatsapp-config` para trocar o número quando necessário. Testado E2E com Playwright: nova aba abre com URL `wa.me/5565999998888?text=...` correta.

- **Feats Batch 6 pedidos do usuário (iter33, 11/Fev/2026)** — 🎯 4 P0 entregues + fundação para os 2 P1:
  1. **Material AVULSO no Almoxarifado** ✅: novo endpoint `POST /api/projects/{id}/materials/add-manual` que aceita `{item, code, quantity, unit, unit_cost, notes}` e marca com `source: "avulso"` + `added_at` + `added_by`. Frontend `SolicitacaoMaterialPage`: botão amarelo `[+ Adicionar avulso]` no header + modal `avulso-modal` (código, descrição, qtd, un, preço, observação) com preview de total automático + **badge AVULSO** amarelo na coluna Código (`mat-avulso-badge-{id}`) com tooltip mostrando a observação. Testado E2E via curl + Playwright: item cadastrado e badge renderizando.
  2. **Fotos rápidas de qualquer obra (sem depender do Operacional)** ✅: botão `<Camera>` (`carteira-photo-{i}`) em cada linha da CarteiraPage aponta para `/obras/:id?camera=1`. Em ProjectDetailPage, quando `?camera=1` é detectado via `useSearchParams`, o `tab` inicia em `arquivos` e o file input global (movido para fora dos tabs, sempre montado) com `capture="environment"` é clicado automaticamente após 600ms → abre câmera do celular direto. Verificado: 3 photo buttons renderizados na Carteira.
  3. **Preview no celular pós-captura** ✅: modal fullscreen (`pd-photo-preview-modal`) mostra a foto capturada em tamanho grande com dois botões: `[Refazer]` (limpa preview + reabre câmera via `cancelPhotoPreview`) e `[Enviar com marca d'água]` (chama `confirmPhotoUpload` → aplica watermark canvas → envia). Estado `previewSrc + previewFile` controla o modal antes de qualquer upload.
  4. **Modo Offline** (P1, escopo A — só fotos): parqueado — `lib/offline.js` já faz queue de checklist via localStorage. Estender p/ fotos exige IndexedDB (blobs grandes ~2-5MB não cabem em localStorage) + Service Worker p/ interceptar POST /operacional/photos e re-enviar quando online. Estimativa: 3-4h de trabalho estruturado. Aguardando janela dedicada.
  5. **Resend (email almoxarifado + notificações)** 🔑: bloqueado — usuário disse "Sim" mas não forneceu a chave. `.env` tem `RESEND_API_KEY=""`. Próximo turno: (a) verificar DNS de `hayahenergy.com.br` em https://resend.com/domains (adicionar SPF/DKIM/DMARC nos registros); (b) copiar API key `re_...` do dashboard Resend para `RESEND_API_KEY` e reiniciar backend com `sudo supervisorctl restart backend`.

- **Drill-down por KPI na Análise (iter32, 11/Fev/2026)** — 🎯 clique em qualquer KPI/alerta/destaque abre a lista filtrada em NOVA aba:
  - **KpiCard / AlertRow / HighlightCard** ganharam props `drillTo` + `drillHint`. Cards tornam-se clicáveis (cursor, hover translate, ícone `ArrowUpRight` no canto), com `role="button"` + Enter para acessibilidade. Handler `openDrill(path)` chama `window.open(url, '_blank', 'noopener,noreferrer')`.
  - Rotas de drill-down configuradas: `Aderência/Ticket Médio → /carteira?filter=active`, `%Faturado/MoM → /faturamento`, `Taxa Conclusão/Prazo Médio → /carteira?filter=completed`, `Obras vencidas → /carteira?filter=vencidas`, `Paradas>15d → /faturamento?view=backlog`, `Perdas → /improdutividade`, `Melhor/Pior equipe → /carteira?team_name=X`, `Tipo rentável → /carteira?type=X`.
  - **CarteiraPage.jsx**: `useSearchParams` lê `?filter=vencidas|completed|active`, `?type=X`, `?team_name=X` e aplica no useMemo `filtered`. Banner `carteira-drilldown-banner` no topo mostra "DRILL-DOWN ATIVO · Obras vencidas · N obra(s) · Limpar" com botão `carteira-drilldown-clear` (`X`) que limpa filtros e URL.
  - **FaturamentoPage.jsx**: quando aberta com `?view=backlog`, o `useEffect` scrolla suavemente até `[data-testid=fat-stuck-radar]` e aplica animação de pulse box-shadow vermelha por ~2.8s para chamar atenção.
  - Testado E2E via Playwright: novo tab abre com URL correta, banner renderiza com 3 obras vencidas listadas.

- **Painel Gerencial da Análise (iter31, 11/Fev/2026)** — 📊 KPIs executivos + alertas + destaques no topo da aba Análise:
  1. Novo endpoint `GET /api/analytics/manager-kpis` (aceita `start_date`, `end_date`, `team_id`) retornando 3 blocos: **financial** (`adherence_pct` = realizado/programado, `billing_pct` = faturado/realizado, `avg_ticket`, `backlog_count/value` reutilizando `_scan_stuck_billing_projects`), **operational** (`active`, `completed`, `overdue`, `completion_pct`, `avg_lead_days`), **mom** (comparativo mês atual vs anterior com `delta_pct`), **highlights** (melhor/pior equipe por aderência + tipo mais rentável por faturamento + `teams_ranked`) e **losses** (`unproductive_hours`, `unavailable_days`, `estimated_cost` com HOUR_COST=R$100 e DAY_COST=R$800).
  2. Frontend `AnalisePage.jsx` ganhou 3 zonas no topo: linha de 6 **KpiCards** coloridos por meta (`kpi-adherence`, `kpi-billing-pct`, `kpi-avg-ticket`, `kpi-completion`, `kpi-lead-days`, `kpi-mom-delta` com ícone TrendingUp/Down), painel **AlertRow** (`alert-overdue`, `alert-backlog`, `alert-losses`) e painel **HighlightCard** (`highlight-best-team`, `highlight-worst-team`, `highlight-top-type`).
  3. KPIs respeitam filtros de período e equipe já existentes (mesma fonte que os gráficos). Cores adaptam-se automaticamente ao valor: verde ≥ meta, amarelo intermediário, vermelho/laranja crítico.
  Validado E2E: endpoint retorna estrutura completa; página renderiza os 6 KpiCards + 2 painéis conforme screenshot.

- **Fix P0 Requisição de Materiais — Mapeamento + Reparo de Dados Legados (iter30, 11/Fev/2026)**:
  1. **Parser (server.py)**: reordenei `HEADER_KEYWORDS` para `code → total_cost → cost → quantity → unit → item`. Bug raiz: `"item"` como keyword genérica classificava "COD ITEM" como descrição antes de qualquer coisa, comendo o código; "DESCRIÇÃO ITEM" tentava depois mas era rejeitado. Novo mapeamento resolve corretamente: `COD ITEM→code, DESCRIÇÃO ITEM→item, QTD→quantity, UNIDADE→unit, PREÇO→cost, VLR TOTAL→total_cost`. Validado E2E via curl com xlsx real.
  2. **Swap-on-read para dados legados**: `material_requisition_pdf.py` ganhou helper `_resolve_code_and_desc()` que detecta materiais gravados pelo parser antigo (code vazio + item parece código: sem espaços, ≤30 chars, alfanumérico) e faz swap na hora de renderizar. Frontend `constants.js` ganhou o mesmo helper `resolveMaterialCodeAndDesc()` usado em `SolicitacaoMaterialPage.jsx` e `ProjectDetailPage.jsx`. Verificado visualmente: PDF antes exibia código "-" e descrição "90588" — depois exibe código "90588" e descrição vazia (com instrução para re-importar).
  3. **Endpoints de reparo persistente**: `POST /api/projects/{id}/materials/repair-mapping` (por obra) e `POST /api/projects/repair-all-materials-mapping` (workspace inteiro). Idempotentes: aplicam swap onde `code=""` e `item` parece código, deixam descrição vazia (não há como recuperar). Botão frontend `materials-repair-mapping` com ícone RefreshCw na página do Almoxarifado + toast informando o número de itens corrigidos e sugerindo re-importação para preencher descrições.
  4. **Status do item corrigido**: coluna Status agora exibe `Solicitado / Parcial / Recebido / Pendente` (com `data-testid=mat-status-{id}`) refletindo qty_requested × qty_delivered.
  5. **ProjectDetailPage.jsx**: mini-tabela de materiais ganhou coluna Código separada.
  Validado E2E: inseri legado direto no MongoDB → PDF preview renderizou com swap correto (código 90588/90013 na coluna Código) → repair endpoint moveu 2 itens (idempotente na segunda execução).

- **Foto de Equipamento com Watermark automático (iter29)**:
  Cada upload em `POST /api/equipamentos/{id}/photos` agora recebe carimbo automático via Pillow antes de ser gravado no Object Storage. Layout: barra preta semi-transparente no rodapé com "HAYAH ENERGY · TRAFO/REL/REG · PAT {patrimonio}" em amarelo Hayah + data/hora Cuiabá em branco + hora grande em ciano no canto direito. Escala automática (banda = 9% da altura, fonte maior = 42% da banda). Corrige orientação EXIF de fotos de celular via `ImageOps.exif_transpose`. Sempre reencoda como JPEG q=88 (menor + consistente). Se PIL falhar por algum motivo, salva original (fallback silencioso). Campo `watermark: {patrimonio, tipo}` fica no photo doc para auditoria. Testado E2E: create equip → upload foto 1600x900 → download → PIL abre size correta → cleanup.

- **Fase E-3 · Painel Equipamentos Fixos no Estoque (iter28)**:
  Nova seção `data-testid="equipamentos-panel"` na página `/estoque` (entre KPIs e Toolbar). Mostra 3 cards coloridos (transformador amarelo, religador ciano, regulador de tensão laranja) com contador total + breakdown novo/reforma cada. Clicando em cada card navega para `/equipamentos?tipo={tipo}`. Botão "Ver todos" (`equipamentos-panel-open`) leva à página completa. Fetch automático via `GET /api/equipamentos` no mount.

- **Fase C + E · KPIs Indisp/Improd + Equipamentos Almoxarifado (iter27)**:
  - **Indisponibilidade** reescrita: 4 KPIs (`indisp-kpi-total`, `indisp-kpi-motivo`, `indisp-kpi-equipe`, `indisp-kpi-custo` — R$ 800/dia hardcoded para estimativa) + 3 gráficos (barras horizontais por motivo, pizza por equipe, linha temporal). Filtros por período + motivo. Cores por motivo (chuva/frota/segurança etc).
  - **Improdutividade** reescrita: 4 KPIs em horas (`improd-kpi-total`, `improd-kpi-motivo`, `improd-kpi-equipe`, `improd-kpi-custo` — R$ 100/hora hardcoded) + 3 gráficos idênticos ao acima em escala horária. Tabela agora tem coluna Custo por linha.
  - **Nova página `/equipamentos`** (`nav-equipamentos`, permission `estoque`) para transformadores, religadores e reguladores de tensão. Backend: `EquipamentoBody` model + endpoints GET/POST/PATCH/DELETE `/api/equipamentos` e `/api/equipamentos/{id}/photos` (POST/GET/DELETE) — usa Emergent Object Storage `storage_put/get`. Máximo de 3 fotos por equipamento (limite validado no backend). Campos: tipo, patrimônio, série, código material, descrição, potência, data fabricação, condição (novo/reforma), fabricante, tensões primária e secundária, notas.
  - Frontend: `EquipCard` compacto com badges de tipo (cores) + botão fotos (`equip-photos-{id}` mostrando `N/3`). `EquipModal` com toggle tipo + campos organizados em grid. `PhotosModal` com upload direto da câmera (`capture=environment`) + preview + delete. 3 contadores no topo (`equip-counter-{tipo}`). Busca por descrição/patrimônio/série/código.

- **Fase B · Faturamento + Fase D · Relatórios Excel + PDF bug (iter26)**:
  - **Faturamento (esteira)**: novo botão preset `Ciclo 15 → 15` (fechamento mensal Hayah — dia 15 do mês anterior até 15 do atual, auto-calculado pelo dia atual). Data-testid `fat-range-15to15`. Se hoje > dia 15, ciclo pula para 15 atual → 15 do próximo mês. Também adicionado campo de pesquisa `fat-search` (busca por código, nome ou equipe) com filtro cliente que percorre todos os estágios do pipeline. Botão `fat-search-clear` para limpar.
  - **Excel Programação** (`?report_type=programacao`): 18 colunas incluindo "Motivo Cancelamento/Suspensão" (preenche o `cancel_reason` para obras cancelado/suspenso, "-" caso contrário), "Desligamento" (shutdown_info) e "Observações Gerais" (notes). Reordenado para começar com Código.
  - **Excel Carteira** (`?report_type=carteira`): 16 colunas incluindo "Data Recebimento" (`received_date`), "Data Vencimento (Fim)" (`end_date`), "Status Faturamento" (billing_stage) e "Observações" (cancel_reason + shutdown + notes concatenados).
  - **Bug PDF Requisição Material**: campo descrição não aparecia porque o generator lia `m.get("item")` mas o modelo usa `description`. Refactor para fallback robusto: `description → descricao → item → name → material_name`. Idem para código: `code → codigo → code_material`. Sai `—` se todos vazios.

- **Fase A · Bugs P0 (iter25)** — 4 correções de comportamento pedidas pelo gerente:
  1. **Dashboard "Obras vencidas"** agora exclui `cancelado`, `suspenso`, `executada`, `concluido` (era só os 3 primeiros — `suspenso` estava contando errado como vencida). Também `no_prazo` e `vencendo_amanha` recebem o mesmo filtro `INACTIVE_STATUS`.
  2. **Faturamento (esteira) `/api/faturamento/pipeline`** — query passa a filtrar `execution_status not in [cancelado, suspenso]` na origem. Obras como "00943" (canceladas) NÃO aparecem mais na esteira.
  3. **Retorno de Programação `/api/programacao/pending-returns`** reescrito: novo parâmetro `mode` (padrão retorna TODAS obras com data programada <= hoje sem retorno, ordenadas do mais antigo para o mais recente); parâmetro `date` continua funcionando para filtrar 1 dia específico. Expande `schedule_entries` — cada `(project, target_date)` pendente vira uma linha. Frontend `RetornoProgramacaoModal` agora tem toggle "Todos pendentes / Data específica" e agrupa por data com badge estilo sticky no topo (`retorno-group-{date}`).
  4. **Estoque "Itens em Alerta"** — KPI virou clicável (data-testid `est-kpi-low-stock`), ao clicar aciona `setLowStock(true)` filtrando a tabela para mostrar apenas estoque físico ≤ mínimo. Componente `KpiCard` ganhou prop `onClick`.
  Validado via curl E2E: criar obra `TSTCAN` cancelada em estágio de faturamento com data passada → nem aparece no pipeline, nem em vencidas, nem em pending-returns.

- **Onda P0 crítica (iter24) — Bug multi-tenant que sumia dados** 🚨:
  1. **Root cause**: `get_current_user` sobrescrevia `_id` do usuário pelo `owner_id` de forma agressiva. Quando um usuário admin era re-aprovado por engano com `role="user"`, seu `owner_id` era setado para outro admin e seus próprios projetos/equipes ficavam invisíveis (o usuário acreditava que os dados sumiram).
  2. **Fix em `get_current_user` (server.py:171)**: (a) admins nunca herdam workspace de outro — se detectar admin com `owner_id` setado, auto-limpa e prossegue com dados próprios; (b) usuários regulares que tenham dados próprios (`projects.user_id == actor_id`) são auto-promovidos para admin com `owner_id=None` e `permissions=ALL_PERMISSIONS` — usuário recupera acesso sozinho no próximo request autenticado.
  3. **Fix em `admin_approve_user` e `admin_update_permissions`**: antes de setar `owner_id=admin_actor_id`, verifica se o usuário sendo aprovado/atualizado já tem projetos próprios. Se sim, força `role=admin` e `owner_id=None` — preserva o workspace do usuário. Retorna `own_projects_preserved` na resposta.
  4. **Novo endpoint `POST /api/auth/repair-my-workspace`**: recovery explícito que qualquer usuário pode chamar. Se detectar `owner_id` incorreto E projetos próprios, limpa `owner_id`, promove para admin, restaura permissions completas e revoga sessões (força re-login). Retorna `{status: repaired|already_healthy|no_data_to_recover, own_projects, own_teams, ...}`.
  5. **Testes de regressão** em `/app/backend/tests/test_multi_tenant_recovery.py` — 3 casos: auto-heal via `/me`, endpoint explícito, e aprovação preservando workspace pré-existente. Todos passando via `pytest -n 0`.

- **Onda P0/P1 (iter23)** — batch completo solicitado pelo gerente:
  1. **Faturamento usa Produção Realizada** — `/api/faturamento/pipeline` agora soma `actual_value` (Produção Realizada) em `totals.value`, `backlog_value`, `paid_value`, `stuck_projects` e nos totais por estágio. Cada item retorna `actual_value` E `programmed_value` (referência). Cards do kanban mostram `actual_value` como principal e `Prog: R$...` como subtexto. Cron `backlog_daily_check_job` também usa `actual_value` para o push. `_scan_stuck_billing_projects` retorna ambos.
  2. **Produção por Equipe (team_splits)** — novo campo `team_splits: List[{team_id, team_name, programmed_value, actual_value}]` em `ProjectCreate/Update/Response`. Nova seção `data-testid=team-splits-section` no `ProjectDrawer` com botão `add-team-split`, dropdown de equipe + inputs prog/realizado + botão remover. Barra `team-splits-summary` compara soma vs total (Σ Programado equipes / Σ Realizado equipes) com aviso laranja se diferir — SEM bloqueio (soma pode ser menor/maior por decisão do usuário).
  3. **Histórico Visível na Programação (movement_history)** — novo campo persistente `movement_history: List[dict]` no doc project + helper `_build_movements()`. Rastreio automático em `create_project` (event=`created`), `update_project` (events=`date_changed`, `team_changed`, `status_changed`, `shutdown_info`, `cancel_reason`, `team_splits_changed`) e `update_billing_stage` (event=`billing_stage_changed`). Novo componente `TimelineHistoryModal` (data-testid=`reschedule-history-modal` mantido) com linha do tempo vertical colorida, ícones por tipo (CircleDot/Calendar/Users/CheckCircle2/DollarSign/Zap/XCircle), badge de tipo, valores antigo→novo, motivo e observação. Fallback para `reschedule_history` e `billing_history` legados que não estão no movement.
  4. **Bugs Análise / Produtividade por Equipe** — `CustomTooltip` agora detecta dataKey (`productivity`/`pct` → `%` com 1 casa; `count`/`projetos`/`obras` → integer; resto → currency). Chart Produtividade por Equipe agora com domínio `[0, max(120, ceil(dataMax/10)*10)]`, formatter `${v.toFixed(1)}%`, labelFormatter `Equipe: {l}` e width 110 no eixo Y.
  Backend testado via curl E2E: create (1 movement), update com 4 alterações (4 movements), billing-stage (+1 movement) → total 5. Pipeline retorna actual_value corretamente.

- **Documentos Consolidados (iter22)** — 📁 nova aba `/documentos` (nav-documentos + permission `documentos`) que mostra por obra 6 categorias coloridas: Projeto Executivo, Lista de Materiais, APR (Análise de Risco), Croqui, DWG e Fotos Anexas. Cada categoria tem botão Anexar próprio (data-testid `doc-upload-{kind}` e `doc-file-{kind}`). Adicionais: painel de Fotos Operacionais (agrupadas por Ponto P1/P2/…) + painel de Lista de Materiais (auto do projeto).
  - Sidebar de obras com busca por código/nome/equipe/local + badge de contagem por obra
  - Header do projeto com código/nome/equipe/data/valor/tipo + total de arquivos
  - Backend: `/api/projects/{id}/attachments` aceita agora as 6 kinds novas (`projeto/materiais/apr/croqui/dwg/fotos_ext`) e normaliza legados `project_pdf→projeto`, `material_pdf→materiais`.
  - ProjectDetailPage aba Arquivos ganhou chips `pd-att-kind-*` para selecionar categoria antes de anexar; cada linha mostra badge colorido do tipo.
  - Permission `documentos` adicionada em ALL_PERMISSIONS.

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
