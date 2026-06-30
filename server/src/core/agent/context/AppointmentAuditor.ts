import { validarTelefonoAR } from '../../../utils/phone-ar';
import { detectArea, type AreaKey } from './AreaDetector';

export type AuditCampo = 'telefono' | 'nombre' | 'motivo' | 'fecha' | 'oficina';

export interface AuditAppointment {
  nombre: string | null;
  telefono: string | null;
  start_time: string | null;
  end_time: string | null;
  oficina: string | null;
  motivo: string | null;
}

export interface AuditInput {
  appointment: AuditAppointment;
  transcript: string;
  channel: string;
  contactPhone: string;
  calificacionPrevia?: Record<string, any> | null;
}

export interface AuditField {
  campo: AuditCampo;
  valor_cita: string | null;
  valor_chat: string | null;
  coincide: boolean;
  confianza: number;
  sugerencia: string | null;
  nota?: string;
  resuelto?: boolean;
}

export interface AuditResult {
  revisar: boolean;
  campos: AuditField[];
  sin_chat: boolean;
  error?: string;
}

export const AUDIT_UMBRAL = 0.6;

const AREA_TO_MOTIVO: Record<AreaKey, string> = {
  jubilacion: 'jubilacion',
  jubilacion_hombre: 'jubilacion',
  jubilacion_mujer: 'jubilacion',
  pension_viudez: 'pension_v',
  laboral: 'laboral',
  art: 'laboral',
  transito: 'otro',
};

export function areaToMotivo(area: AreaKey | null): string | null {
  return area ? (AREA_TO_MOTIVO[area] ?? null) : null;
}

/** Primer número del transcript que valida como teléfono AR (normalizado), o null. */
export function phoneFromTranscript(transcript: string): string | null {
  const matches = transcript.match(/\d[\d\s().-]{6,}\d/g) ?? [];
  for (const m of matches) {
    const v = validarTelefonoAR(m);
    if (v.valido && v.normalizado) return v.normalizado;
  }
  return null;
}

const AUDIT_PROMPT = `Sos un auditor de calidad de un estudio jurídico previsional. Compará los datos de una CITA contra la CONVERSACIÓN real con el cliente.
Para cada campo (nombre, motivo, fecha, oficina) devolvé si COINCIDE con lo que se dijo en el chat.
Reglas DURAS:
- NUNCA inventes. Si el chat NO menciona un dato, devolvé coincide=true y valor_chat=null (no se puede contradecir lo que no se dijo).
- Sugerí un valor SOLO si hay evidencia explícita y clara en el chat.
- confianza 0..1: qué tan seguro estás de la discrepancia.
- motivo válido: jubilacion, puam, pension_v, reajuste, rti, laboral, pension_discapacidad, asesoramiento_pago, otro.
- La fecha de la cita ya está expresada en HORA DE ARGENTINA. Compará el horario real acordado; NO marques discrepancia por diferencias de huso horario, formato o zona (UTC vs -03:00). Solo marcá fecha si el DÍA u HORA acordados en el chat son realmente distintos.
Respondé SOLO JSON: {"campos":[{"campo":"nombre|motivo|fecha|oficina","valor_cita":string|null,"valor_chat":string|null,"coincide":boolean,"confianza":number,"sugerencia":string|null,"nota":string}]}`;

function fmtFechaAR(iso: string | null): string {
  if (!iso) return '(vacío)';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'America/Argentina/Buenos_Aires',
    });
  } catch { return iso; }
}

function buildUserMessage(input: AuditInput): string {
  const a = input.appointment;
  return [
    'CITA:',
    `- nombre: ${a.nombre ?? '(vacío)'}`,
    `- motivo: ${a.motivo ?? '(vacío)'}`,
    `- fecha: ${fmtFechaAR(a.start_time)} (hora Argentina)`,
    `- oficina: ${a.oficina ?? '(vacío)'}`,
    '',
    'CONVERSACIÓN:',
    input.transcript,
  ].join('\n');
}

function normalizeField(raw: any): AuditField | null {
  const campo = raw?.campo;
  if (!['nombre', 'motivo', 'fecha', 'oficina'].includes(campo)) return null;
  return {
    campo,
    valor_cita: raw?.valor_cita ?? null,
    valor_chat: raw?.valor_chat ?? null,
    coincide: raw?.coincide !== false,
    confianza: typeof raw?.confianza === 'number' ? Math.max(0, Math.min(1, raw.confianza)) : 0,
    sugerencia: raw?.sugerencia ?? null,
    nota: typeof raw?.nota === 'string' ? raw.nota : undefined,
  };
}

// Motivos compatibles con cada área detectada. Evita falsos positivos: PUAM,
// reajuste, RTI y pensión por discapacidad son "familia jubilación" y el cliente
// suele decir "jubilarme" igual; no son una discrepancia. Un área que mapea a
// 'otro' (tránsito) es demasiado débil para contradecir el motivo cargado.
const MOTIVO_FAMILIA: Record<string, string[]> = {
  jubilacion: ['jubilacion', 'puam', 'reajuste', 'rti', 'pension_discapacidad'],
  pension_v: ['pension_v'],
  laboral: ['laboral'],
};

function areaCompatibleConMotivo(areaMotivo: string, motivo: string): boolean {
  const fam = MOTIVO_FAMILIA[areaMotivo];
  return fam ? fam.includes(motivo) : true; // área débil (otro) → no flag
}

export class AppointmentAuditor {
  constructor(private deps: { complete: (o: any) => Promise<string> }) {}

  async audit(input: AuditInput): Promise<AuditResult> {
    if (!input.transcript || !input.transcript.trim()) {
      return { sin_chat: true, revisar: false, campos: [] };
    }

    let campos: AuditField[] = [];
    try {
      const raw = await this.deps.complete({
        systemPrompt: AUDIT_PROMPT,
        userMessage: buildUserMessage(input),
        jsonMode: true, temperature: 0, maxTokens: 600, model: 'gpt-4o',
      });
      const parsed = JSON.parse(raw);
      campos = (Array.isArray(parsed?.campos) ? parsed.campos : [])
        .map((f: any) => normalizeField(f))
        .filter((f: AuditField | null): f is AuditField => !!f);
    } catch (e: any) {
      return { sin_chat: false, revisar: false, campos: [], error: String(e?.message ?? e) };
    }

    const tel = this.groundingTelefono(input);
    if (tel) campos = [tel, ...campos.filter((c) => c.campo !== 'telefono')];

    const area = areaToMotivo(detectArea(input.transcript));
    if (area && input.appointment.motivo && !areaCompatibleConMotivo(area, input.appointment.motivo)) {
      const existing = campos.find((c) => c.campo === 'motivo');
      if (!existing || existing.coincide) {
        campos = [
          { campo: 'motivo', valor_cita: input.appointment.motivo, valor_chat: area, coincide: false, confianza: 0.7, sugerencia: area, nota: 'Área detectada en el chat distinta del motivo cargado.' },
          ...campos.filter((c) => c.campo !== 'motivo'),
        ];
      }
    }

    const revisar = campos.some((c) => !c.coincide && c.confianza >= AUDIT_UMBRAL);
    return { sin_chat: false, revisar, campos };
  }

  private groundingTelefono(input: AuditInput): AuditField | null {
    const chatPhone = phoneFromTranscript(input.transcript);
    const apptTel = input.appointment.telefono;
    const apptNorm = apptTel ? (validarTelefonoAR(apptTel).normalizado ?? apptTel) : null;
    const esIdDeRed = input.channel !== 'whatsapp' && !!apptTel && apptTel === input.contactPhone;
    if (chatPhone && (esIdDeRed || (apptNorm && chatPhone !== apptNorm))) {
      return {
        campo: 'telefono', valor_cita: apptTel, valor_chat: chatPhone,
        coincide: false, confianza: esIdDeRed ? 0.95 : 0.8, sugerencia: chatPhone,
        nota: esIdDeRed ? 'La cita tiene el id de la red social, no un teléfono.' : 'El número del chat no coincide con el de la cita.',
      };
    }
    return null;
  }
}
