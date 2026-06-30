# Agente Auditor de Citas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auditor on-demand que compara cada cita de la agenda contra su chat (teléfono, nombre, motivo/área, fecha/oficina), marca discrepancias y deja una corrección aplicable en 1 clic.

**Architecture:** Núcleo puro `AppointmentAuditor` (LLM-juez gpt-4o + grounding determinístico con `validarTelefonoAR`/`detectArea`), alimentado por el transcript completo del chat. Rutas Express persisten el veredicto en `appointments.audit_json`; la Agenda muestra badge y aplica sugerencias reusando el update existente.

**Tech Stack:** Node/Express/TypeScript, Supabase (PostgREST), Vitest, React/Vite. Spec: `docs/superpowers/specs/2026-06-30-auditor-citas-design.md`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0032_appointment_audit.sql` | Columnas `audit_json`, `audit_at` |
| `server/src/core/agent/context/AppointmentAuditor.ts` | Núcleo puro: grounding + LLM-juez → `AuditResult` |
| `server/src/core/agent/context/__tests__/AppointmentAuditor.test.ts` | Tests del núcleo |
| `server/src/services/MessageStore.ts` | `getTranscript(accountId, phone)` |
| `server/src/services/__tests__/MessageStore.transcript.test.ts` | Test del transcript |
| `server/src/services/AppointmentService.ts` | `saveAudit`, `resolveAuditField` |
| `server/src/api/routes/appointments.routes.ts` | `POST /audit`, `POST /:id/audit/apply` |
| `server/src/api/routes/__tests__/appointments.audit.test.ts` | Tests de rutas |
| `client/src/lib/api.ts` | `auditAppointments`, `applyAuditFix` |
| `client/src/pages/Agenda.tsx` | Botón Auditar + badge + sección auditoría |

---

## Task 1: Migración 0032 (audit_json, audit_at)

**Files:**
- Create: `supabase/migrations/0032_appointment_audit.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0032: auditoría de citas. Resultado del auditor (discrepancias + sugerencias)
-- por cita, persistido para mostrar badge "revisar" y aplicar correcciones en 1 clic.
-- Idempotente; filas viejas quedan con audit_json NULL (sin auditar) → sin badge.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS audit_json jsonb,
  ADD COLUMN IF NOT EXISTS audit_at   timestamptz;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0032_appointment_audit.sql
git commit -m "feat(db): migración 0032 — appointments.audit_json/audit_at"
```

> Aplicación en Supabase: la corre el usuario (idempotente). El código degrada con gracia si la columna falta (Task 4 lo cubre).

---

## Task 2: `MessageStore.getTranscript`

Trae la conversación COMPLETA de `(account_id, phone)` como texto "Cliente:/Asistente:". El runtime usa solo 12 mensajes; la auditoría necesita todo.

**Files:**
- Modify: `server/src/services/MessageStore.ts`
- Test: `server/src/services/__tests__/MessageStore.transcript.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows: any[] = [];
vi.mock('../../config/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  },
}));

import { MessageStore } from '../MessageStore';

describe('MessageStore.getTranscript', () => {
  beforeEach(() => { rows.length = 0; });

  it('arma el transcript Cliente/Asistente en orden', async () => {
    rows.push(
      { direction: 'INBOUND', content: 'hola, quiero jubilarme', timestamp: '2026-06-01T10:00:00Z' },
      { direction: 'OUTBOUND', content: '¡Hola! ¿De qué zona sos?', timestamp: '2026-06-01T10:01:00Z' },
      { direction: 'INBOUND', content: 'soy de Lanús', timestamp: '2026-06-01T10:02:00Z' },
    );
    const t = await new MessageStore().getTranscript('acc1', '549111');
    expect(t).toBe('Cliente: hola, quiero jubilarme\nAsistente: ¡Hola! ¿De qué zona sos?\nCliente: soy de Lanús');
  });

  it('devuelve "" si no hay mensajes', async () => {
    const t = await new MessageStore().getTranscript('acc1', 'nadie');
    expect(t).toBe('');
  });
});
```

- [ ] **Step 2: Correr el test → falla**

Run: `cd server && npx vitest run src/services/__tests__/MessageStore.transcript.test.ts`
Expected: FAIL ("getTranscript is not a function").

- [ ] **Step 3: Implementar `getTranscript`**

Agregar el método dentro de `class MessageStore` (después de `getLastInboundAt`):

```ts
  /** Conversación COMPLETA de (account_id, phone) como texto Cliente/Asistente, orden cronológico. */
  async getTranscript(accountId: string, phone: string): Promise<string> {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('direction, content, timestamp')
      .eq('account_id', accountId)
      .eq('phone', phone)
      .order('timestamp', { ascending: true });
    if (error || !data) return '';
    return data
      .filter((m: any) => typeof m.content === 'string' && m.content.trim())
      .map((m: any) => `${m.direction === 'INBOUND' ? 'Cliente' : 'Asistente'}: ${m.content}`)
      .join('\n');
  }
```

- [ ] **Step 4: Correr el test → pasa**

Run: `cd server && npx vitest run src/services/__tests__/MessageStore.transcript.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/MessageStore.ts server/src/services/__tests__/MessageStore.transcript.test.ts
git commit -m "feat(auditor): MessageStore.getTranscript (chat completo por contacto)"
```

---

## Task 3: `AppointmentAuditor` — helpers puros (grounding)

Helpers determinísticos: extraer teléfono del chat y mapear área→motivo. Sin LLM, sin DB.

**Files:**
- Create: `server/src/core/agent/context/AppointmentAuditor.ts`
- Test: `server/src/core/agent/context/__tests__/AppointmentAuditor.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { phoneFromTranscript, areaToMotivo } from '../AppointmentAuditor';

describe('AppointmentAuditor — grounding puro', () => {
  it('phoneFromTranscript: extrae y normaliza el primer número AR válido', () => {
    const t = 'Cliente: mi tel es 11 2345-6789\nAsistente: gracias';
    expect(phoneFromTranscript(t)).toBe('541123456789');
  });

  it('phoneFromTranscript: null si no hay número válido', () => {
    expect(phoneFromTranscript('Cliente: hola\nAsistente: hola')).toBeNull();
  });

  it('areaToMotivo: mapea las áreas del AreaDetector a los motivos de la cita', () => {
    expect(areaToMotivo('jubilacion_mujer')).toBe('jubilacion');
    expect(areaToMotivo('pension_viudez')).toBe('pension_v');
    expect(areaToMotivo('laboral')).toBe('laboral');
    expect(areaToMotivo('art')).toBe('laboral');
    expect(areaToMotivo('transito')).toBe('otro');
    expect(areaToMotivo(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test → falla**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AppointmentAuditor.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Crear el archivo con tipos + helpers**

```ts
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
  channel: string;                 // whatsapp | facebook | instagram
  contactPhone: string;            // phone del contacto (id de red en FB/IG)
  calificacionPrevia?: Record<string, any> | null;
}

export interface AuditField {
  campo: AuditCampo;
  valor_cita: string | null;
  valor_chat: string | null;
  coincide: boolean;
  confianza: number;               // 0..1
  sugerencia: string | null;       // valor propuesto para el campo
  nota?: string;
  resuelto?: boolean;              // true si ya se aplicó la sugerencia
}

export interface AuditResult {
  revisar: boolean;
  campos: AuditField[];
  sin_chat: boolean;
  error?: string;
}

export const AUDIT_UMBRAL = 0.6;

// Mapea las áreas del AreaDetector a los motivos válidos de la cita (enum 0023).
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
```

- [ ] **Step 4: Correr el test → pasa**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AppointmentAuditor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/context/AppointmentAuditor.ts server/src/core/agent/context/__tests__/AppointmentAuditor.test.ts
git commit -m "feat(auditor): tipos + grounding puro (phoneFromTranscript, areaToMotivo)"
```

---

## Task 4: `AppointmentAuditor.audit` (LLM-juez + merge grounding)

**Files:**
- Modify: `server/src/core/agent/context/AppointmentAuditor.ts`
- Test: `server/src/core/agent/context/__tests__/AppointmentAuditor.test.ts`

- [ ] **Step 1: Agregar tests que fallan** (al final del `describe` existente, en un `describe` nuevo)

```ts
import { AppointmentAuditor } from '../AppointmentAuditor';

function fakeAi(json: any) {
  return { complete: async () => JSON.stringify(json) };
}
const baseAppt = {
  nombre: 'Juan Pérez', telefono: '5491133334444',
  start_time: '2026-07-02T13:00:00.000Z', end_time: '2026-07-02T13:30:00.000Z',
  oficina: 'Quilmes', motivo: 'jubilacion',
};

describe('AppointmentAuditor.audit', () => {
  it('sin transcript → sin_chat, sin revisar', async () => {
    const a = new AppointmentAuditor(fakeAi({ campos: [] }));
    const r = await a.audit({ appointment: baseAppt, transcript: '   ', channel: 'whatsapp', contactPhone: '5491133334444' });
    expect(r.sin_chat).toBe(true);
    expect(r.revisar).toBe(false);
  });

  it('todo coincide → revisar=false', async () => {
    const a = new AppointmentAuditor(fakeAi({ campos: [
      { campo: 'nombre', valor_cita: 'Juan Pérez', valor_chat: 'Juan Pérez', coincide: true, confianza: 0.9, sugerencia: null },
      { campo: 'motivo', valor_cita: 'jubilacion', valor_chat: 'jubilación', coincide: true, confianza: 0.9, sugerencia: null },
    ] }));
    const r = await a.audit({ appointment: baseAppt, transcript: 'Cliente: soy Juan Pérez, quiero jubilarme', channel: 'whatsapp', contactPhone: '5491133334444' });
    expect(r.revisar).toBe(false);
  });

  it('FB con telefono = id de red y número real en el chat → discrepancia teléfono (grounding pisa)', async () => {
    // El LLM no marca teléfono; el grounding determinístico sí.
    const a = new AppointmentAuditor(fakeAi({ campos: [] }));
    const r = await a.audit({
      appointment: { ...baseAppt, telefono: '24681012141618' },     // = contactPhone (PSID)
      transcript: 'Cliente: mi WhatsApp es 11 2345-6789',
      channel: 'facebook',
      contactPhone: '24681012141618',
    });
    const tel = r.campos.find(c => c.campo === 'telefono')!;
    expect(tel.coincide).toBe(false);
    expect(tel.sugerencia).toBe('541123456789');
    expect(r.revisar).toBe(true);
  });

  it('IA falla (JSON inválido) → error, sin revisar', async () => {
    const a = new AppointmentAuditor({ complete: async () => 'no soy json' });
    const r = await a.audit({ appointment: baseAppt, transcript: 'Cliente: hola', channel: 'whatsapp', contactPhone: '5491133334444' });
    expect(r.error).toBeTruthy();
    expect(r.revisar).toBe(false);
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AppointmentAuditor.test.ts`
Expected: FAIL (`AppointmentAuditor is not a constructor` / `audit` undefined).

- [ ] **Step 3: Implementar la clase** (agregar al final de `AppointmentAuditor.ts`)

```ts
const AUDIT_PROMPT = `Sos un auditor de calidad de un estudio jurídico previsional. Compará los datos de una CITA contra la CONVERSACIÓN real con el cliente.
Para cada campo (nombre, motivo, fecha, oficina) devolvé si COINCIDE con lo que se dijo en el chat.
Reglas DURAS:
- NUNCA inventes. Si el chat NO menciona un dato, devolvé coincide=true y valor_chat=null (no se puede contradecir lo que no se dijo).
- Sugerí un valor SOLO si hay evidencia explícita y clara en el chat.
- confianza 0..1: qué tan seguro estás de la discrepancia.
- motivo válido: jubilacion, puam, pension_v, reajuste, rti, laboral, pension_discapacidad, asesoramiento_pago, otro.
Respondé SOLO JSON: {"campos":[{"campo":"nombre|motivo|fecha|oficina","valor_cita":string|null,"valor_chat":string|null,"coincide":boolean,"confianza":number,"sugerencia":string|null,"nota":string}]}`;

function buildUserMessage(input: AuditInput): string {
  const a = input.appointment;
  return [
    'CITA:',
    `- nombre: ${a.nombre ?? '(vacío)'}`,
    `- motivo: ${a.motivo ?? '(vacío)'}`,
    `- fecha: ${a.start_time ?? '(vacío)'}`,
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

export class AppointmentAuditor {
  constructor(private deps: { complete: (o: any) => Promise<string> }) {}

  async audit(input: AuditInput): Promise<AuditResult> {
    if (!input.transcript || !input.transcript.trim()) {
      return { sin_chat: true, revisar: false, campos: [] };
    }

    // 1. LLM-juez (gpt-4o, JSON).
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

    // 2. Grounding determinístico de TELÉFONO (pisa al LLM: no audita teléfono).
    const tel = this.groundingTelefono(input);
    if (tel) campos = [tel, ...campos.filter((c) => c.campo !== 'telefono')];

    // 3. Grounding de ÁREA: si el chat tiene un área clara que no mapea al motivo, refuerza.
    const area = areaToMotivo(detectArea(input.transcript));
    if (area && input.appointment.motivo && area !== input.appointment.motivo) {
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

  /** Compara el teléfono de la cita con el número real del chat. null = nada que marcar. */
  private groundingTelefono(input: AuditInput): AuditField | null {
    const chatPhone = phoneFromTranscript(input.transcript);
    const apptTel = input.appointment.telefono;
    const apptNorm = apptTel ? (validarTelefonoAR(apptTel).normalizado ?? apptTel) : null;
    // En FB/IG, telefono == id de red (contactPhone) es discrepancia segura si el chat tiene número.
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
```

- [ ] **Step 4: Correr → pasa**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AppointmentAuditor.test.ts`
Expected: PASS (7 tests: 3 grounding + 4 audit).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/context/AppointmentAuditor.ts server/src/core/agent/context/__tests__/AppointmentAuditor.test.ts
git commit -m "feat(auditor): AppointmentAuditor.audit (LLM-juez gpt-4o + merge grounding)"
```

---

## Task 5: `AppointmentService` — persistir auditoría

Persiste `audit_json`/`audit_at` y marca un campo como resuelto. Update directo (las columnas nuevas NO están en el map de `update()`), degradando con gracia si la columna no existe.

**Files:**
- Modify: `server/src/services/AppointmentService.ts`
- Test: `server/src/services/__tests__/AppointmentService.audit.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: any[] = [];
vi.mock('../../config/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: any) => { calls.push(patch); return { eq: () => Promise.resolve({ error: null }) }; },
    }),
  },
}));

import { AppointmentService } from '../AppointmentService';

describe('AppointmentService.saveAudit', () => {
  beforeEach(() => { calls.length = 0; });

  it('persiste audit_json + audit_at', async () => {
    await AppointmentService.saveAudit('appt1', { revisar: true, campos: [], sin_chat: false } as any);
    expect(calls[0]).toMatchObject({ audit_json: { revisar: true } });
    expect(calls[0].audit_at).toBeTruthy();
  });
});
```

> Nota: `isSupabaseConfigured` se evalúa con las env del entorno de test. Si en tu entorno es false, ajustá el test para setear `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` válidos en un `beforeAll`, o exportá la rama Supabase. Mantené el assert sobre el patch.

- [ ] **Step 2: Correr → falla**

Run: `cd server && npx vitest run src/services/__tests__/AppointmentService.audit.test.ts`
Expected: FAIL (`saveAudit is not a function`).

- [ ] **Step 3: Implementar** (agregar métodos al objeto `AppointmentService`, antes del cierre `}`)

```ts
  /** Persiste el resultado de la auditoría en la cita. Best-effort si la columna no existe (0032 sin aplicar). */
  async saveAudit(id: string, audit: import('../core/agent/context/AppointmentAuditor').AuditResult): Promise<void> {
    if (!isSupabaseConfigured) {
      const a = memoryAppointments.get(id);
      if (a) (a as any).audit_json = audit;
      return;
    }
    const { error } = await supabase
      .from('appointments')
      .update({ audit_json: audit as any, audit_at: new Date().toISOString() })
      .eq('id', id);
    if (error && !/column .*audit_/.test(error.message || '')) throw new Error(error.message);
  },

  /** Marca un campo del audit_json como resuelto (tras aplicar la sugerencia) y recalcula revisar. */
  async resolveAuditField(id: string, campo: string): Promise<void> {
    const appt = await this.getById(id);
    const audit: any = (appt as any)?.audit_json;
    if (!audit || !Array.isArray(audit.campos)) return;
    for (const c of audit.campos) if (c.campo === campo) c.resuelto = true;
    audit.revisar = audit.campos.some((c: any) => !c.coincide && !c.resuelto && (c.confianza ?? 0) >= 0.6);
    await this.saveAudit(id, audit);
  },
```

- [ ] **Step 4: Correr → pasa**

Run: `cd server && npx vitest run src/services/__tests__/AppointmentService.audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/AppointmentService.ts server/src/services/__tests__/AppointmentService.audit.test.ts
git commit -m "feat(auditor): AppointmentService.saveAudit + resolveAuditField"
```

---

## Task 6: Ruta `POST /api/appointments/audit`

Audita un conjunto de citas (cuenta/rango o `ids`), persiste y devuelve resumen. Tope 50 por corrida.

**Files:**
- Modify: `server/src/api/routes/appointments.routes.ts`
- Test: `server/src/api/routes/__tests__/appointments.audit.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../services/AppointmentService', () => ({
  AppointmentService: {
    list: async () => ([{ id: 'a1', account_id: 'acc1', phone: 'PSID1', telefono: 'PSID1', nombre: 'Juan', motivo: 'jubilacion', start_time: '2026-07-02T13:00:00Z', oficina: 'Quilmes' }]),
    getById: async () => ({ id: 'a1', account_id: 'acc1', phone: 'PSID1', telefono: 'PSID1' }),
    saveAudit: vi.fn(async () => {}),
    resolveAuditField: vi.fn(async () => {}),
    update: vi.fn(async () => ({ id: 'a1' })),
  },
}));
vi.mock('../../../services/MessageStore', () => ({
  messageStore: { getTranscript: async () => 'Cliente: mi tel es 11 2345-6789' },
}));
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { channel: 'facebook' }, error: null }) }) }) }) },
}));
// AppointmentAuditor real, pero con AI mockeada vía AIService.
vi.mock('../../../services/AIService', () => ({
  AIService: { complete: async () => JSON.stringify({ campos: [] }) },
}));

import { appointmentsRouter } from '../appointments.routes';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _r, n) => { req.user = { id: 'u1', role: 'admin' }; n(); });
  a.use('/api/appointments', appointmentsRouter());
  return a;
}

describe('POST /api/appointments/audit', () => {
  it('audita las citas y devuelve resumen', async () => {
    const res = await request(app()).post('/api/appointments/audit').send({ account_id: 'acc1' });
    expect(res.status).toBe(200);
    expect(res.body.audited).toBe(1);
    expect(res.body.flagged).toBeGreaterThanOrEqual(1); // teléfono = id de red FB
  });
});
```

> Verificá que `supertest` esté instalado en `server` (`npx vitest` ya está). Si falta: `cd server && npm i -D supertest @types/supertest`. Revisá primero si otros tests de rutas ya lo usan.

- [ ] **Step 2: Correr → falla**

Run: `cd server && npx vitest run src/api/routes/__tests__/appointments.audit.test.ts`
Expected: FAIL (404 / ruta inexistente).

- [ ] **Step 3: Implementar la ruta**

En `appointments.routes.ts`, agregar imports arriba:

```ts
import { AppointmentAuditor, type AuditInput } from '../../core/agent/context/AppointmentAuditor';
import { messageStore } from '../../services/MessageStore';
import { AIService } from '../../services/AIService';
import { supabase } from '../../config/supabase';
```

Dentro de `appointmentsRouter()`, antes de `return r;`:

```ts
  const auditor = new AppointmentAuditor({ complete: (o) => AIService.complete(o) });
  const AUDIT_MAX = 50;

  // Audita las citas (account_id+rango, o ids puntuales). Persiste audit_json.
  r.post('/audit', requireRole('empleada'), async (req, res) => {
    try {
      const { account_id, ids } = req.body || {};
      let citas = await AppointmentService.list(account_id && account_id !== 'all' ? account_id : undefined);
      if (Array.isArray(ids) && ids.length) citas = citas.filter((c) => ids.includes(c.id));
      const truncated = citas.length > AUDIT_MAX;
      citas = citas.slice(0, AUDIT_MAX);

      let flagged = 0; let errored = 0;
      const results: any[] = [];
      for (const c of citas) {
        const transcript = await messageStore.getTranscript(c.account_id, c.phone).catch(() => '');
        // Canal de la cuenta (FB/IG vs WhatsApp) para el grounding del teléfono.
        let channel = 'whatsapp';
        try {
          const { data } = await supabase.from('accounts').select('channel').eq('id', c.account_id).maybeSingle();
          channel = (data as any)?.channel || 'whatsapp';
        } catch { /* default whatsapp */ }

        const input: AuditInput = {
          appointment: { nombre: c.nombre ?? null, telefono: c.telefono ?? null, start_time: c.start_time ?? null, end_time: c.end_time ?? null, oficina: c.oficina ?? null, motivo: (c.motivo as any) ?? null },
          transcript, channel, contactPhone: c.phone,
        };
        const result = await auditor.audit(input);
        if (result.error) errored++;
        if (result.revisar) flagged++;
        await AppointmentService.saveAudit(c.id, result).catch(() => {});
        results.push({ id: c.id, revisar: result.revisar, sin_chat: result.sin_chat, campos: result.campos });
      }

      res.json({ audited: citas.length, flagged, errored, truncated, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Correr → pasa**

Run: `cd server && npx vitest run src/api/routes/__tests__/appointments.audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes/appointments.routes.ts server/src/api/routes/__tests__/appointments.audit.test.ts
git commit -m "feat(auditor): POST /api/appointments/audit (audita lote + persiste)"
```

---

## Task 7: Ruta `POST /api/appointments/:id/audit/apply`

Aplica la sugerencia de un campo a la cita real (reusa `update`), valida teléfono, marca resuelto.

**Files:**
- Modify: `server/src/api/routes/appointments.routes.ts`
- Test: `server/src/api/routes/__tests__/appointments.audit.test.ts` (extiende)

- [ ] **Step 1: Agregar test que falla**

```ts
// Dentro del mismo archivo de test. Ajustá el mock de getById para incluir audit_json.
describe('POST /api/appointments/:id/audit/apply', () => {
  it('aplica la sugerencia de teléfono y marca resuelto', async () => {
    const { AppointmentService } = await import('../../../services/AppointmentService');
    (AppointmentService.getById as any) = async () => ({
      id: 'a1', account_id: 'acc1', phone: 'PSID1', telefono: 'PSID1',
      audit_json: { revisar: true, campos: [{ campo: 'telefono', coincide: false, confianza: 0.95, sugerencia: '541123456789' }] },
    });
    const res = await request(app()).post('/api/appointments/a1/audit/apply').send({ campo: 'telefono' });
    expect(res.status).toBe(200);
    expect(AppointmentService.update).toHaveBeenCalledWith('a1', { telefono: '541123456789' });
    expect(AppointmentService.resolveAuditField).toHaveBeenCalledWith('a1', 'telefono');
  });

  it('rechaza teléfono sugerido inválido con 400', async () => {
    const { AppointmentService } = await import('../../../services/AppointmentService');
    (AppointmentService.getById as any) = async () => ({
      id: 'a1', account_id: 'acc1', phone: 'PSID1',
      audit_json: { campos: [{ campo: 'telefono', coincide: false, confianza: 0.9, sugerencia: 'no-numero' }] },
    });
    const res = await request(app()).post('/api/appointments/a1/audit/apply').send({ campo: 'telefono' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `cd server && npx vitest run src/api/routes/__tests__/appointments.audit.test.ts`
Expected: FAIL (404 en apply).

- [ ] **Step 3: Implementar la ruta** (en `appointmentsRouter()`, tras la de `/audit`)

Agregar import del validador arriba del archivo:

```ts
import { validarTelefonoAR } from '../../utils/phone-ar';
```

Ruta:

```ts
  // Mapea el campo del audit a la columna real de la cita.
  const AUDIT_FIELD_TO_COL: Record<string, 'telefono' | 'nombre' | 'motivo' | 'oficina'> = {
    telefono: 'telefono', nombre: 'nombre', motivo: 'motivo', oficina: 'oficina',
  };

  r.post('/:id/audit/apply', requireRole('empleada'), async (req, res) => {
    try {
      const { campo } = req.body || {};
      const col = AUDIT_FIELD_TO_COL[campo];
      if (!col) return res.status(400).json({ error: 'Campo no aplicable' });

      const appt: any = await AppointmentService.getById(req.params.id);
      if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
      const field = appt.audit_json?.campos?.find((c: any) => c.campo === campo);
      if (!field || field.sugerencia == null) return res.status(400).json({ error: 'No hay sugerencia para ese campo' });

      let valor = String(field.sugerencia);
      if (col === 'telefono') {
        const v = validarTelefonoAR(valor);
        if (!v.valido || !v.normalizado) return res.status(400).json({ error: 'La sugerencia de teléfono no es un número válido' });
        valor = v.normalizado;
      }

      const updated = await AppointmentService.update(req.params.id, { [col]: valor } as any);
      await AppointmentService.resolveAuditField(req.params.id, campo).catch(() => {});
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Correr → pasa**

Run: `cd server && npx vitest run src/api/routes/__tests__/appointments.audit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verificación global del server (typecheck + suites tocadas)**

Run: `cd server && npx tsc --noEmit && npx vitest run src/core/agent src/services src/api/routes`
Expected: tsc EXIT 0; todas las suites PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/appointments.routes.ts server/src/api/routes/__tests__/appointments.audit.test.ts
git commit -m "feat(auditor): POST /:id/audit/apply (aplica sugerencia + valida tel)"
```

---

## Task 8: Frontend — API client

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Agregar el tipo y los métodos**

En `client/src/lib/api.ts`, junto al objeto `appointmentsApi` (donde están `update`/`create`/`delete`):

```ts
export interface AuditField {
  campo: 'telefono' | 'nombre' | 'motivo' | 'fecha' | 'oficina';
  valor_cita: string | null;
  valor_chat: string | null;
  coincide: boolean;
  confianza: number;
  sugerencia: string | null;
  nota?: string;
  resuelto?: boolean;
}
export interface AuditResultDTO { revisar: boolean; campos: AuditField[]; sin_chat: boolean; error?: string }
```

Dentro de `appointmentsApi` (antes del cierre `};`):

```ts
  audit: (body: { account_id?: string; ids?: string[] }) =>
    api<{ audited: number; flagged: number; errored: number; truncated: boolean; results: Array<{ id: string } & AuditResultDTO> }>(
      '/api/appointments/audit',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  applyAuditFix: (id: string, campo: string) =>
    api<Appointment>(`/api/appointments/${id}/audit/apply`, {
      method: 'POST', body: JSON.stringify({ campo }),
    }),
```

- [ ] **Step 2: Typecheck del client**

Run: `cd client && npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(auditor): client api — auditAppointments + applyAuditFix"
```

---

## Task 9: Frontend — botón Auditar + badge + sección en el modal

**Files:**
- Modify: `client/src/pages/Agenda.tsx`

> Sin test automatizado (UI). Verificación manual al final.

- [ ] **Step 1: Estado y handler de auditoría**

Cerca de los otros `useState` del componente `Agenda`:

```tsx
const [auditing, setAuditing] = useState(false);

const runAudit = async () => {
  setAuditing(true);
  try {
    const r = await appointmentsApi.audit({ account_id: activeAccountId || undefined });
    toast.success(`Auditadas ${r.audited}: ${r.flagged} para revisar${r.truncated ? ' (se auditaron las primeras 50)' : ''}`);
    loadAppointments(true);
  } catch (err: any) {
    toast.error('Error al auditar: ' + err.message);
  } finally {
    setAuditing(false);
  }
};
```

- [ ] **Step 2: Botón en la barra de la Agenda**

Junto a los controles de cabecera (cerca del selector de cuenta / botón de nueva cita):

```tsx
<button onClick={runAudit} disabled={auditing}
  className="px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50">
  {auditing ? 'Auditando…' : '🔍 Auditar'}
</button>
```

- [ ] **Step 3: Badge "⚠ revisar" en la cita**

Donde se renderiza cada cita (grilla/lista), agregar junto al nombre/estado:

```tsx
{(app as any).audit_json?.revisar && (
  <span title="Datos a revisar contra el chat" className="ml-1 text-amber-600 text-xs font-semibold">⚠ revisar</span>
)}
```

- [ ] **Step 4: Sección "Auditoría" en el modal de la cita**

Dentro del modal de detalle (`selectedApp`), tras la ficha de recepción:

```tsx
{selectedApp && (selectedApp as any).audit_json?.campos?.some((c: any) => !c.coincide && !c.resuelto) && (
  <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
    <div className="font-semibold text-amber-800 mb-2">⚠ Auditoría: datos a revisar</div>
    {(selectedApp as any).audit_json.campos
      .filter((c: any) => !c.coincide && !c.resuelto && c.sugerencia)
      .map((c: any) => (
        <div key={c.campo} className="flex items-center justify-between gap-2 py-1 text-sm">
          <div>
            <b>{c.campo}</b>: <span className="line-through text-gray-500">{c.valor_cita ?? '—'}</span>{' '}
            → <span className="text-emerald-700">{c.sugerencia}</span>
            {c.nota && <div className="text-xs text-gray-500">{c.nota}</div>}
          </div>
          <button
            onClick={async () => {
              try { await appointmentsApi.applyAuditFix(selectedApp.id, c.campo); toast.success('Aplicado'); loadAppointments(true); setIsModalOpen(false); }
              catch (err: any) { toast.error(err.message); }
            }}
            className="px-2 py-1 rounded bg-emerald-600 text-white text-xs whitespace-nowrap">
            Aplicar
          </button>
        </div>
      ))}
  </div>
)}
```

> Ajustá nombres de clases/posición al estilo real del archivo (mirá cómo se renderizan las otras secciones del modal y la grilla antes de pegar). `activeAccountId`, `loadAppointments`, `selectedApp`, `setIsModalOpen`, `toast` ya existen en el archivo.

- [ ] **Step 5: Typecheck del client**

Run: `cd client && npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Agenda.tsx
git commit -m "feat(auditor): Agenda — botón Auditar, badge revisar, aplicar sugerencia"
```

---

## Task 10: Verificación final

- [ ] **Step 1: Suite completa del server**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: tsc EXIT 0; todos los tests PASS.

- [ ] **Step 2: Typecheck del client**

Run: `cd client && npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Verificación manual (tras aplicar migración 0032 y deploy)**

1. Aplicar `0032_appointment_audit.sql` en Supabase.
2. En la Agenda, apretar **🔍 Auditar** → toast con resumen.
3. Una cita de FB/IG con teléfono = id de red y número en el chat debe mostrar **⚠ revisar**.
4. Abrir la cita → sección Auditoría muestra `telefono: <id> → <número del chat>` → **Aplicar** → la cita queda con el número real y el badge desaparece.

---

## Notas de implementación

- **Orden:** Tasks 1→10 en orden. Cada una compila y testea sola.
- **Migración 0032:** la aplica el usuario en Supabase; el código degrada con gracia si falta (`saveAudit` ignora el error de columna ausente).
- **Costo LLM:** 1 llamada gpt-4o por cita; tope 50/corrida; on-demand. El resumen informa `truncated`.
- **Reuso:** `validarTelefonoAR`, `detectArea`, `AppointmentService.update` (el mismo PUT ya arreglado), `AIService.complete`.
- **`phone` vs `telefono`:** `phone` (clave de conversación / id de red) NUNCA se toca; el auditor solo corrige `telefono`, `nombre`, `motivo`, `oficina`.
