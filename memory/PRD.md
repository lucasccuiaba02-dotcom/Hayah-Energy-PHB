# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com nomes de equipes, datas, valores programados, meta diária e cores com significado, para planejamento assertivo e visão estratégica no dia a dia.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler
- Integrações: Resend (emails), Web Push (VAPID) para push notifications
- PDF: ReportLab

## Módulos entregues
- Autenticação JWT + cookie fallback localStorage
- Carteira (CRUD projetos com filtros + tabela + scrollbar customizado)
- Programação (matriz por data + filtros + histórico de remanejamento)
- Análise (Recharts: ciclo, faturamento, produtividade, Top 10 obras caras)
- Relatórios Excel
- Operacional (checklist + fotos com marca d'água + QR code + **Diário de Obra PDF**)
- Solicitação de Material (upload PDF base64 + email)
- Calendário (visão semanal / matriz por equipe)
- Dashboard (métricas + banner Anexo IV D-2 + toggle de push notifications)
- PWA offline (Service Worker + manifest + push handlers)
- Cron jobs: 08:30 shutdown check, 09:00 Anexo IV D-2 (email + push), 18:00 aviso do dia seguinte

## Regras chave
- `project_code` único por usuário (409 em duplicidade)
- Reschedule: `old_start`, `new_start`, `reason`, `changed_at`, `changed_by`
- Fotos: marca d'água canvas (Código, Ponto, Data, UTM x/y ou Local)
- Anexo IV: alerta D-2 diário via email Resend + Web Push + banner Dashboard
- Diário de Obra: consolida checklist + fotos com marca d'água + observações em PDF

## Endpoints principais
- POST/PUT/GET/DELETE /api/projects
- GET /api/analytics/top-expensive
- GET /api/alerts/anexo-iv
- POST /api/schedule/notify-tomorrow | /api/schedule/anexo-iv-reminder
- POST /api/operacional/photos/{project_id}
- GET /api/operacional/daily-log/{project_id}?notes=...  (PDF)
- GET /api/push/vapid-key | POST /api/push/subscribe | /api/push/unsubscribe | /api/push/test

## Feito nesta iteração (Fev/2026)
- Banner Anexo IV D-2 pulsante no Dashboard (link para /programacao)
- Toggle de notificações push no Dashboard (Ativar/Desativar/Bloqueado)
- Diário de Obra em PDF (ReportLab) com header amarelo Hayah, checklist, notas e fotos embarcadas
- Web Push (VAPID) auto-gerado no Mongo, broadcast automático no cron Anexo IV D-2
- SW `push` + `notificationclick` handlers com foco/abertura de tab
- Split parcial de server.py em `push_notifications.py` e `daily_log_pdf.py` (mais `scheduler_jobs.py` como helper)
- Testing agent iter9: 100/100 backend + frontend

## Backlog (P1/P2)
- Split completo de server.py em routers (projects, analytics, operacional, auth)
- Fotos em GridFS/object storage (hoje base64)
- send_push: só remover subscription em 404/410 (evitar remoções por erros transitórios)
- daily-log via POST body (aceitar notas longas)
- Índice em `start_date` para melhorar queries de alerta
- Pydantic model para entries de `reschedule_history`

## Credenciais
Ver `/app/memory/test_credentials.md`.
