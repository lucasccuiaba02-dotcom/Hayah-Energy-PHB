# PRD — Hayah Energy (Matriz de Programação de Projetos)

## Objetivo
Matriz de programação de projetos com nomes de equipes, datas, valores programados, meta diária e cores com significado, para planejamento assertivo e visão estratégica no dia a dia.

## Stack
- Frontend: React 18 + Tailwind + Shadcn + Framer Motion (PWA)
- Backend: FastAPI + Motor (MongoDB) + APScheduler
- Integrações: Resend (emails), Emergent LLM (não usado ainda)

## Módulos entregues
- Autenticação JWT + cookie fallback localStorage
- Carteira (CRUD projetos com filtros + tabela + scrollbar customizado)
- Programação (matriz por data com filtros e histórico de remanejamento)
- Análise (Recharts: ciclo mensal, faturamento, produtividade, Top 10 obras caras)
- Relatórios Excel
- Operacional (checklist + fotos com marca d'água + QR code)
- Solicitação de Material (upload PDF em base64 + email automático)
- Calendário (visão semanal/matriz por equipe)
- Dashboard com métricas
- PWA offline (Service Worker + manifest)
- Cron jobs: 08:30 shutdown, 09:00 Anexo IV D-2, 18:00 aviso do dia seguinte

## Regras chave
- `project_code` único por usuário (409 em duplicidade, mensagem com "código")
- Reschedule: gravado com `old_start`, `new_start`, `reason`, `changed_at`, `changed_by`
- Fotos: marca d'água canvas (Código da obra, Ponto, Data, UTM x/y ou Local)
- Anexo IV: alerta D-2 diário via Resend + banner via `/api/alerts/anexo-iv`

## Endpoints (parcial)
- POST/PUT/GET/DELETE /api/projects
- GET /api/analytics/top-expensive
- GET /api/alerts/anexo-iv
- POST /api/schedule/notify-tomorrow
- POST /api/schedule/anexo-iv-reminder
- POST /api/operacional/photos/{project_id}

## Feito nesta iteração (2026-02)
- Dialog visual "Código já cadastrado" (400/409) no ProjectDrawer
- Top 10 obras mais caras em /analise
- Histórico de remanejamento com badge + modal em /programacao (botão History no card)
- Filtros extras em /programacao: data específica + faixa de produção (min/max)
- Scrollbars customizadas em desktop (`.hscroll-fancy`)
- Marca d'água em fotos (canvas cliente): código + ponto + data + UTM/local
- Cron `anexo_iv_reminder_job` (09:00) + endpoint /api/alerts/anexo-iv

## Backlog (P1/P2)
- Diário de Obra (PDF automático com fotos + checklist ao fim do turno)
- Split de `server.py` em módulos (~1500 linhas)
- Fotos em GridFS/object storage (hoje base64)
- Índice em `start_date` para melhorar queries de alerta
- Pydantic model para entries de `reschedule_history`
- Notificação in-app quando alerta Anexo IV D-2 ativo (banner no Dashboard)

## Credenciais de teste
Ver `/app/memory/test_credentials.md`.
