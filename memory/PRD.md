# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + react-leaflet-cluster + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx
- Integrações: Resend (email), Web Push VAPID, OSRM público, Photon+Nominatim (geocoding via proxy backend)
- Mapa: OpenStreetMap
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos entregues
- Auth JWT + fallback localStorage
- Carteira (CRUD + filtros + scroll horizontal com setinhas L/R + **botão Duplicar Obra**)
- Programação (filtros + histórico de remanejamento com motivo)
- Análise (filtros data+produção + Top 10 obras caras por 4 status ativos)
- Relatórios Excel
- Operacional (checklist + fotos com marca d'água + QR + Diário de Obra PDF)
- Solicitação de Material (upload PDF + email)
- Calendário (grid semanal 14 dias, scroll horizontal com setinhas)
- Geolocalização (mapa Leaflet+OSM, cluster de obras, roteirização por equipe com cores, export PDF+WhatsApp, rota real OSRM, endereço→UTM via Photon, **hover destaca marker no mapa**, **Rastreio ao vivo** com watchPosition+polling)
- Dashboard (métricas + filtros + banner Anexo IV D-2 + push toggle)
- PWA offline + cron jobs

## Regras chave
- `project_code` único (409)
- Reschedule com motivo, nunca sobrescrito
- Fotos com marca d'água canvas
- Top 10: apenas 4 status ativos
- Endereço → UTM via /api/geo/geocode (cache LRU 60s)
- Roteiro por equipe com cor distinta e cards com PDF/WhatsApp
- Rastreio ao vivo: last 5 min, upsert por user_id, polling 8s
- Duplicar: clone limpa código/programação/histórico/fotos, sufixa " (cópia)"

## Endpoints principais
- POST/PUT/GET/DELETE /api/projects | **POST /api/projects/{id}/duplicate**
- GET /api/analytics/top-expensive
- GET /api/geo/{projects,geocode} | POST /api/geo/route-pdf
- **POST /api/tracking/ping | GET /api/tracking/live | DELETE /api/tracking/ping**
- GET /api/alerts/anexo-iv | POST /api/schedule/{notify-tomorrow,anexo-iv-reminder}
- POST /api/operacional/photos/{id} | GET /api/operacional/daily-log/{id}
- GET /api/push/vapid-key | POST /api/push/{subscribe,unsubscribe,test}

## Feito nesta iteração (Fev/2026)
- Cache LRU 60s no /api/geo/geocode (evita rate-limit de OSM)
- Roteiro no mapa: hover em stop do card destaca marker (FlyTo + ring pulsante amarelo)
- Rastreio ao vivo: toggle na Geolocalização, watchPosition envia ping ao backend, polling 8s, markers pulsantes por equipe, geo-live-bar
- Duplicar Obra: botão Copy na Carteira → POST /api/projects/{id}/duplicate, clone com " (cópia)", código zerado, histórico/programação limpos
- Fix regressão: build_project_response coerce None → '' em start_date/end_date

## Backlog (P1/P2)
- Split de server.py em routers
- Fotos em GridFS
- TSP 2-opt
- Cache OSRM
- send_push só remove em 404/410
- WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
