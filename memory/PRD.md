# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + react-leaflet-cluster + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx
- Integrações: Resend (email), Web Push VAPID, OSRM público (rota real), Photon+Nominatim OSM (geocoding via proxy backend)
- Mapa: OpenStreetMap
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT, EPSG:31981)

## Módulos entregues
- Auth JWT + fallback localStorage
- Carteira (CRUD + filtros + scroll horizontal com setinhas L/R)
- Programação (filtros + histórico de remanejamento com motivo)
- Análise (filtros data+produção + Top 10 obras caras por 4 status ativos)
- Relatórios Excel
- Operacional (checklist + fotos com marca d'água + QR + Diário de Obra PDF)
- Solicitação de Material (upload PDF + email)
- Calendário (grid semanal 14 dias, scroll horizontal com setinhas)
- Geolocalização (mapa Leaflet+OSM, cluster de obras, roteirização por equipe com cores, export PDF + WhatsApp, rota real OSRM, endereço → UTM via Photon)
- Dashboard (métricas + filtros data+produção + banner Anexo IV D-2 + push toggle)
- PWA offline + cron jobs (08:30, 09:00 Anexo IV D-2, 18:00)

## Regras chave
- `project_code` único (409)
- Reschedule com motivo (frota/segurança/temporal/chuva/acesso), nunca sobrescrito
- Fotos com marca d'água canvas
- Top 10: aguardando_programacao/aguardando_inicio/programado/em_execucao
- Endereço → UTM via proxy /api/geo/geocode (Photon primário, Nominatim fallback, filtro BR)
- Roteiro por equipe com cor distinta e cards PDF/WhatsApp

## Endpoints principais
- POST/PUT/GET/DELETE /api/projects
- GET /api/analytics/top-expensive
- GET /api/geo/projects | GET /api/geo/geocode | POST /api/geo/route-pdf
- GET /api/alerts/anexo-iv
- POST /api/schedule/notify-tomorrow | /api/schedule/anexo-iv-reminder
- POST /api/operacional/photos/{project_id} | GET /api/operacional/daily-log/{project_id}
- GET /api/push/vapid-key | POST /api/push/{subscribe,unsubscribe,test}

## Feito nesta iteração (Fev/2026)
- AddressSearchInput integrado no ProjectDrawer (endereço → UTM auto)
- Proxy /api/geo/geocode: Photon primário + Nominatim fallback + filtro BR (resolveu 429 Nominatim direto)
- Roteirização por equipe com cores distintas e cards de itinerário
- Export PDF do roteiro (ReportLab) e compartilhamento WhatsApp (wa.me)
- Cluster de obras no mapa (MarkerClusterGroup)
- Testing iter11+iter12: 100% backend, 100% frontend

## Backlog (P1/P2)
- Cache LRU curto TTL no /api/geo/geocode
- Split de server.py em routers
- Fotos em GridFS
- TSP 2-opt sobre Nearest-Neighbor
- Cache OSRM
- send_push só remove em 404/410
- WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
