import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { accountsApi } from '../lib/api';
import type { Account } from '../types';

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
    if (!user?.id) return;
    try {
      const list = await accountsApi.list(user.id);
      setAccounts(list);
      setActiveAccountId((cur) => cur ?? list[0]?.id ?? null);
    } catch (err) {
      console.error('[AccountContext] Error loading accounts:', err);
    }
  }, [user]);

  const createAccount = useCallback(async (name: string) => {
    if (!user?.id) return;
    try {
      const newAccount = await accountsApi.create(user.id, name);
      setAccounts(prev => [...prev, newAccount]);
    } catch (err) {
      console.error('[AccountContext] Error creating account:', err);
      throw err;
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <Ctx.Provider value={{ accounts, activeAccountId, setActiveAccountId, reload, createAccount }}>
      {children}
    </Ctx.Provider>
  );
}
