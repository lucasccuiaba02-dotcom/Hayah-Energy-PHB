# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status, para planejamento assertivo e visão estratégica no dia a dia.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab
- Integrações: Resend (emails), Web Push VAPID, OSRM público (rota real)
- Mapa: OpenStreetMap (grátis)
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT, EPSG:31981)

## Módulos entregues
- Autenticação JWT + cookie fallback localStorage
- Carteira (CRUD + filtros + scroll horizontal com setinhas L/R)
- Programação (matriz por data + filtros + histórico de remanejamento com motivo)
- Análise (Recharts + filtros data+produção + Top 10 obras caras filtrado)
- Relatórios Excel
- Operacional (checklist + fotos com marca d'água + QR + Diário de Obra PDF)
- Solicitação de Material (upload PDF base64 + email)
- Calendário (grid semanal 14 dias, cores por status, scroll horizontal com setinhas L/R)
- **Geolocalização** (mapa Leaflet+OSM, pins por status, rota otimizada Nearest-Neighbor + rota real via OSRM)
- Dashboard (métricas + filtros data+produção + banner Anexo IV D-2 + push toggle)
- PWA offline (Service Worker + manifest + push handlers)
- Cron jobs: 08:30 shutdown, 09:00 Anexo IV D-2 (email + push), 18:00 aviso do dia seguinte

## Regras chave
- `project_code` único por usuário (409 em duplicidade)
- Reschedule: `old_start`, `new_start`, `reason` (frota/segurança/temporal/chuva/acesso), `changed_at`, `changed_by` — nunca sobrescrito
- Fotos: marca d'água canvas (Código, Ponto, Data, UTM x/y ou Local)
- Anexo IV: alerta D-2 diário via email Resend + Web Push + banner Dashboard
- Diário de Obra: PDF ReportLab com checklist + fotos + observações
- Top 10 obras mais caras: apenas status aguardando_programacao, aguardando_inicio, programado, em_execucao

## Endpoints principais
- POST/PUT/GET/DELETE /api/projects
- GET /api/analytics/top-expensive (filtrado por 4 status ativos)
- GET /api/geo/projects (com utm_x/utm_y)
- GET /api/alerts/anexo-iv
- POST /api/schedule/notify-tomorrow | /api/schedule/anexo-iv-reminder
- POST /api/operacional/photos/{project_id}
- GET /api/operacional/daily-log/{project_id}?notes=... (PDF)
- GET /api/push/vapid-key | POST /api/push/{subscribe,unsubscribe,test}

## Feito nesta iteração (Fev/2026)
- HScroller: setinhas L/R + scroll horizontal customizado usado em Carteira e Calendário
- Filtros de data + produção (min/max) no Dashboard aplicados aos stats
- Filtros de data + produção (min/max) na Análise aplicados ao Top 10
- Top 10 backend filtra por status aguardando_programacao/aguardando_inicio/programado/em_execucao
- Endpoint /api/geo/projects retornando projetos com UTM
- Página Geolocalização: mapa Leaflet+OSM, pins coloridos por status, rota Nearest-Neighbor local + rota real via OSRM público, botão "usar minha localização", origem default Cuiabá, links Google Maps por parada, distância/tempo estimados
- Conversão UTM Zone 21 Sul → WGS84 via proj4 no frontend
- Nav item "Geolocalização" na sidebar

## Backlog (P1/P2)
- Split completo de server.py em routers separados
- Fotos em GridFS
- Otimização TSP melhorada (2-opt sobre Nearest-Neighbor)
- Cache de rotas OSRM
- Índice em `start_date` no Mongo
- send_push só remove em 404/410

## Credenciais
Ver `/app/memory/test_credentials.md`.
