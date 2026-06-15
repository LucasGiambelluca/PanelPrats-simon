import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import type { Account } from '../types';

// Mock data for development without backend
const MOCK_ACCOUNTS: Account[] = [
  { id: 'acc-1', user_id: 'mock-user', name: 'Ventas Principal', phone_number: '+54 9 11 2345-6789', status: 'connected', created_at: '2026-06-10T10:00:00Z' },
  { id: 'acc-2', user_id: 'mock-user', name: 'Soporte Técnico', phone_number: '+54 9 11 9876-5432', status: 'disconnected', created_at: '2026-06-12T14:00:00Z' },
  { id: 'acc-3', user_id: 'mock-user', name: 'Marketing', phone_number: null, status: 'qr', created_at: '2026-06-14T09:00:00Z' },
];

interface AccountCtx {
  accounts: Account[];
  activeAccountId: string | null;
  setActiveAccountId: (id: string) => void;
  reload: () => Promise<void>;
  createAccount: (name: string) => Promise<void>;
}

const Ctx = createContext<AccountCtx>({
  accounts: [],
  activeAccountId: null,
  setActiveAccountId: () => {},
  reload: async () => {},
  createAccount: async () => {},
});

export const useAccounts = () => useContext(Ctx);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // TODO: Replace with real Supabase query when connected
    // const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at');
    const list = MOCK_ACCOUNTS;
    setAccounts(list);
    setActiveAccountId((cur) => cur ?? list[0]?.id ?? null);
  }, [user]);

  const createAccount = useCallback(async (name: string) => {
    // TODO: Replace with real Supabase insert
    const newAccount: Account = {
      id: `acc-${Date.now()}`,
      user_id: user?.id || 'mock-user',
      name,
      phone_number: null,
      status: 'disconnected',
      created_at: new Date().toISOString(),
    };
    setAccounts(prev => [...prev, newAccount]);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <Ctx.Provider value={{ accounts, activeAccountId, setActiveAccountId, reload, createAccount }}>
      {children}
    </Ctx.Provider>
  );
}
