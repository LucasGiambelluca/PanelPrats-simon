import { supabase } from '../../../config/supabase';
import { AppointmentService } from '../../../services/AppointmentService';
import type { ContactFicha } from './types';

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

export class ContactMemory {
  /** Carga la memoria del contacto + próxima cita; arma la ficha lista para el prompt. */
  async load(accountId: string, phone: string): Promise<ContactFicha> {
    const { data } = await supabase
      .from('contact_memory').select('profile, preferences, long_term_summary')
      .eq('account_id', accountId).eq('phone', phone).maybeSingle();

    const profile = (data?.profile ?? {}) as Record<string, any>;
    const preferences = (data?.preferences ?? {}) as Record<string, any>;
    const summary = (data?.long_term_summary ?? null) as string | null;

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

    return { profile, preferences, summary, fichaText: buildFichaText(profile, preferences, summary, proximaCita) };
  }

  /** Mergea perfil/preferencias y reescribe el resumen. Upsert por (account_id, phone). */
  async merge(accountId: string, phone: string, patch: {
    profile?: Record<string, any>; preferences?: Record<string, any>; summary?: string | null;
  }): Promise<void> {
    const { data } = await supabase
      .from('contact_memory').select('profile, preferences, long_term_summary')
      .eq('account_id', accountId).eq('phone', phone).maybeSingle();

    const profile = mergeProfile((data?.profile ?? {}) as any, patch.profile ?? {});
    const preferences = mergeProfile((data?.preferences ?? {}) as any, patch.preferences ?? {});

    await supabase.from('contact_memory').upsert({
      account_id: accountId, phone,
      profile, preferences,
      long_term_summary: patch.summary ?? (data?.long_term_summary as any) ?? null,
      last_summary_at: patch.summary ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,phone' });
  }
}
