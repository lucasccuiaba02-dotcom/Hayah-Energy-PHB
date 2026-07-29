# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx
- Integrações: Resend (email), Web Push VAPID, OSRM público, Photon (geocoding), Emergent LLM key (pronto p/ uso)
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos
- Auth JWT + RBAC granular por aba (permissions List[str])
- Carteira, Programação (por data + Matriz Equipes), Análise, Relatórios, Operacional, Materiais, Calendário, Geolocalização, Dashboard, Admin, Indisponibilidade

## Regras chave
- `project_code` único (409); reschedule com motivo (histórico); fotos com marca d'água canvas
- Duplicar: clone limpa código/programação/histórico/fotos, sufixa " (cópia)"
- Permissões: admin sempre tem tudo; usuários limitados só veem abas em `permissions`
- Programação: 2ª equipe opcional → mesmo projeto renderiza em 2 colunas na Matriz Equipes
- Retorno de Programação: executed=true → 'executada'; executed=false + motivo → 'a_reprogramar'

## Endpoints principais
- Auth: POST /api/auth/{register,login}, GET /api/auth/me
- Admin: GET /api/admin/users, PUT /api/admin/users/{id}/permissions, POST /api/admin/users/{id}/approve
- Projects: CRUD /api/projects | POST /api/projects/{id}/duplicate
- Dashboard: GET /api/dashboard/kpis (counts, financeiro, operacional, tempo_medio, servicos_por_dia, vencidas, vencendo_amanha_list)
- Programação: POST /api/programacao/return, GET /api/programacao/pending-returns
- Indisponibilidade: /api/team-unavailability (GET/POST/DELETE)
- Analytics, Geo, Operacional, Push (mantidos)

## Feito em Fev/2026 (iteração 14 — msg 208)
- Métricas físicas no projeto: postes_qty, transformadores_qty, km_rede, ligacoes_novas, religacoes, desligamentos
- 2ª equipe no drawer (`additional_team_id/name`) + render em 2 colunas na Matriz Equipes + badge "2ª EQUIPE" em Por Data
- Retorno de Programação (modal em /programacao) com data picker + motivo + observações
- Página Indisponibilidade de equipes (CRUD)
- Admin de usuários com checkboxes por aba (permissões granulares)
- Dashboard: KPIs financeiro, operacional, tempo médio, vencidas, vencendo amanhã, agregação de produção
- Sidebar filtra links por permission (admin sempre completo)
- Fix stray `)}` em DashboardPage + remoção do field duplicado em ProjectResponse

## Testes (14 iterações)
- iter14: backend 6/6 pytest + frontend E2E (matriz 2 equipes, retorno, drawer, permissões) — 0 bugs

## Backlog (P1/P2)
- Lead Time Indicators (Rec→Prog→Exec→Fech→Fatur)
- Split de server.py em routers (routers/tracking, dashboard, programacao, admin)
- Fotos em GridFS
- Cache OSRM, TSP 2-opt
- send_push só remove em 404/410; WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
