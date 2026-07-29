# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com equipes, datas, valores programados, meta diária e cores por status.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion + Leaflet/react-leaflet + proj4 (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler + pywebpush + ReportLab + httpx
- Integrações: Resend (email), Web Push VAPID, OSRM público, Photon (geocoding), Emergent LLM key (pronto p/ uso)
- CRS: SIRGAS 2000 / UTM Zone 21 South (Cuiabá/MT)

## Módulos (abas na sidebar)
- Dashboard, **Buscar Obras (novo)**, Operacional, Carteira, Programação, Calendário, Geolocalização, Materiais, Análise, Relatórios, Equipes, Indisponibilidade, Admin

## Regras chave
- `project_code` único (409); reschedule com motivo (histórico); fotos com marca d'água canvas
- Duplicar: clone limpa código/programação/histórico/fotos, sufixa " (cópia)"
- **Permissões open-by-default**: se `permissions=[]` → libera TODAS as abas. Admin restringe em /admin/usuarios
- Programação: 2ª equipe opcional → mesmo projeto renderiza em 2 colunas na Matriz
- Retorno de Programação: executed=true → 'executada'; executed=false + motivo → 'a_reprogramar'

## Endpoints principais
- Auth: POST /api/auth/{register,login}, GET /api/auth/me (agora fallback ALL_PERMISSIONS quando vazio)
- Admin: /api/admin/users (GET, PUT /permissions, POST /approve|reject)
- Projects: CRUD /api/projects | POST /api/projects/{id}/duplicate
- Dashboard: GET /api/dashboard/kpis
- Programação: POST /api/programacao/return, GET /api/programacao/pending-returns
- Indisponibilidade: /api/team-unavailability (GET/POST/DELETE)
- Geo: /api/geo/projects, /api/geo/geocode, /api/geo/route-pdf
- Tracking, Analytics, Operacional, Push (mantidos)

## Feito em Fev/2026 (iter 14 + hotfix pós-msg 208)
- Métricas físicas no projeto: postes, transformadores, km_rede, ligacoes_novas, religacoes, desligamentos
- 2ª equipe no drawer + Matriz Programação (agora DATAS=colunas, EQUIPES=linhas — transposição solicitada)
- Botão "Hoje" na Programação (modal com obras do dia, edit inline, totais + postes/trafos)
- Retorno de Programação (modal em /programacao)
- Página Indisponibilidade de equipes (CRUD)
- Admin de usuários com checkboxes por aba
- **Nova aba "Buscar Obras" (/buscar)**: pesquisa em código/nome/local/equipe/desligamento + filtros status/equipe + editar/duplicar/excluir inline
- Dashboard: KPIs financeiro, operacional, tempo médio, vencidas, vencendo amanhã, produção agregada
- Sidebar filtra por permission mas **libera tudo se vazio** (destrava usuários recém-registrados)
- Fix: field duplicado ProjectResponse, stray `)}` no DashboardPage
- Conta `lucasc.cuiaba02@gmail.com` promovida para admin com todas as permissões

## Testes (14 iterações)
- iter14: backend 6/6 pytest + frontend E2E — 0 bugs
- hotfix pós-msg 208: smoke-test verificou sidebar/matriz-transposta/hoje/buscar/geo-mapa OK

## Backlog (P1/P2)
- Lead Time Indicators (Rec→Prog→Exec→Fech→Fatur)
- Split de server.py em routers
- Fotos em GridFS; Cache OSRM; TSP 2-opt
- Limpar 22 usuários TEST_/dup_/bearer_ da tabela admin
- WhatsApp Business API oficial

## Credenciais
Ver `/app/memory/test_credentials.md`.
