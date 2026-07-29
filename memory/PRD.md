# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx
- Integrações: Resend (email), Web Push VAPID, OSRM público, Photon (geocoding), Emergent LLM key
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos (abas no sidebar)
Dashboard, **Buscar Obras**, Operacional, Carteira, Programação, Calendário, Geolocalização, Materiais, Análise, Relatórios, Equipes, Indisponibilidade, Admin

## Regras chave
- `project_code` único (409)
- Duplicar obra limpa código/programação/histórico/fotos, sufixa " (cópia)"
- **Permissões open-by-default**: se `permissions=[]` → libera TODAS as abas
- **`schedule_entries`**: multi-data + multi-equipe por obra. Backend deriva start/end/team_id/additional do primeiro entry
- **Retorno de Programação**: executed=true → 'executada'; executed=false + motivo → 'a_reprogramar'
- Status `cancelado` ou `suspenso` exige `cancel_reason`

## Endpoints principais
- Auth: POST /api/auth/{register,login}, GET /api/auth/me
- Admin: /api/admin/users, PUT /permissions
- Projects: CRUD /api/projects (aceita `schedule_entries` + `cancel_reason`)
- Dashboard: GET /api/dashboard/kpis
- Programação: POST /api/programacao/return, GET /api/programacao/pending-returns
- Indisponibilidade: /api/team-unavailability
- Geo: /api/geo/projects, /api/geo/geocode, /api/geo/route-pdf
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
- **Geolocalização — melhorias**:
  * FitBounds só na primeira carga + botão "Ajustar vista"
  * Popup dos markers com 📱 WhatsApp, 📏 Distância, 🗺️ Rota
  * Search + endereço/CEP + clique no mapa dropa pin com UTM
- **Anexos PDF + Import de Materiais (Emergent Object Storage)**:
  * `/api/projects/{id}/attachments` GET/POST/DELETE (soft-delete)
  * `/api/projects/{id}/materials-import` (Excel/CSV, parser BR/US)
  * UI com upload/download/delete + tabela materiais
- **Almoxarifado (aba Materiais) redesenhado**:
  * Header: número da obra, data, equipe, localidade, campo de assinatura
  * Tabela com 4 colunas editáveis: Solicitado · Separado · Baixado · Entregue (com totais)
  * PATCH `/api/projects/{id}/materials/{item_id}` para atualizar qty por item
  * Botão "Enviar Almoxarifado" dispara email para 5 destinatários (joenir, tadeu, eurismar, reinaldo, lucas @grupoatualmt.com.br)
- **PDF de Requisição automático (reportlab + qrcode)**:
  * `material_requisition_pdf.py` gera PDF A4 com: cabeçalho (nº obra, equipe, data, localidade), tabela com 4 qty + totais coloridos, bloco de assinatura (solicitante + almoxarife), QR code linkando a obra
  * Salvo em Emergent Object Storage (`hayah-energy/requisitions/{user}/{id}.pdf`) + anexado ao email
  * Endpoint `GET /api/projects/{id}/requisitions/{req_id}/pdf` (blob autenticado)
- **Histórico de Envios**:
  * Cada `/materials/request` grava entry em `project.material_requisitions` (created_at, created_by, signature_name, recipients, email_status: sent/skipped/error, materials_snapshot, pdf_path)
  * UI mostra timeline com status chips + botão "Ver PDF"
- **Confirmação de Recebimento**:
  * `POST /api/projects/{id}/requisitions/{req_id}/confirm-receipt` — receiver_name + notes + foto opcional (canhoto) armazenada em `hayah-energy/receipts/`
  * `GET .../receipt-photo` serve a foto autenticada
  * UI: badge "Recebido" + expandir mostra data/quem/notas + botão "Ver foto do canhoto"
  * Se não recebido: input receiver + notes + camera capture (`capture="environment"` no mobile)
- ⚠️ **Emails via Resend**: aguardando `RESEND_API_KEY` real do usuário. Enquanto isso: PDF é gerado + histórico é gravado + status = `skipped_no_key`

## Backlog (P1/P2)
- Lead Time Indicators (Rec→Prog→Exec→Fech→Fatur)
- Split de server.py em routers
- Fotos em GridFS; Cache OSRM; TSP 2-opt
- Limpar usuários TEST_/dup_/bearer_ do admin
- WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
