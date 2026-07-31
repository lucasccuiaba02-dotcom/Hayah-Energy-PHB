# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx + openpyxl
- Integrações: Resend (email — mocked, aguardando key), Web Push VAPID, OSRM público, Photon (geocoding), Emergent Object Storage, Emergent LLM key
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos (abas no sidebar)
Dashboard, **Buscar Obras**, Operacional, Carteira, Programação, Calendário, **Faturamento**, Geolocalização, Materiais, Análise, Relatórios, Equipes, Indisponibilidade, Admin

## Regras chave
- `project_code` único (409)
- Duplicar obra limpa código/programação/histórico/fotos, sufixa " (cópia)"
- **Permissões open-by-default**: se `permissions=[]` → libera TODAS as abas
- **`schedule_entries`**: multi-data + multi-equipe por obra (calendário mostra 3+ equipes no mesmo dia)
- **Retorno de Programação**: executed=true → 'executada'; executed=false + motivo → 'a_reprogramar'
- Status `cancelado` ou `suspenso` exige `cancel_reason`
- **Auto-transição**: `execution_status=concluido` sem `billing_stage` → move para `recebimento_tecnico`

## Endpoints principais
- Auth: POST /api/auth/{register,login}, GET /api/auth/me
- Admin: /api/admin/users, PUT /permissions
- Projects: CRUD /api/projects (aceita `schedule_entries` + `cancel_reason`)
- Dashboard: GET /api/dashboard/kpis
- Programação: POST /api/programacao/return, GET /api/programacao/pending-returns
- Indisponibilidade: /api/team-unavailability
- Geo: /api/geo/projects, /api/geo/geocode, /api/geo/route-pdf
- **Faturamento**: GET /api/faturamento/pipeline (com start_date/end_date), PUT /api/projects/{id}/billing-stage
- Materiais: POST /api/projects/{id}/materials-import (smart parser)
- Tracking, Analytics, Operacional, Push (mantidos)

## Feito em Fev/2026 (últimas iterações)
- Métricas físicas: postes, transformadores, km_rede, ligacoes_novas, religacoes, desligamentos
- Matriz Programação com **datas nas COLUNAS, equipes nas LINHAS**
- Botão "Hoje" (modal com obras do dia)
- Retorno de Programação (modal)
- Página Indisponibilidade de equipes
- Admin de usuários com checkboxes de permissão
- **Nova aba "Buscar Obras"** (`/buscar`)
- Dashboard: KPIs financeiro/operacional/tempo médio/vencidas/vencendo/produção
- **Multi-data schedule_entries**: obra pode ser programada em várias datas com equipes distintas
- **cancel_reason obrigatório** quando status=cancelado/suspenso
- **Geolocalização** com FitBounds, popup WhatsApp/rota, drop-pin UTM
- **Anexos PDF + Import de Materiais (Emergent Object Storage)**
- **Almoxarifado (aba Materiais) redesenhado**: header, tabela 4 qty editáveis, botão "Enviar Almoxarifado"
- **PDF de Requisição automático (reportlab + qrcode)** — anexado ao email
- **Histórico de Envios** com timeline + status chips + botão "Ver PDF"
- **Confirmação de Recebimento** com camera capture do canhoto
- **Faturamento (esteira financeira)** — 8 estágios: Recebimento Técnico → Em Fechamento → Ajuste de Material → Pendência Construtiva → Aguardando Fiscalização → Aprovada → Digitada → Pago
  * KPIs: Total no ciclo, Backlog (não pago), Notas emitidas, Pago
  * Filtro por período (7d/15d/30d/60d/90d/todos + custom)
  * Kanban horizontal com contagem + valor total por estágio
  * Botão "Avançar" em cada card
  * Modal de detalhe: NF nº/data/valor + observação por movimento
  * Auto-transição: obra concluída (execution_status=concluido) vai automaticamente para `recebimento_tecnico`
  * `billing_history` grava cada mudança de estágio (changed_at, changed_by, notes)
- **Push Notifications — UX de desbloqueio**:
  * `PushBlockedHelpModal.jsx` — detecta Chrome/Edge/Firefox/Safari e mostra passo-a-passo específico
  * Botão "Bloqueado · Como desbloquear?" (ex-texto estático) abre o modal
  * `handleEnablePush` detecta permission=='denied' e abre modal em vez de toast
- **Smart Material Parser (para template Satelite.xlsx)**:
  * Varre TODAS as abas do workbook
  * Detecta linha do cabeçalho procurando keywords (item/descricao + quantidade)
  * Ignora rows de logo/metadata acima do cabeçalho
  * Filtra rows TOTAL/SUBTOTAL/SOMA
  * Escolhe a aba com mais itens
  * Fallback: row 1 como header (backward compat)
  * Suporta colunas: código, descrição/item/material, quantidade/qtd, unidade/un, preço/valor/custo
  * Testes: `/app/backend/tests/test_materials_smart_parser.py` (3 casos)
- ⚠️ **Emails via Resend**: aguardando `RESEND_API_KEY` real do usuário. PDF gerado + histórico gravado + status = `skipped_no_key`

## Backlog (P1/P2)
- Lead Time Indicators (Rec→Prog→Exec→Fech→Fatur) — média de dias entre transições
- Cloudflare 520 em GET /api/projects — investigar pagination/payload size
- Split de server.py em routers (3000+ linhas)
- Fotos em GridFS; Cache OSRM; TSP 2-opt
- Limpar usuários TEST_/dup_/bearer_ do admin
- WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
