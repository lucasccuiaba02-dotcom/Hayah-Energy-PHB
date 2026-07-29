import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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
} from 'lucide-react';

const navItems = [
  { to: '/dashboard', icon: LayoutGrid, label: 'Dashboard', testid: 'nav-dashboard', perm: 'dashboard' },
  { to: '/operacional', icon: HardHat, label: 'Operacional', testid: 'nav-operacional', perm: 'operacional' },
  { to: '/carteira', icon: Briefcase, label: 'Carteira', testid: 'nav-carteira', perm: 'carteira' },
  { to: '/programacao', icon: Calendar, label: 'Programação', testid: 'nav-programacao', perm: 'programacao' },
  { to: '/calendario', icon: Truck, label: 'Calendário', testid: 'nav-calendario', perm: 'calendario' },
  { to: '/geolocalizacao', icon: Map, label: 'Geolocalização', testid: 'nav-geolocalizacao', perm: 'geolocalizacao' },
  { to: '/materiais', icon: Package, label: 'Materiais', testid: 'nav-materiais', perm: 'materiais' },
  { to: '/analise', icon: BarChart3, label: 'Análise', testid: 'nav-analise', perm: 'analise' },
  { to: '/relatorios', icon: FileSpreadsheet, label: 'Relatórios', testid: 'nav-relatorios', perm: 'relatorios' },
  { to: '/equipes', icon: Users, label: 'Equipes', testid: 'nav-equipes', perm: 'equipes' },
  { to: '/indisponibilidade', icon: CalendarX, label: 'Indisponibilidade', testid: 'nav-indisponibilidade', perm: 'programacao' },
  { to: '/admin/usuarios', icon: Shield, label: 'Admin', testid: 'nav-admin', perm: 'admin' },
];

export const AppLayout = ({ children, title, subtitle, actions }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#050505]">
      <div className="flex">
        <aside className="w-20 h-screen bg-[#09090b] border-r border-white/8 fixed left-0 top-0 flex flex-col items-center py-6 z-30">
          <div className="mb-8">
            <HayahLogo size="md" showText={false} />
          </div>

          <nav className="flex-1 flex flex-col gap-3">
            {navItems
              .filter((item) => {
                if (!user) return false;
                if (user.role === 'admin') return true;
                return (user.permissions || []).includes(item.perm);
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

          <button
            data-testid="sidebar-logout-button"
            onClick={handleLogout}
            className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-[#FF003C] hover:bg-white/10 transition-all"
            title="Sair"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </aside>

        <main className="flex-1 ml-20">
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
              <div className="flex items-center gap-3 flex-wrap">{actions}</div>
            </div>
          </div>

          <div className="px-8 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
