import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AccountProvider } from './context/AccountContext';
import { Toaster } from 'sonner';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Accounts from './pages/Accounts';
import WhatsAppInbox from './pages/WhatsAppInbox';
import BotBuilder from './pages/BotBuilder';
import Connections from './pages/Connections';
import Agenda from './pages/Agenda';
import Sala from './pages/Sala';
import Team from './pages/Team';

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
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
