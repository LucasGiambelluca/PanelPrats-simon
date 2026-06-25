import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { accountsApi } from '../lib/api';
import type { Account } from '../types';

interface AccountCtx {
  accounts: Account[];
  activeAccountId: string | null;
  setActiveAccountId: (id: string) => void;
  reload: () => Promise<void>;
  createAccount: (name: string, opts?: CreateAccountOpts) => Promise<void>;
  updateAccount: (id: string, updates: any) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
}

interface CreateAccountOpts {
  channel?: 'whatsapp' | 'facebook' | 'instagram';
  provider?: 'baileys' | 'official';
  flow_id?: string | null;
  external_id?: string;
  access_token?: string;
  app_secret?: string;
  verify_token?: string;
}

const Ctx = createContext<AccountCtx>({
  accounts: [],
  activeAccountId: null,
  setActiveAccountId: () => {},
  reload: async () => {},
  createAccount: async () => {},
  updateAccount: async () => {},
  deleteAccount: async () => {},
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

  const createAccount = useCallback(async (name: string, opts?: CreateAccountOpts) => {
    if (!user?.id) return;
    try {
      const newAccount = await accountsApi.create(user.id, name, opts);
      setAccounts(prev => [...prev, newAccount]);
    } catch (err) {
      console.error('[AccountContext] Error creating account:', err);
      throw err;
    }
  }, [user]);

  const updateAccount = useCallback(async (id: string, updates: any) => {
    try {
      const updated = await accountsApi.update(id, updates);
      setAccounts(prev => prev.map(a => a.id === id ? updated : a));
    } catch (err) {
      console.error('[AccountContext] Error updating account:', err);
      throw err;
    }
  }, []);

  const deleteAccount = useCallback(async (id: string) => {
    await accountsApi.delete(id);
    setAccounts(prev => prev.filter(a => a.id !== id));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Mantener la cuenta activa siempre válida: si la actual ya no existe
  // (p.ej. fue eliminada), pasar a la primera disponible.
  useEffect(() => {
    // 'all' = vista unificada (todas las líneas) — es válido, no resetear.
    if (activeAccountId && activeAccountId !== 'all' && !accounts.some(a => a.id === activeAccountId)) {
      setActiveAccountId(accounts[0]?.id ?? null);
    }
  }, [accounts, activeAccountId]);

  return (
    <Ctx.Provider value={{ accounts, activeAccountId, setActiveAccountId, reload, createAccount, updateAccount, deleteAccount }}>
      {children}
    </Ctx.Provider>
  );
}
