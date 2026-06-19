import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

/** Permite la ruta solo si el rol coincide; si no, redirige (empleada → /inbox). */
export default function RoleRoute({ role }: { role: Role }) {
  const { role: current, loading } = useAuth();
  if (loading) return null;
  return current === role ? <Outlet /> : <Navigate to="/inbox" replace />;
}
