import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AccountProvider } from './context/AccountContext';
import { Toaster } from 'sonner';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Accounts from './pages/Accounts';
import WhatsAppInbox from './pages/WhatsAppInbox';
import BotBuilder from './pages/BotBuilder';
import Connections from './pages/Connections';
import Agenda from './pages/Agenda';

function App() {
  return (
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

          <Route element={<ProtectedRoute />}>
            <Route element={
              <AccountProvider>
                <Layout />
              </AccountProvider>
            }>
              <Route index element={<Navigate to="/accounts" replace />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/inbox" element={<WhatsAppInbox />} />
              <Route path="/builder" element={<BotBuilder />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/agenda" element={<Agenda />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
