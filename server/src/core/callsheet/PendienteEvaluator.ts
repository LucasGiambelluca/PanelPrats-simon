// ─── PendienteEvaluator ───────────────────────────────────────────────────────
// Núcleo PURO de la planilla de llamados. Sin DB, sin red, sin reloj.
// Decide si un contacto entra a "Pendientes de llamar" y arma su fila.
// Regla: sin cita coordinada + sin opt_out + teléfono LLAMABLE.
import { validarTelefonoAR } from '../../utils/phone-ar';
import { PhoneUtils } from '../../utils/phoneUtils';

export type Canal = 'whatsapp' | 'facebook' | 'instagram';

export interface ConversationRow {
  id: string;
  account_id: string;
  phone: string;
  channel: Canal | null;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  status: string | null;            // 'BOT' | 'HANDOVER'
  closed_at: string | null;
  close_reason: string | null;
}

// Sólo los campos que consumimos; el resto del jsonb se ignora.
export interface ContactMemoryRow {
  opt_out?: boolean;
  dialogue_state?: { area?: string | null; slots?: Record<string, { valor?: unknown }> } | null;
  calificacion?: Record<string, { resultado?: string }> | null;
  current_thread?: { tema?: string | null; datos_parciales?: Record<string, unknown> } | null;
  last_topic?: string | null;
  last_interaction_at?: string | null;
}

export interface FilaPendiente {
  telefono: string;                 // llamable, normalizado ('54' + 10 díg cuando es AR)
  nombre: string | null;
  canal: Canal;
  area: string | null;
  calificacion: string | null;      // 'gratis' | 'pago' | 'a_confirmar' | ...
  ultimo_mensaje: string | null;
  fecha: string | null;             // ISO del último contacto
  estado: string;                   // 'BOT' | 'HANDOVER' | 'cerrada (<motivo>)'
  tema: string | null;
  conversation_id: string;
  account_id: string;
  llamado: boolean;                 // true si ya lo llamamos (presencia en contactos_llamados)
  llamado_at: string | null;
  llamado_por: string | null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Teléfono que el cliente pasó en el chat (FB/IG), buscado en varios lugares de la memoria. */
function telefonoDesdeMemoria(contact: ContactMemoryRow | null): string | null {
  if (!contact) return null;
  const slot = strOrNull(contact.dialogue_state?.slots?.telefono?.valor);
  if (slot) return slot;
  if (contact.calificacion) {
    for (const entry of Object.values(contact.calificacion)) {
      const t = strOrNull((entry as any)?.datos?.telefono);
      if (t) return t;
    }
  }
  const parcial = strOrNull(contact.current_thread?.datos_parciales?.telefono as unknown);
  return parcial;
}

/** ¿El valor parece un PSID de FB/IG (todo dígitos y largo)? No sirve como nombre. */
function esPsid(v: string): boolean {
  return /^\d{11,}$/.test(v);
}

/** Nombre real del contacto en cualquier canal, nunca el PSID de FB. null si no hay. */
export function nombreLimpio(conversation: ConversationRow, contact: ContactMemoryRow | null): string | null {
  const candidatos: Array<string | null> = [
    strOrNull(conversation.contact_name),
    strOrNull(contact?.dialogue_state?.slots?.nombre?.valor),
  ];
  if (contact?.calificacion) {
    for (const entry of Object.values(contact.calificacion)) {
      candidatos.push(strOrNull((entry as any)?.datos?.nombre));
    }
  }
  candidatos.push(strOrNull(contact?.current_thread?.datos_parciales?.nombre as unknown));
  for (const c of candidatos) {
    if (c && !esPsid(c)) return c;
  }
  return null;
}

/** Teléfono LLAMABLE del contacto, o null si no lo tenemos. */
export function resolveCallablePhone(conversation: ConversationRow, contact: ContactMemoryRow | null): string | null {
  const canal: Canal = (conversation.channel ?? 'whatsapp') as Canal;
  if (canal === 'whatsapp') {
    const v = validarTelefonoAR(conversation.phone);
    if (v.normalizado) return v.normalizado;
    const norm = PhoneUtils.normalize(conversation.phone);
    return norm && /^\d+$/.test(norm) ? norm : null;
  }
  // FB/IG: el phone es el PSID (no llamable). Necesitamos un teléfono real del chat.
  const cand = telefonoDesdeMemoria(contact);
  if (!cand) return null;
  const v = validarTelefonoAR(cand);
  return v.valido ? v.normalizado : null;
}

/** Calificación (resultado) del área vigente, o la primera que haya. */
function pickCalificacion(contact: ContactMemoryRow | null, area: string | null): string | null {
  const cal = contact?.calificacion;
  if (!cal) return null;
  if (area && cal[area]?.resultado) return cal[area]!.resultado!;
  for (const entry of Object.values(cal)) {
    if (entry?.resultado) return entry.resultado;
  }
  return null;
}

export function evaluarPendiente(input: {
  conversation: ConversationRow;
  contact: ContactMemoryRow | null;
  phonesConCita: Set<string>;
}): FilaPendiente | null {
  const { conversation, contact, phonesConCita } = input;
  if (contact?.opt_out === true) return null;

  const telefono = resolveCallablePhone(conversation, contact);
  if (!telefono) return null;
  if (phonesConCita.has(telefono)) return null;

  const canal: Canal = (conversation.channel ?? 'whatsapp') as Canal;
  const area = contact?.dialogue_state?.area ?? null;
  const nombre = nombreLimpio(conversation, contact);
  const estado = conversation.closed_at
    ? `cerrada (${conversation.close_reason ?? 'sin motivo'})`
    : (conversation.status ?? 'BOT');

  return {
    telefono,
    nombre,
    canal,
    area,
    calificacion: pickCalificacion(contact, area),
    ultimo_mensaje: strOrNull(conversation.last_message),
    fecha: conversation.last_message_at ?? contact?.last_interaction_at ?? null,
    estado,
    tema: strOrNull(contact?.last_topic) ?? strOrNull(contact?.current_thread?.tema),
    conversation_id: conversation.id,
    account_id: conversation.account_id,
    llamado: false,
    llamado_at: null,
    llamado_por: null,
  };
}

/** Normaliza un teléfono de appointment para el set de "con cita" (misma clave que resolveCallablePhone). */
export function claveCita(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  const v = validarTelefonoAR(telefono);
  if (v.normalizado) return v.normalizado;
  const norm = PhoneUtils.normalize(telefono);
  return norm && /^\d+$/.test(norm) ? norm : null;
}
