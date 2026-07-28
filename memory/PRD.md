# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status, para planejamento assertivo e visão estratégica no dia a dia.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + react-leaflet-cluster + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx
- Integrações: Resend (email), Web Push VAPID, OSRM público (rota real), Nominatim OSM (geocoding via proxy backend)
- Mapa: OpenStreetMap
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT, EPSG:31981)

## Módulos entregues
- Autenticação JWT + fallback localStorage
- Carteira (CRUD + filtros + scroll horizontal com setinhas L/R)
- Programação (matriz + filtros + histórico de remanejamento com motivo)
- Análise (Recharts + filtros data+produção + Top 10 obras caras filtrado por 4 status ativos)
- Relatórios Excel
- Operacional (checklist + fotos com marca d'água + QR + Diário de Obra PDF)
- Solicitação de Material (upload PDF base64 + email)
- Calendário (grid semanal 14 dias, cores por status, scroll horizontal com setinhas)
- Geolocalização (mapa Leaflet+OSM, **cluster de obras**, **roteirização por equipe** com cores distintas, **export PDF** + **share WhatsApp**, rota real via OSRM)
- Dashboard (métricas + filtros data+produção + banner Anexo IV D-2 + push toggle)
- PWA offline (SW + manifest + push handlers)
- Cron jobs: 08:30 shutdown, 09:00 Anexo IV D-2, 18:00 aviso do dia seguinte

## Regras chave
- `project_code` único por usuário (409)
- Reschedule: gravado com motivo (frota/segurança/temporal/chuva/acesso) e nunca sobrescrito
- Fotos com marca d'água canvas (Código, Ponto, Data, UTM/Local)
- Top 10 mais caras: apenas aguardando_programacao, aguardando_inicio, programado, em_execucao
- **Endereço → UTM**: busca via /api/geo/geocode (proxy Nominatim), converte lat/lng → UTM 21S automaticamente
- **Cluster no mapa**: MarkerClusterGroup agrupa obras próximas
- **Roteiro por equipe**: cada equipe recebe uma cor no mapa e um card com stops + botões PDF/WhatsApp

## Endpoints principais
- POST/PUT/GET/DELETE /api/projects
- GET /api/analytics/top-expensive (4 status ativos)
- GET /api/geo/projects | GET /api/geo/geocode | POST /api/geo/route-pdf
- GET /api/alerts/anexo-iv | POST /api/schedule/{notify-tomorrow,anexo-iv-reminder}
- POST /api/operacional/photos/{project_id}
- GET /api/operacional/daily-log/{project_id}?notes=... (PDF)
- GET /api/push/vapid-key | POST /api/push/{subscribe,unsubscribe,test}

## Feito nesta iteração (Fev/2026)
- **AddressSearchInput** (Nominatim via backend proxy) integrado no ProjectDrawer — auto-preenche UTM ao selecionar endereço
- Backend proxy /api/geo/geocode com User-Agent (respeita política do Nominatim)
- Roteirização **por equipe** com cor distinta por rota, cards de itinerário
- Export **PDF do roteiro** (`/api/geo/route-pdf` + ReportLab) — botão por equipe
- **Compartilhamento WhatsApp** via wa.me com lista de paradas + links Google Maps
- **Cluster de obras** no mapa via react-leaflet-cluster (MarkerClusterGroup) com estilo Hayah
- Testing agent iter11: **100% backend, 100% frontend após proxy Nominatim**

## Backlog (P1/P2)
- Split completo de server.py em routers
- Fotos em GridFS
- Otimização TSP 2-opt sobre Nearest-Neighbor
- Cache de rotas OSRM no backend
- Índice em `start_date` no Mongo
- Rate-limit de /api/geo/geocode (1 req/s por usuário)
- Envio WhatsApp via API oficial (WhatsApp Business API) em vez de wa.me link

## Credenciais
Ver `/app/memory/test_credentials.md`.
