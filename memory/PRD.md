# PRD - Matriz de Programação de Projetos

## Problema Original
"Quero construir uma matriz de programação de projetos com nome de equipes, data, valor programado, meta diária e cores com significados para planejamento assertivo e visão estratégica no dia a dia"

## User Choices
- Visualização: Ambas (Tabela + Timeline/Calendário)
- Cores: Progresso da meta + Status + Prioridade (combinados)
- Meta diária: Valor esperado definido pelo usuário
- Design: Moderno/Criativo (Cyber-Dashboard neon)
- Auth: Login simples (JWT httpOnly cookies)

## Implementado (Iteração 1 - Jul 2026)
- Auth JWT completo (register/login/logout/me)
- Backend CRUD (Teams, Projects, Dashboard stats)
- LoginPage cyberpunk split screen
- Dashboard com sidebar + cards de métricas + toggle Table/Timeline
- ProjectTable com indicadores neon (progresso/status/prioridade)
- ProjectTimeline Gantt-style com barras coloridas
- Drawers para CRUD de Projetos e Equipes
- Sistema de cores: goal_exceeded #00F0FF, goal_met #39FF14, goal_lagging #FF003C
- Testado: 16/16 backend + fluxo frontend completo

## Bug Fixes
- Dashboard stats 500 (timezone naive vs aware) - FIXED
- POST /api/teams 401 após 15min (token expirando) - FIXED (7 dias)

## Backlog
### P1
- Filtros/busca no dashboard
- Exportação de relatórios (PDF/Excel)
- Gráficos burn-down (recharts)

### P2
- Notificações email (Resend) para projetos atrasados
- Múltiplos usuários com permissões
- Anexos em projetos
- Hardening: brute force lockout, password validation

## Credenciais Admin
- Email: admin@projectmatrix.com / Senha: Admin@123
