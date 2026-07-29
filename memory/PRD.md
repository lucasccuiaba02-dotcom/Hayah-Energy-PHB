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
  * FitBounds só na primeira carga + botão "Ajustar vista" → não volta mais ao zoom-out sozinho
  * Popup dos markers: 3 botões — 📱 WhatsApp, 📏 Distância (foca só nesta), 🗺️ Rota
  * "Distância só desta" desenha polyline única + painel flutuante com km + OSRM
  * Search bar com placeholder "número da obra, nome ou local"
  * **NOVO: Localizar obra no mapa** — barra de endereço/CEP no topo + **clique em qualquer ponto** do mapa: mostra coordenadas UTM 21S + toast, pin ciano aparece com popup para "+ Criar obra aqui" (abre drawer pré-preenchido), 📱 WhatsApp e ✕ Remover

## Backlog (P1/P2)
- Lead Time Indicators (Rec→Prog→Exec→Fech→Fatur)
- Split de server.py em routers
- Fotos em GridFS; Cache OSRM; TSP 2-opt
- Limpar usuários TEST_/dup_/bearer_ do admin
- WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
