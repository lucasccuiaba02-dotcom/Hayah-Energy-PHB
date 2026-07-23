# Matriz de Programação de Projetos - PRD

## Original Problem Statement
"Quero construir uma matriz de programação de projetos com nome de equipes, data, valor programado, meta diária e cores com significados para planejamento assertivo e visão estratégica no dia a dia"

## User Choices
- **Visualização**: Ambas (Tabela + Timeline com toggle)
- **Sistema de cores**: Combina progresso da meta + status + prioridade
- **Meta diária**: Usuário define valor esperado por dia, sistema compara com realizado
- **Design**: Moderno/Criativo (tema cyber neon "Electric & Neon")
- **Autenticação**: Login simples email/senha

## Architecture

### Backend (FastAPI + MongoDB)
- **Auth**: JWT via httpOnly cookies (bcrypt password hashing)
- **Collections**: users, teams, projects
- **Endpoints**: `/api/auth/*`, `/api/teams/*`, `/api/projects/*`, `/api/dashboard/stats`
- **User isolation**: teams/projects filtered by user_id

### Frontend (React 19 + Tailwind + framer-motion)
- **Design system**: Cyber neon, glassmorphism, fonts Cabinet Grotesk / Manrope / JetBrains Mono
- **Pages**: LoginPage (split-screen), DashboardPage
- **Components**: ProjectTable, ProjectTimeline (Gantt-style), ProjectDrawer, TeamDrawer

## Core Features (Implemented)
- [x] Autenticação JWT (login, registro, logout, me)
- [x] CRUD Projetos (nome, equipe, datas, valor programado, meta diária, realizado, status, prioridade)
- [x] CRUD Equipes (nome, membros)
- [x] Dashboard com 4 stat cards (total, programado, realizado, performance)
- [x] Visualização Tabela com indicadores de cor
- [x] Visualização Timeline (Gantt) com pill/bars neon
- [x] Toggle animado entre visualizações
- [x] Sistema de cores 3-dimensional:
  - **Progresso**: goal_exceeded (#00F0FF), goal_met (#39FF14), goal_lagging (#FF003C)
  - **Status**: active (#E0FF00 neon), paused (#94A3B8)
  - **Prioridade**: high (#FF003C), medium (#FF5E00), low (#6366F1)
- [x] Cálculo automático de meta diária: `daily_goal * days_elapsed vs actual_value`
- [x] Alertas via toast (sonner)

## What's Been Implemented (2026-02-23)
- Backend completo com autenticação, CRUD e dashboard stats
- Frontend com login/dashboard, ambas visualizações, drawers laterais
- Admin auto-seed no startup (admin@projectmatrix.com / Admin@123)
- Fix: datetime naive/aware para /api/dashboard/stats
- Fix: safe_object_id para retornar 404 em IDs inválidos
- Fix: Promise.allSettled no fetchData

## Backlog / Next Tasks
- **P1**: Notificações e alertas em tempo real quando meta está lagging
- **P1**: Gráfico de progresso histórico (recharts) por projeto
- **P2**: Filtros na tabela (por equipe, status, prioridade)
- **P2**: Exportação de relatórios (PDF/Excel)
- **P2**: Rate limiting / brute-force lockout no login
- **P2**: Validação mínima de senha no registro
- **P3**: Roles/permissões (admin vs user)
- **P3**: Comentários/histórico nos projetos

## Test Credentials
- Admin: `admin@projectmatrix.com` / `Admin@123`
