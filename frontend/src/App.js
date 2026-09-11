import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CarteiraPage } from './pages/CarteiraPage';
import { ProgramacaoPage } from './pages/ProgramacaoPage';
import { AnalisePage } from './pages/AnalisePage';
import { RelatoriosPage } from './pages/RelatoriosPage';
import { EquipesPage } from './pages/EquipesPage';
import { OperacionalPage } from './pages/OperacionalPage';
import { SolicitacaoMaterialPage } from './pages/SolicitacaoMaterialPage';
import { CalendarioPage } from './pages/CalendarioPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { GeolocalizacaoPage } from './pages/GeolocalizacaoPage';
import { AdminUsuariosPage } from './pages/AdminUsuariosPage';
import { IndisponibilidadePage } from './pages/IndisponibilidadePage';
import { BuscarObrasPage } from './pages/BuscarObrasPage';
import { FaturamentoPage } from './pages/FaturamentoPage';
import { EstoquePage } from './pages/EstoquePage';
import { DocumentosPage } from './pages/DocumentosPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImprodutividadePage } from './pages/ImprodutividadePage';
import { EquipamentosPage } from './pages/EquipamentosPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import '@/App.css';

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/operacional" element={<ProtectedRoute><OperacionalPage /></ProtectedRoute>} />
      <Route path="/carteira" element={<ProtectedRoute><CarteiraPage /></ProtectedRoute>} />
      <Route path="/programacao" element={<ProtectedRoute><ProgramacaoPage /></ProtectedRoute>} />
      <Route path="/calendario" element={<ProtectedRoute><CalendarioPage /></ProtectedRoute>} />
      <Route path="/materiais" element={<ProtectedRoute><SolicitacaoMaterialPage /></ProtectedRoute>} />
      <Route path="/analise" element={<ProtectedRoute><AnalisePage /></ProtectedRoute>} />
      <Route path="/relatorios" element={<ProtectedRoute><RelatoriosPage /></ProtectedRoute>} />
      <Route path="/equipes" element={<ProtectedRoute><EquipesPage /></ProtectedRoute>} />
      <Route path="/projeto/:id" element={<ProtectedRoute><ProjectDetailPage /></ProtectedRoute>} />
      <Route path="/geolocalizacao" element={<ProtectedRoute><GeolocalizacaoPage /></ProtectedRoute>} />
      <Route path="/admin/usuarios" element={<ProtectedRoute><AdminUsuariosPage /></ProtectedRoute>} />
      <Route path="/indisponibilidade" element={<ProtectedRoute><IndisponibilidadePage /></ProtectedRoute>} />
      <Route path="/buscar" element={<ProtectedRoute><BuscarObrasPage /></ProtectedRoute>} />
      <Route path="/faturamento" element={<ProtectedRoute><FaturamentoPage /></ProtectedRoute>} />
      <Route path="/estoque" element={<ProtectedRoute><EstoquePage /></ProtectedRoute>} />
      <Route path="/documentos" element={<ProtectedRoute><DocumentosPage /></ProtectedRoute>} />
      <Route path="/configuracoes" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/improdutividade" element={<ProtectedRoute><ImprodutividadePage /></ProtectedRoute>} />
      <Route path="/equipamentos" element={<ProtectedRoute><EquipamentosPage /></ProtectedRoute>} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster
            position="top-right"
            theme="dark"
            toastOptions={{
              style: {
                background: '#09090b',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
              },
            }}
          />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
