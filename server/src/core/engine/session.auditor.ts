import { supabase } from '../../config/database';

export interface AuditLog {
  timestamp?: string;
  session_id: string;
  event_type: 'message_received' | 'session_lookup' | 'node_execution' | 'context_update' | 'message_sent' | 'session_reset';
  message_id?: string;
  user_phone: string;
  details: any;
  stack_trace?: string;
}

export class SessionAuditor {
  private buffer: AuditLog[] = [];
  private flushInterval: NodeJS.Timeout;
  private static instance: SessionAuditor;

  private constructor() {
    // Flush every 5 seconds or when buffer reach 50 events
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  public static getInstance(): SessionAuditor {
    if (!SessionAuditor.instance) {
      SessionAuditor.instance = new SessionAuditor();
    }
    return SessionAuditor.instance;
  }

  log(event: AuditLog): void {
    this.buffer.push({
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    });

    if (this.buffer.length >= 50) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
        const { error } = await supabase.from('audit_logs').insert(batch);
        if (error) {
            // Silence if table is missing to avoid spamming the console
            if (!error.message.includes('audit_logs')) {
                console.error('❌ [SessionAuditor] Error flushing logs to Supabase:', error.message);
            }
        }
    } catch (err) {
        console.error('❌ [SessionAuditor] Critical error during flush:', err);
    }
  }

  // Analysis of problems (as proposed in the plan)
  async detectAnomalies(sessionId: string, lastMinutes: number = 10): Promise<any> {
    const since = new Date(Date.now() - lastMinutes * 60000).toISOString();

    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('session_id', sessionId)
      .gte('timestamp', since)
      .order('timestamp', { ascending: true });

    if (error || !logs) return { sessionId, issues: [], totalLogs: 0 };

    const issues = [];

    // Detection 1: Multiple messages processing simultaneously (Potential Race Condition)
    const processingEvents = logs.filter(l =>
      l.event_type === 'node_execution' &&
      l.details?.status === 'started'
    );

    if (processingEvents.length > 1) {
      for (let i = 1; i < processingEvents.length; i++) {
          const timeDiff = new Date(processingEvents[i].timestamp).getTime() -
                           new Date(processingEvents[i-1].timestamp).getTime();
          if (timeDiff < 1000) { // Less than 1 second between start of executions
            issues.push({
              type: 'RACE_CONDITION',
              severity: 'CRITICAL',
              description: 'Dos ejecuciones de nodo iniciadas casi simultáneamente',
              events: [processingEvents[i-1], processingEvents[i]]
            });
          }
      }
    }

    // Detection 2: Invalid node jumps (Checking if flow logic is respected)
    const nodeChanges = logs.filter(l => l.event_type === 'node_execution');
    for (let i = 1; i < nodeChanges.length; i++) {
      const prev = nodeChanges[i-1].details?.node_id;
      const curr = nodeChanges[i].details?.node_id;
      const expectedNext = nodeChanges[i-1].details?.next_node_id;

      if (expectedNext && curr !== expectedNext && nodeChanges[i].details?.status === 'started') {
        issues.push({
          type: 'INVALID_NODE_JUMP',
          severity: 'HIGH',
          description: `Salto inválido detectado: ${prev} -> ${curr} (se esperaba: ${expectedNext})`,
          timestamp: nodeChanges[i].timestamp
        });
      }
    }

    return { sessionId, issues, totalLogs: logs.length };
  }

  destroy(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flush();
  }
}

export const sessionAuditor = SessionAuditor.getInstance();
