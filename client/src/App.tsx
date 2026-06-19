import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from './context/AuthContext';
import { AccountProvider } from './context/AccountContext';
import { Toaster } from 'sonner';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Login from './pages/Login';

// Lazy: cada página en su propio chunk (achica el bundle inicial; BotBuilder/ReactFlow
// es el más pesado y solo lo carga el admin al entrar al builder).
const NotFound = lazy(() => import('./pages/NotFound'));
const Accounts = lazy(() => import('./pages/Accounts'));
const WhatsAppInbox = lazy(() => import('./pages/WhatsAppInbox'));
const BotBuilder = lazy(() => import('./pages/BotBuilder'));
const Connections = lazy(() => import('./pages/Connections'));
const Agenda = lazy(() => import('./pages/Agenda'));
const Sala = lazy(() => import('./pages/Sala'));
const Team = lazy(() => import('./pages/Team'));

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-brand-ivory">
    <Loader2 size={32} className="text-brand-secondary animate-spin" />
  </div>
);

function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#e2e8f0',
          },
        }}
      />
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Sala de videollamada — PÚBLICA (el invitado entra sin login) */}
          <Route path="/sala/:salaId" element={<Sala />} />

          <Route element={<ProtectedRoute />}>
            <Route element={
              <AccountProvider>
                <Layout />
              </AccountProvider>
            }>
              <Route index element={<Navigate to="/inbox" replace />} />
              {/* ambos roles */}
              <Route path="/inbox" element={<WhatsAppInbox />} />
              <Route path="/agenda" element={<Agenda />} />
              {/* solo admin */}
              <Route element={<RoleRoute role="admin" />}>
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/builder" element={<BotBuilder />} />
                <Route path="/connections" element={<Connections />} />
                <Route path="/team" element={<Team />} />
              </Route>
            </Route>
          </Route>

          {/* Catch-all: 404 branded */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
