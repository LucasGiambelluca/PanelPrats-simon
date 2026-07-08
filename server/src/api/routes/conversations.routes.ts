import { Router } from 'express';
import { supabase } from '../../config/supabase';
import { redisPersistence } from '../../infrastructure/persistence/RedisPersistenceService';
import { PhoneUtils } from '../../utils/phoneUtils';

// Sufijo de 10 dígitos para matchear teléfonos entre citas y conversaciones:
// las citas pueden venir en formato local ("341 640-3395") y las conversaciones
// guardan el wa_id (549341..., a veces sin el 9). El sufijo iguala todas las formas.
export function phoneSuffix(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 6) return null;
  return digits.slice(-10);
}

// Elige la conversación para un deep-link: la de la cuenta pedida si existe,
// si no la más reciente (las filas ya vienen ordenadas por last_message_at desc).
export function pickConversationForPhone<T extends { account_id: string }>(
  rows: T[], accountId: string | undefined,
): T | null {
  if (rows.length === 0) return null;
  if (accountId) {
    const own = rows.find((c) => c.account_id === accountId);
    if (own) return own;
  }
  return rows[0];
}

export function conversationsRouter(): Router {
  const r = Router();

  // Resuelve teléfono → conversación (deep-link Agenda→chat). Autoritativo contra
  // la DB: el inbox pagina de a 500 y el contacto puede no estar cargado todavía.
  r.get('/find', async (req, res) => {
    const suffix = phoneSuffix(String(req.query.phone ?? ''));
    if (!suffix) return res.status(400).json({ error: 'Teléfono inválido' });
    const accountId = (req.query.account_id as string) || undefined;
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .like('phone', `%${suffix}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(5);
    if (error) return res.status(400).json({ error: error.message });
    const match = pickConversationForPhone(data ?? [], accountId);
    if (!match) return res.status(404).json({ error: 'Sin conversación para ese teléfono' });
    res.json(match);
  });

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    // Paginado: limit (tope 500 por página, PostgREST además capea en 1000) + offset.
    // El inbox pollea solo la primera página y trae las siguientes con "Cargar más".
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ''), 10) || 500, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? ''), 10) || 0, 0);
    // account_id ausente o 'all' => bandeja unificada (todas las líneas del estudio).
    let q = supabase
      .from('whatsapp_conversations')
      .select('*')
      // Desempate estable por id: sin él, dos conversaciones con el mismo
      // last_message_at se reordenan en cada poll (5s) y la lista "salta".
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.get('/:id/messages', async (req, res) => {
    // Traemos los últimos 300 (desc + limit) y los devolvemos en orden ascendente.
    // Evita payloads multi-MB en conversaciones largas polleadas cada 3s.
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('timestamp', { ascending: false })
      .limit(300);
    if (error) return res.status(400).json({ error: error.message });
    res.json((data ?? []).reverse());
  });

  // Handover manual: tomar / liberar
  r.post('/:id/handover', async (req, res) => {
    const resume = !!req.body.resume;
    const status = resume ? 'BOT' : 'HANDOVER';

    const { data: conv } = await supabase
      .from('whatsapp_conversations').select('account_id, phone').eq('id', req.params.id).maybeSingle();

    const { error } = await supabase
      .from('whatsapp_conversations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });

    // Al DEVOLVER al bot: archivar la sesión que quedó en HANDOVER. Si no, findActiveSession
    // (busca active/waiting_input) no la encuentra y el bot queda mudo. Archivarla hace que
    // el próximo mensaje arranque el flujo por defecto limpio → el bot vuelve a responder.
    if (resume && conv) {
      await supabase
        .from('flow_executions')
        .update({ status: 'archived', archived_reason: 'handover_resumed' })
        .eq('account_id', conv.account_id)
        .eq('phone', conv.phone)
        .eq('status', 'HANDOVER');
    }

    res.json({ status });
  });

  // Reiniciar la conversación: el bot "se olvida" del contexto y arranca de cero.
  // Borra memoria persistida + estado efímero + marca un punto de reset (getHistory
  // ignora los mensajes previos). NO borra los mensajes visibles del inbox.
  r.post('/:id/reset', async (req, res) => {
    const { data: conv } = await supabase
      .from('whatsapp_conversations').select('account_id, phone').eq('id', req.params.id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'conversación no encontrada' });

    const acc = conv.account_id as string;
    const phones = PhoneUtils.variants(conv.phone); // matchea con/sin el 9 móvil
    const nowIso = new Date().toISOString();

    try {
      // 1) Olvidar memoria de largo plazo (perfil, resumen, hilo).
      await supabase.from('contact_memory').delete().eq('account_id', acc).in('phone', phones);
      // 2) Archivar la sesión de flujo en curso (si la cuenta usa flows).
      await supabase.from('flow_executions')
        .update({ status: 'archived', archived_reason: 'reset' })
        .eq('account_id', acc).in('phone', phones).in('status', ['active', 'waiting_input', 'HANDOVER']);
      // 3) Volver al bot.
      await supabase.from('whatsapp_conversations')
        .update({ status: 'BOT', updated_at: nowIso }).eq('id', req.params.id);
      // 4) Limpiar estado efímero (booking/offered/checkpoint) y marcar el reset.
      for (const p of phones) {
        await redisPersistence.setRaw(`booking:${acc}:${p}`, '', 1);
        await redisPersistence.setRaw(`offered:${acc}:${p}`, '', 1);
        await redisPersistence.deleteCheckpoint(acc, p);
      }
      // El historial se filtra por este timestamp (getHistory). Una sola key normalizada.
      await redisPersistence.setRaw(`reset:${acc}:${PhoneUtils.normalize(conv.phone)}`, nowIso, 60 * 60 * 24 * 30);

      res.json({ ok: true, reset_at: nowIso });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? 'error al reiniciar' });
    }
  });

  return r;
}
