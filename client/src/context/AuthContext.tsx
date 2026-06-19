import { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { meApi } from '../lib/api';
import type { Role } from '../types';

// DEV MODE: skip real auth when no Supabase credentials are configured
const IS_DEV_MODE = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL === '';

// UUID real persistido en Supabase auth.users. Permite que el modo dev (auto-login)
// genere un user_id válido => las cuentas/flows/chats persisten en Supabase (no en memoria)
// y satisfacen la FK accounts.user_id -> auth.users(id).
// Para auth real multiusuario: setear VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY en .env.
const MOCK_USER = {
  id: '03f6b5d7-febe-4af9-909b-70fba81e26af',
  email: 'rsgroupenter@gmail.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
} as unknown as User;

const MOCK_SESSION = {
  access_token: 'dev-token',
  refresh_token: 'dev-refresh',
  user: MOCK_USER,
  expires_in: 99999,
  token_type: 'bearer',
} as unknown as Session;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: Role | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ data: { user: User | null; session: Session | null }; error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  role: null,
  loading: true,
  signIn: async () => ({ data: { user: null, session: null }, error: null }),
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (IS_DEV_MODE) {
      // Auto-login in dev mode
      console.log('🔓 DEV MODE: Auto-authenticating with mock user');
      setSession(MOCK_SESSION);
      setUser(MOCK_USER);
      setRole('admin');
      setLoading(false);
      return;
    }

    const resolveRole = async (s: Session | null) => {
      if (!s) { setRole(null); return; }
      try { const me = await meApi.get(); setRole(me.role); } catch { setRole(null); }
    };

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      await resolveRole(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      await resolveRole(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (IS_DEV_MODE) {
      setSession(MOCK_SESSION);
      setUser(MOCK_USER);
      return { data: { user: MOCK_USER, session: MOCK_SESSION }, error: null };
    }
    return await supabase.auth.signInWithPassword({ email, password });
  };

  const signOut = async () => {
    if (IS_DEV_MODE) {
      setSession(null);
      setUser(null);
      return;
    }
    await supabase.auth.signOut();
  };

  const value = {
    session,
    user,
    role,
    loading,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
