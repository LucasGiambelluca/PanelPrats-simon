import { supabase } from '../../config/database';
import { Session, SessionContext } from '../../core/domain/Session';
import { memoryAccounts } from '../../core/accounts/memoryStore';

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

/**
 * SessionRepository — portado desde StockSystem (Plan 2, Task 8).
 *
 * Aislamiento por cuenta: `accountId` se inyecta como PRIMER parámetro de los
 * métodos públicos que tocan la DB (`findActiveSession`, `getOrCreate`,
 * `update`, `forceReset`, `archive`). Cada query Supabase agrega
 * `.eq('account_id', accountId)` y los insert/update incluyen
 * `account_id: accountId` (la Session no conoce su cuenta, se inyecta aquí).
 */
export class SessionRepository {
  private readonly TABLE = 'flow_executions';
  private readonly HISTORY_TABLE = 'flow_executions_history';
  private static memorySessions = new Map<string, any>();

  private useMemory(accountId: string): boolean {
    if (process.env.NODE_ENV === 'test') {
      return memoryAccounts.has(accountId);
    }
    return !isSupabaseConfigured || memoryAccounts.has(accountId);
  }

  /**
   * Find an active session without creating one
   */
  async findActiveSession(accountId: string, sessionId: string): Promise<Session | null> {
    const finalSessionId = sessionId.replace('@s.whatsapp.net', '').replace('@c.us', '');
    
    if (this.useMemory(accountId)) {
      const key = `${accountId}:${finalSessionId}`;
      const sessionData = SessionRepository.memorySessions.get(key);
      if (sessionData && ['active', 'waiting_input'].includes(sessionData.status)) {
        return Session.fromJSON(sessionData);
      }
      return null;
    }

    const { data } = await supabase
      .from(this.TABLE)
      .select('*')
      .eq('account_id', accountId)
      .eq('session_id', finalSessionId)
      .in('status', ['active', 'waiting_input'])
      .order('updated_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      return Session.fromJSON(data[0]);
    }
    return null;
  }

  /**
   * Get or create session - ATOMIC
   */
  async getOrCreate(
    accountId: string,
    sessionId: string,
    userPhone: string,
    flowId: string,
    initialContext?: Partial<SessionContext>,
    startNodeId: string = 'start'
  ): Promise<Session> {
    const finalSessionId = sessionId.replace('@s.whatsapp.net', '').replace('@c.us', '');

    const existing = await this.findActiveSession(accountId, finalSessionId);

    if (existing) {
      // Check expiration (optional, 30 min in the plan)
      const expirationMs = 30 * 60 * 1000;
      if (Date.now() - existing.lastActivity.getTime() > expirationMs) {
        console.log(`[SessionRepo] Archiving expired session: ${finalSessionId}`);
        await this.archive(accountId, finalSessionId, 'expired');
        return this.createNew(accountId, finalSessionId, userPhone, flowId, initialContext, startNodeId);
      }

      return existing;
    }

    return this.createNew(accountId, finalSessionId, userPhone, flowId, initialContext, startNodeId);
  }

  /**
   * Create new session with clean context
   */
  private async createNew(
    accountId: string,
    sessionId: string,
    userPhone: string,
    flowId: string,
    initialContext?: Partial<SessionContext>,
    startNodeId: string = 'start'
  ): Promise<Session> {
    const context: SessionContext = {
      variables: {
        shared: initialContext?.variables?.shared || {},
        global: {
          phoneNumber: userPhone,
          chatJid: sessionId.includes(':') ? sessionId.split(':')[1] : userPhone,
          startedAt: new Date().toISOString(),
          ...(initialContext?.variables?.global || {})
        },
        [flowId]: initialContext?.variables?.[flowId] || {}
      },
      interactionLog: [],
      metadata: {
        flowId,
        flowVersion: 1,
        entryPoint: (initialContext?.metadata?.entryPoint as any) || 'trigger',
        expiresAt: initialContext?.metadata?.expiresAt || (() => {
            const date = new Date();
            date.setHours(date.getHours() + 2); // Default 2h
            return date;
        })()
      }
    };

    const session = new Session(
      sessionId,
      userPhone,
      userPhone, // chatJid usage is simplified
      context,
      startNodeId, // Use the provided start node
      'active',
      new Date(),
      0 // initial version
    );

    const finalSessionId = sessionId.replace('@s.whatsapp.net', '').replace('@c.us', '');
    if (this.useMemory(accountId)) {
      const key = `${accountId}:${finalSessionId}`;
      const sessionJson = { ...session.toJSON(), id: session.id || finalSessionId, account_id: accountId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      SessionRepository.memorySessions.set(key, sessionJson);
      return Session.fromJSON(sessionJson);
    }

    const { data: created, error } = await supabase
      .from(this.TABLE)
      .insert({ ...session.toJSON(), account_id: accountId })
      .select()
      .single();

    if (error) {
      // Race condition: if session was created between lookup and insert
      if (error.code === '23505') {
          console.warn(`[SessionRepo] Race condition detected during create for ${sessionId}. Retrying getOrCreate.`);
          return this.getOrCreate(accountId, sessionId, userPhone, flowId, initialContext);
      }
      console.error('[SessionRepo] Error creating session:', error);
      throw error;
    }

    return Session.fromJSON(created);
  }

  /**
   * Atomic update with Optimistic Locking
   */
  async update(accountId: string, session: Session): Promise<void> {
    const currentVersion = session.version;
    const nextVersion = currentVersion + 1;

    // Normalize: ensure we don't have suffix in session_id if it's 1to1
    const finalSessionId = session.id.replace('@s.whatsapp.net', '').replace('@c.us', '');

    if (this.useMemory(accountId)) {
      const key = `${accountId}:${finalSessionId}`;
      const existing = SessionRepository.memorySessions.get(key);
      if (existing && existing.version !== currentVersion) {
        throw new Error(`CONCURRENCY_CONFLICT: Session ${session.id} was modified by another process (version mismatch).`);
      }
      const updateData = {
          ...session.toJSON(),
          account_id: accountId,
          session_id: finalSessionId,
          version: nextVersion,
          updated_at: new Date().toISOString()
      };
      SessionRepository.memorySessions.set(key, updateData);
      session.version = nextVersion;
      return;
    }

    const updateData = {
        ...session.toJSON(),
        account_id: accountId,
        session_id: finalSessionId,
        version: nextVersion,
        updated_at: new Date().toISOString()
    };

    // Use primary key UUID if we have it, otherwise fallback to session_id (ambiguous)
    const query = supabase
      .from(this.TABLE)
      .update(updateData)
      .eq('account_id', accountId)
      .eq('version', currentVersion);

    if (session.uuid) {
      query.eq('id', session.uuid);
    } else {
      query.eq('session_id', finalSessionId);
    }

    const { data, error } = await query.select();

    if (error) {
        console.error('[SessionRepo] Error updating session:', error);
        throw error;
    }

    if (!data || data.length === 0) {
      throw new Error(`CONCURRENCY_CONFLICT: Session ${session.id} was modified by another process (version mismatch).`);
    }

    // Bump in-memory version so a subsequent update() in the same turn matches the DB row.
    session.version = nextVersion;
  }

  /**
   * Archive session by ID - Efficient
   */
  async archive(accountId: string, sessionId: string, reason: string): Promise<void> {
    const finalSessionId = sessionId.replace('@s.whatsapp.net', '').replace('@c.us', '');
    if (this.useMemory(accountId)) {
      const key = `${accountId}:${finalSessionId}`;
      const session = SessionRepository.memorySessions.get(key);
      if (session && ['active', 'waiting_input'].includes(session.status)) {
        session.status = 'archived';
        session.archived_reason = reason;
        session.updated_at = new Date().toISOString();
        SessionRepository.memorySessions.set(key, session);
      }
      return;
    }

    const { data: sessions } = await supabase
      .from(this.TABLE)
      .select('*')
      .eq('account_id', accountId)
      .eq('session_id', finalSessionId)
      .in('status', ['active', 'waiting_input']);

    if (!sessions || sessions.length === 0) return;
    await this.archiveAll(accountId, sessions, reason);
  }

  /**
   * Bulk archive for performance
   */
  private async archiveAll(accountId: string, sessions: any[], reason: string): Promise<void> {
    if (sessions.length === 0) return;

    const historyRows = sessions.map(s => ({
      account_id: accountId,
      original_id: s.id,
      flow_id: s.flow_id,
      phone: s.phone,
      session_id: s.session_id,
      current_node_id: s.current_node_id,
      status: s.status,
      context: s.context,
      started_at: s.started_at,
      last_activity: s.last_activity,
      completed_at: new Date().toISOString(),
      archived_reason: reason,
      version: s.version
    }));

    // Batch insert into history
    const { error: histError } = await supabase.from(this.HISTORY_TABLE).insert(historyRows);
    if (histError) console.error('[SessionRepo] Error inserting batch history:', histError);

    // Batch update main table
    const ids = sessions.map(s => s.id);
    const { error: updError } = await supabase
      .from(this.TABLE)
      .update({ status: 'archived', archived_reason: reason })
      .eq('account_id', accountId)
      .in('id', ids);
    if (updError) console.error('[SessionRepo] Error updating batch status:', updError);
  }

  /**
   * Force reset for a specific user - Now extremely fast
   */
  async forceReset(accountId: string, phoneNumber: string): Promise<number> {
    if (this.useMemory(accountId)) {
      let count = 0;
      for (const [key, session] of SessionRepository.memorySessions.entries()) {
        if (key.startsWith(`${accountId}:`) && session.phone === phoneNumber && ['active', 'waiting_input'].includes(session.status)) {
          session.status = 'archived';
          session.archived_reason = 'user_reset';
          session.updated_at = new Date().toISOString();
          SessionRepository.memorySessions.set(key, session);
          count++;
        }
      }
      return count;
    }

    const { data: sessions, error } = await supabase
      .from(this.TABLE)
      .select('*')
      .eq('account_id', accountId)
      .eq('phone', phoneNumber)
      .in('status', ['active', 'waiting_input']);

    if (error || !sessions || sessions.length === 0) return 0;

    await this.archiveAll(accountId, sessions, 'user_reset');
    return sessions.length;
  }

  /**
   * Update session context by merging new variables
   */
  async updateContext(accountId: string, sessionId: string, newVariables: any): Promise<void> {
    const finalSessionId = sessionId.replace('@s.whatsapp.net', '').replace('@c.us', '');

    if (this.useMemory(accountId)) {
      const key = `${accountId}:${finalSessionId}`;
      const existing = SessionRepository.memorySessions.get(key);
      if (!existing) return;
      const currentContext = existing.context || { variables: { global: {} } };
      const updatedContext = {
        ...currentContext,
        variables: {
          ...currentContext.variables,
          global: {
            ...currentContext.variables?.global,
            ...newVariables
          }
        }
      };
      existing.context = updatedContext;
      existing.updated_at = new Date().toISOString();
      SessionRepository.memorySessions.set(key, existing);
      return;
    }

    // 1. Get current session
    const { data: existing } = await supabase
      .from(this.TABLE)
      .select('*')
      .eq('account_id', accountId)
      .eq('session_id', finalSessionId)
      .in('status', ['active', 'waiting_input'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (!existing) return;

    // 2. Merge context
    const currentContext = existing.context || { variables: { global: {} } };
    const updatedContext = {
      ...currentContext,
      variables: {
        ...currentContext.variables,
        global: {
          ...currentContext.variables?.global,
          ...newVariables
        }
      }
    };

    // 3. Update
    await supabase
      .from(this.TABLE)
      .update({
        context: updatedContext,
        updated_at: new Date().toISOString()
      })
      .eq('account_id', accountId)
      .eq('id', existing.id);
  }
}
