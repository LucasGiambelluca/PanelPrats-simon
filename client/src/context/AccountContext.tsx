import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext';
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
    if (!user) {
      setAccounts([]);
      setActiveAccountId(null);
      return;
    }
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at');
    if (error) {
      console.error('Error loading accounts:', error.message);
      return;
    }
    const list = (data as Account[]) || [];
    setAccounts(list);
    setActiveAccountId((cur) => cur ?? list[0]?.id ?? null);
  }, [user]);

  const createAccount = useCallback(async (name: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('accounts')
      .insert({ user_id: user.id, name, status: 'disconnected' });
    if (error) {
      console.error('Error creating account:', error.message);
      throw error;
    }
    await reload();
  }, [user, reload]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <Ctx.Provider value={{ accounts, activeAccountId, setActiveAccountId, reload, createAccount }}>
      {children}
    </Ctx.Provider>
  );
}
