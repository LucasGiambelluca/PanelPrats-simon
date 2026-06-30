import { supabase } from '../../../config/supabase';
import { AppointmentService } from '../../../services/AppointmentService';
import type { ContactFicha } from './types';
import type { AreaKey } from '../context/AreaDetector';

// Merge incremental: agrega/actualiza solo con valores no-nulos (nunca borra).
export function mergeProfile(prev: Record<string, any>, next: Record<string, any>): Record<string, any> {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next ?? {})) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

// Arma la línea compacta "FICHA" para el prompt. Tolera datos faltantes.
export function buildFichaText(
  profile: Record<string, any>,
  preferences: Record<string, any>,
  summary: string | null,
  proximaCita: string | null,
): string {
  const parts: string[] = [];
  const nombre = profile?.nombre;
  const edad = profile?.edad;
  if (nombre || edad) parts.push([nombre, edad].filter(Boolean).join(', '));
  if (profile?.situacion_previsional) parts.push(String(profile.situacion_previsional));
  if (summary) parts.push(summary);
  if (proximaCita) parts.push(`Próxima cita: ${proximaCita}`);
  if (preferences?.horario_preferido) parts.push(`Prefiere ${preferences.horario_preferido}`);
  return parts.length ? `FICHA: ${parts.join('. ')}.` : 'FICHA: (contacto nuevo, sin datos previos).';
}

const AREA_LABEL: Record<string, string> = {
  jubilacion_hombre: 'Jubilación Hombre', jubilacion_mujer: 'Jubilación Mujer',
  jubilacion: 'Jubilación', pension_viudez: 'Pensión por viudez',
  laboral: 'Laboral / Despido', art: 'ART', transito: 'Accidente de tránsito',
};
const RESULTADO_LABEL: Record<string, string> = {
  gratis: 'VIABLE consulta gratis', pago: 'análisis previsional pago ($29.000)', descartar: 'no viable',
};

/**
 * Bloque "CALIFICACIÓN PREVIA" para la ficha. Renderiza SOLO las entradas vigentes
 * (now - calificado_at <= ttlDays). Si el mensaje trae área, prioriza esa; si no,
 * todas las frescas. Función pura (testeable sin DB).
 */
export function buildCalificacionFicha(
  calificacion: Record<string, any> | null | undefined,
  area: AreaKey | null,
  ttlDays: number,
  now: number,
): string {
  if (!calificacion || typeof calificacion !== 'object') return '';
  const ttlMs = ttlDays * 86400000;
  const keys = area && calificacion[area] ? [area] : Object.keys(calificacion);
  const lines: string[] = [];
  for (const k of keys) {
    const e = calificacion[k];
    if (!e?.calificado_at || !e?.resultado) continue;
    const ageMs = now - new Date(e.calificado_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > ttlMs) continue; // vencida o fecha inválida → recalificar
    const dias = Math.max(0, Math.floor(ageMs / 86400000));
    const d = e.datos ?? {};
    const datos = [
      d.edad != null ? `${d.edad} años` : null,
      d.hijos != null ? `${d.hijos} hijos` : null,
      d.aportes_aprox != null ? `~${d.aportes_aprox} años aportes` : null,
    ].filter(Boolean).join(', ');
    lines.push(`${AREA_LABEL[k] ?? k}: ${RESULTADO_LABEL[e.resultado] ?? e.resultado}${datos ? ` (${datos})` : ''}, calificó hace ${dias} día${dias === 1 ? '' : 's'}`);
  }
  if (!lines.length) return '';
  return `CALIFICACIÓN PREVIA — no re-preguntes lo ya sabido; ofrecé agendar (o el análisis pago) según el resultado:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

export class ContactMemory {
  /** Carga la memoria del contacto + próxima cita; arma la ficha lista para el prompt. */
  async load(accountId: string, phone: string): Promise<ContactFicha> {
    const { data } = await supabase
      .from('contact_memory').select('profile, preferences, long_term_summary, calificacion')
      .eq('account_id', accountId).eq('phone', phone).maybeSingle();

    const profile = (data?.profile ?? {}) as Record<string, any>;
    const preferences = (data?.preferences ?? {}) as Record<string, any>;
    const summary = (data?.long_term_summary ?? null) as string | null;
    const calificacion = ((data as any)?.calificacion ?? null) as Record<string, any> | null;

    let proximaCita: string | null = null;
    try {
      const appts = await AppointmentService.list(accountId);
      const now = Date.now();
      const next = appts
        .filter((a) => a.phone === phone && a.status !== 'cancelada' && a.start_time && new Date(a.start_time).getTime() > now)
        .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())[0];
      if (next?.start_time) {
        proximaCita = new Date(next.start_time).toLocaleString('es-AR', {
          weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          hour12: false, timeZone: 'America/Argentina/Buenos_Aires',
        });
      }
    } catch { /* sin agenda disponible: ficha sin próxima cita */ }

    return { profile, preferences, summary, calificacion, fichaText: buildFichaText(profile, preferences, summary, proximaCita) };
  }

  /**
   * Carga extendida con el hilo (columnas 0024). Para el ConversationContextLoader.
   * Tolerante a esquemas viejos: si las columnas no existen, cae a load() básico.
   */
  async loadExtended(accountId: string, phone: string): Promise<{
    profile: Record<string, any>; preferences: Record<string, any>; summary: string | null;
    lastInteractionAt: Date | null; lastTopic: string | null; currentThread: any;
  }> {
    try {
      const { data } = await supabase
        .from('contact_memory')
        .select('profile, preferences, long_term_summary, last_interaction_at, last_topic, current_thread')
        .eq('account_id', accountId).eq('phone', phone).maybeSingle();
      return {
        profile: (data?.profile ?? {}) as any,
        preferences: (data?.preferences ?? {}) as any,
        summary: (data?.long_term_summary ?? null) as any,
        lastInteractionAt: data?.last_interaction_at ? new Date(data.last_interaction_at as any) : null,
        lastTopic: (data?.last_topic ?? null) as any,
        currentThread: (data?.current_thread ?? null) as any,
      };
    } catch {
      const basic = await this.load(accountId, phone);
      return { profile: basic.profile, preferences: basic.preferences, summary: basic.summary, lastInteractionAt: null, lastTopic: null, currentThread: null };
    }
  }

  /** Persiste el puntero de hilo + toca last_interaction_at. Best-effort. */
  async saveThread(accountId: string, phone: string, patch: { lastTopic?: string | null; currentThread?: any }): Promise<void> {
    try {
      await supabase.from('contact_memory').upsert({
        account_id: accountId, phone,
        last_topic: patch.lastTopic ?? null,
        current_thread: patch.currentThread ?? null,
        last_interaction_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id,phone' });
    } catch (e: any) {
      console.warn(`[ContactMemory] saveThread error for ${phone}:`, e?.message || e);
    }
  }

  /**
   * Estado del LoopGuard por contacto (columna loop_guard_state, migración 0029).
   * Tolerante a esquemas viejos: si la columna no existe, devuelve null.
   */
  async loadLoopGuardState(accountId: string, phone: string): Promise<{ calls: number[]; replies: string[] } | null> {
    try {
      const { data } = await supabase
        .from('contact_memory').select('loop_guard_state')
        .eq('account_id', accountId).eq('phone', phone).maybeSingle();
      const s = (data as any)?.loop_guard_state;
      if (!s || typeof s !== 'object') return null;
      return { calls: Array.isArray(s.calls) ? s.calls : [], replies: Array.isArray(s.replies) ? s.replies : [] };
    } catch {
      return null;
    }
  }

  /** Persiste el estado del LoopGuard. Best-effort (no rompe la respuesta si falla). */
  async saveLoopGuardState(accountId: string, phone: string, state: { calls: number[]; replies: string[] }): Promise<void> {
    try {
      await supabase.from('contact_memory').upsert({
        account_id: accountId, phone,
        loop_guard_state: state,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id,phone' });
    } catch (e: any) {
      console.warn(`[ContactMemory] saveLoopGuardState error for ${phone}:`, e?.message || e);
    }
  }

  /** Mergea la calificación de UN área en el mapa contact_memory.calificacion. Best-effort. */
  async setCalificacion(
    accountId: string, phone: string, area: string,
    entry: { resultado: string; datos: Record<string, any>; calificado_at: string },
  ): Promise<void> {
    try {
      const { data } = await supabase
        .from('contact_memory').select('calificacion')
        .eq('account_id', accountId).eq('phone', phone).maybeSingle();
      const prev = ((data as any)?.calificacion ?? {}) as Record<string, any>;
      const next = { ...prev, [area]: entry };
      await supabase.from('contact_memory').upsert({
        account_id: accountId, phone, calificacion: next,
        last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id,phone' });
    } catch (e: any) {
      console.warn(`[ContactMemory] setCalificacion error for ${phone}:`, e?.message || e);
    }
  }

  /** Mergea perfil/preferencias y reescribe el resumen. Upsert por (account_id, phone). */
  async merge(accountId: string, phone: string, patch: {
    profile?: Record<string, any>; preferences?: Record<string, any>; summary?: string | null;
  }): Promise<void> {
    const { data } = await supabase
      .from('contact_memory').select('profile, preferences, long_term_summary, last_summary_at')
      .eq('account_id', accountId).eq('phone', phone).maybeSingle();

    const profile = mergeProfile((data?.profile ?? {}) as any, patch.profile ?? {});
    const preferences = mergeProfile((data?.preferences ?? {}) as any, patch.preferences ?? {});

    await supabase.from('contact_memory').upsert({
      account_id: accountId, phone,
      profile, preferences,
      long_term_summary: patch.summary ?? (data?.long_term_summary as any) ?? null,
      last_summary_at: patch.summary ? new Date().toISOString() : ((data?.last_summary_at as any) ?? null),
      // toca la última interacción para la detección de "contacto que vuelve" (0024).
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,phone' });
  }
}
