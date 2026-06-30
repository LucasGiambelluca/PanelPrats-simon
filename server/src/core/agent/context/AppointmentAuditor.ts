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
