import { Router } from 'express';
import { supabase } from '../../config/supabase';
import {
  evaluarPendiente, claveCita,
  type ConversationRow, type ContactMemoryRow, type FilaPendiente,
} from '../../core/callsheet/PendienteEvaluator';

// Trae TODAS las filas de una tabla en bloques (Supabase corta en ~1000 por request).
async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// PURO: junta conversaciones + memoria + citas → filas dedup. Testeable sin DB.
export function armarPendientes(
  conversations: ConversationRow[],
  contactsByConvId: Map<string, ContactMemoryRow>,
  appointments: Array<{ phone: string | null; telefono: string | null }>,
  llamados: Map<string, { llamado_at: string; llamado_por: string | null }> = new Map(),
): FilaPendiente[] {
  const phonesConCita = new Set<string>();
  for (const a of appointments) {
    const k1 = claveCita(a.phone); if (k1) phonesConCita.add(k1);
    const k2 = claveCita(a.telefono); if (k2) phonesConCita.add(k2);
  }
  const vistos = new Set<string>();
  const filas: FilaPendiente[] = [];
  for (const c of conversations) {
    const fila = evaluarPendiente({ conversation: c, contact: contactsByConvId.get(c.id) ?? null, phonesConCita });
    if (!fila) continue;
    if (vistos.has(fila.telefono)) continue;   // dedup por teléfono llamable (arrastra fix @lid)
    vistos.add(fila.telefono);
    const hit = llamados.get(`${fila.account_id}|${fila.telefono}`);
    if (hit) { fila.llamado = true; fila.llamado_at = hit.llamado_at; fila.llamado_por = hit.llamado_por; }
    filas.push(fila);
  }
  return filas;
}

const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export function pendientesRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    try {
      const accountId = req.query.account_id as string | undefined;
      const range = (req.query.range as string) || 'all';

      // 1) Conversaciones (todas, paginadas).
      const conversations = await fetchAll<ConversationRow>((from, to) => {
        let q = supabase
          .from('whatsapp_conversations')
          .select('id, account_id, phone, channel, contact_name, last_message, last_message_at, status, closed_at, close_reason')
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);
        return q;
      });

      // 2) contact_memory (todas, paginadas) → mapa por (account_id, phone).
      const memRows = await fetchAll<any>((from, to) => {
        let q = supabase
          .from('contact_memory')
          .select('account_id, phone, opt_out, dialogue_state, calificacion, current_thread, last_topic, last_interaction_at')
          .order('account_id', { ascending: true })
          .order('phone', { ascending: true })
          .range(from, to);
        if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);
        return q;
      });
      const memByKey = new Map<string, ContactMemoryRow>();
      for (const m of memRows) memByKey.set(`${m.account_id}|${m.phone}`, m as ContactMemoryRow);
      const contactsByConvId = new Map<string, ContactMemoryRow>();
      for (const c of conversations) {
        const m = memByKey.get(`${c.account_id}|${c.phone}`);
        if (m) contactsByConvId.set(c.id, m);
      }

      // 3) appointments (phone + telefono) → set de teléfonos con cita.
      const appointments = await fetchAll<{ phone: string | null; telefono: string | null }>((from, to) => {
        let q = supabase.from('appointments').select('phone, telefono')
          .order('id', { ascending: true })
          .range(from, to);
        if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);
        return q;
      });

      let filas = armarPendientes(conversations, contactsByConvId, appointments);

      // 4) Filtro de rango temporal (sobre fecha del último contacto).
      const days = RANGE_DAYS[range];
      if (days) {
        const corteMs = Date.now() - days * 24 * 60 * 60 * 1000;
        filas = filas.filter((f) => f.fecha != null && Date.parse(f.fecha) >= corteMs);
      }

      res.json({ total: filas.length, filas });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? 'error' });
    }
  });

  return r;
}
