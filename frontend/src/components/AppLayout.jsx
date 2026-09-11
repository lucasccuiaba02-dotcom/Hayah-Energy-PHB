import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { HayahLogo } from './HayahLogo';
import {
  LayoutGrid,
  Briefcase,
  Calendar,
  BarChart3,
  FileSpreadsheet,
  Users,
  LogOut,
  Truck,
  Package,
  HardHat,
  Map,
  Shield,
  CalendarX,
  Search,
  DollarSign,
  Sun,
  Moon,
  TrendingDown,
  ChevronUp,
  ChevronDown,
  Settings,
  FolderOpen,
  Zap,
} from 'lucide-react';

const navItems = [
  { to: '/dashboard', icon: LayoutGrid, label: 'Dashboard', testid: 'nav-dashboard', perm: 'dashboard' },
  { to: '/buscar', icon: Search, label: 'Buscar Obras', testid: 'nav-buscar', perm: 'carteira' },
  { to: '/operacional', icon: HardHat, label: 'Operacional', testid: 'nav-operacional', perm: 'operacional' },
  { to: '/carteira', icon: Briefcase, label: 'Carteira', testid: 'nav-carteira', perm: 'carteira' },
  { to: '/programacao', icon: Calendar, label: 'Programação', testid: 'nav-programacao', perm: 'programacao' },
  { to: '/calendario', icon: Truck, label: 'Calendário', testid: 'nav-calendario', perm: 'calendario' },
  { to: '/faturamento', icon: DollarSign, label: 'Faturamento', testid: 'nav-faturamento', perm: 'analise' },
  { to: '/geolocalizacao', icon: Map, label: 'Geolocalização', testid: 'nav-geolocalizacao', perm: 'geolocalizacao' },
  { to: '/materiais', icon: Package, label: 'Materiais', testid: 'nav-materiais', perm: 'materiais' },
  { to: '/analise', icon: BarChart3, label: 'Análise', testid: 'nav-analise', perm: 'analise' },
  { to: '/relatorios', icon: FileSpreadsheet, label: 'Relatórios', testid: 'nav-relatorios', perm: 'relatorios' },
  { to: '/equipes', icon: Users, label: 'Equipes', testid: 'nav-equipes', perm: 'equipes' },
  { to: '/estoque', icon: Package, label: 'Estoque', testid: 'nav-estoque', perm: 'estoque' },
  { to: '/equipamentos', icon: Zap, label: 'Equipamentos', testid: 'nav-equipamentos', perm: 'estoque' },
  { to: '/documentos', icon: FolderOpen, label: 'Documentos', testid: 'nav-documentos', perm: 'documentos' },
  { to: '/configuracoes', icon: Settings, label: 'Configurações', testid: 'nav-configuracoes', perm: 'settings' },
  { to: '/indisponibilidade', icon: CalendarX, label: 'Indisponibilidade', testid: 'nav-indisponibilidade', perm: 'programacao' },
  { to: '/improdutividade', icon: TrendingDown, label: 'Improdutividade', testid: 'nav-improdutividade', perm: 'programacao' },
  { to: '/admin/usuarios', icon: Shield, label: 'Admin', testid: 'nav-admin', perm: 'admin' },
];

export const AppLayout = ({ children, title, subtitle, actions }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const navRef = useRef(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const refreshNavScroll = () => {
    const el = navRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 4);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };
  useEffect(() => {
    const t = setTimeout(refreshNavScroll, 50);
    const t2 = setTimeout(refreshNavScroll, 300);
    const el = navRef.current;
    if (!el) return () => { clearTimeout(t); clearTimeout(t2); };
    el.addEventListener('scroll', refreshNavScroll, { passive: true });
    window.addEventListener('resize', refreshNavScroll);
    return () => {
      clearTimeout(t); clearTimeout(t2);
      el.removeEventListener('scroll', refreshNavScroll);
      window.removeEventListener('resize', refreshNavScroll);
    };
  }, [user]);

  const scrollNav = (delta) => {
    const el = navRef.current;
    if (el) el.scrollBy({ top: delta, behavior: 'smooth' });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#050505]">
      <div className="flex">
        <aside className="w-20 h-screen bg-[#09090b] border-r border-white/8 fixed left-0 top-0 flex flex-col items-center py-6 z-30">
          <div className="mb-4">
            <HayahLogo size="md" showText={false} />
          </div>

          {/* Botão scroll para cima */}
          <button
            type="button"
            data-testid="sidebar-scroll-up"
            onClick={() => scrollNav(-160)}
            disabled={!canScrollUp}
            aria-label="Rolar para cima"
            className="w-10 h-6 mb-1 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500 hover:text-[#E0FF00] hover:bg-white/10 transition disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-4 h-4" />
          </button>

          <nav ref={navRef} className="flex-1 w-full flex flex-col gap-3 hayah-sidebar-scroll px-4 py-1">
            {navItems
              .filter((item) => {
                if (!user) return false;
                if (user.role === 'admin') return true;
                const perms = user.permissions || [];
                // Se lista vazia → libera tudo (open-by-default). Admin pode restringir em /admin/usuarios
                if (perms.length === 0) return true;
                return perms.includes(item.perm);
              })
              .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                data-testid={item.testid}
                title={item.label}
                className={({ isActive }) =>
                  `w-12 h-12 rounded-xl border flex items-center justify-center transition-all group relative ${
                    isActive
                      ? 'bg-[#E0FF00]/10 border-[#E0FF00]/40 text-[#E0FF00]'
                      : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                <span className="absolute left-full ml-2 px-2 py-1 rounded-md bg-zinc-900 border border-white/10 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  {item.label}
                </span>
              </NavLink>
            ))}
          </nav>

          {/* Botão scroll para baixo */}
          <button
            type="button"
            data-testid="sidebar-scroll-down"
            onClick={() => scrollNav(160)}
            disabled={!canScrollDown}
            aria-label="Rolar para baixo"
            className="w-10 h-6 mt-1 mb-3 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-500 hover:text-[#E0FF00] hover:bg-white/10 transition disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-4 h-4" />
          </button>

          <button
            data-testid="sidebar-logout-button"
            onClick={handleLogout}
            className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C] hover:bg-white/10 transition-all"
            title="Sair"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </aside>

        <main className="flex-1 ml-20 min-w-0 overflow-hidden">
          <div className="border-b border-white/8 bg-[#09090b]/50 backdrop-blur-xl sticky top-0 z-20">
            <div className="px-8 py-4 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <HayahLogo size="md" showText={true} />
                <div className="border-l border-white/10 pl-4">
                  <h1 className="font-heading font-black text-xl tracking-tighter text-white">
                    {title}
                  </h1>
                  <p className="text-xs text-zinc-500">{subtitle || `Olá, ${user?.name}`}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {actions}
                <ThemeToggleButton />
              </div>
            </div>
          </div>

          <div className="px-8 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
};

const ThemeToggleButton = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      data-testid="theme-toggle"
      onClick={toggle}
      title={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};
