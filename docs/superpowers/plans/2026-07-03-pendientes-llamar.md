# Apartado "Pendientes de llamar" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una planilla (página + export CSV) con TODOS los contactos cuya conversación quedó trunca (nunca coordinaron reunión) y de los que tenemos teléfono llamable, para el llamado de recupero.

**Architecture:** Núcleo puro y testeable (`PendienteEvaluator`) que decide elegibilidad + teléfono llamable por canal; un endpoint que trae en vivo todas las conversaciones + citas + memoria y arma las filas; una página React con tabla filtrable + Exportar CSV. Sin migración (lee tablas existentes). Sin dependencia nueva (CSV a mano).

**Tech Stack:** Node/TypeScript/Express, Supabase JS, vitest (server). React/Vite/TS + Tailwind (client). Tests server: `cd server && npx vitest run <ruta>`. Spec: `docs/superpowers/specs/2026-07-03-pendientes-llamar-design.md`.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `server/src/core/callsheet/PendienteEvaluator.ts` | **Nuevo** — puro: tipos + `resolveCallablePhone` + `evaluarPendiente` (toda la lógica de negocio) |
| `server/src/core/callsheet/__tests__/PendienteEvaluator.test.ts` | **Nuevo** — tests unitarios del núcleo |
| `server/src/api/routes/pendientes.routes.ts` | **Nuevo** — `GET /` trae datos, arma filas, dedup |
| `server/src/api/app.ts` | Montar `pendientesRouter` (auth, sin requireRole → empleadas + admin) |
| `client/src/lib/api.ts` | `pendientesApi` + tipos `FilaPendiente`/`PendientesResponse` |
| `client/src/pages/PendientesLlamar.tsx` | **Nuevo** — tabla + filtros + Exportar CSV |
| `client/src/App.tsx` | Ruta `/pendientes-llamar` (fuera del gate admin) |
| `client/src/components/Layout.tsx` | Item de sidebar (roles admin + empleada) |

Tipos compartidos por forma (no import cross-package): `FilaPendiente` se define en el server (`PendienteEvaluator.ts`) y se re-declara idéntico en `client/src/lib/api.ts`.

---

### Task 1: Núcleo `PendienteEvaluator` (puro, TDD)

**Files:**
- Create: `server/src/core/callsheet/PendienteEvaluator.ts`
- Test: `server/src/core/callsheet/__tests__/PendienteEvaluator.test.ts`

- [ ] **Step 1: Test que falla**

Create `server/src/core/callsheet/__tests__/PendienteEvaluator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { evaluarPendiente, resolveCallablePhone, type ConversationRow, type ContactMemoryRow } from '../PendienteEvaluator';

const baseConv = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: 'c1', account_id: 'a1', phone: '5492215093499', channel: 'whatsapp',
  contact_name: 'Juan Perez', last_message: 'gracias', last_message_at: '2026-07-01T12:00:00.000Z',
  status: 'BOT', closed_at: null, close_reason: null, ...over,
});

describe('resolveCallablePhone', () => {
  it('WhatsApp: teléfono real AR → normalizado 54+10', () => {
    // 221 (La Plata) + 5093499 = 2215093499 (10 díg) → '542215093499'
    const r = resolveCallablePhone(baseConv({ phone: '5492215093499' }), null);
    expect(r).toBe('542215093499');
  });
  it('WhatsApp con phone no-AR igual devuelve algo llamable (fallback normalize)', () => {
    const r = resolveCallablePhone(baseConv({ phone: '123' }), null);
    expect(r).toBe('123');
  });
  it('FB/IG sin teléfono en la memoria → null (PSID no es llamable)', () => {
    const conv = baseConv({ channel: 'facebook', phone: '27998877665544' });
    expect(resolveCallablePhone(conv, null)).toBeNull();
  });
  it('FB/IG con teléfono real en slot telefono → normalizado', () => {
    const conv = baseConv({ channel: 'instagram', phone: '27998877665544' });
    const contact: ContactMemoryRow = { dialogue_state: { slots: { telefono: { valor: '011 4785-9600' } } } } as any;
    expect(resolveCallablePhone(conv, contact)).toBe('541147859600');
  });
  it('FB/IG con teléfono inválido en slot → null', () => {
    const conv = baseConv({ channel: 'facebook', phone: '27998877665544' });
    const contact: ContactMemoryRow = { dialogue_state: { slots: { telefono: { valor: 'no tengo' } } } } as any;
    expect(resolveCallablePhone(conv, contact)).toBeNull();
  });
});

describe('evaluarPendiente', () => {
  const vacio = new Set<string>();
  it('WhatsApp sin cita, sin opt_out → fila con datos', () => {
    const contact: ContactMemoryRow = {
      opt_out: false,
      dialogue_state: { area: 'jubilacion_mujer', slots: {} },
      calificacion: { jubilacion_mujer: { resultado: 'gratis' } },
      last_topic: 'jubilación',
    } as any;
    const fila = evaluarPendiente({ conversation: baseConv(), contact, phonesConCita: vacio });
    expect(fila).not.toBeNull();
    expect(fila!.telefono).toBe('542215093499');
    expect(fila!.nombre).toBe('Juan Perez');
    expect(fila!.canal).toBe('whatsapp');
    expect(fila!.area).toBe('jubilacion_mujer');
    expect(fila!.calificacion).toBe('gratis');
    expect(fila!.conversation_id).toBe('c1');
  });
  it('opt_out → null', () => {
    const contact = { opt_out: true } as any;
    expect(evaluarPendiente({ conversation: baseConv(), contact, phonesConCita: vacio })).toBeNull();
  });
  it('con cita (teléfono en el set) → null', () => {
    const con = new Set(['542215093499']);
    expect(evaluarPendiente({ conversation: baseConv(), contact: null, phonesConCita: con })).toBeNull();
  });
  it('sin teléfono llamable (FB/IG sin slot) → null', () => {
    const conv = baseConv({ channel: 'facebook', phone: '27998877665544' });
    expect(evaluarPendiente({ conversation: conv, contact: null, phonesConCita: vacio })).toBeNull();
  });
  it('nombre cae al slot nombre si no hay contact_name', () => {
    const conv = baseConv({ contact_name: null });
    const contact = { opt_out: false, dialogue_state: { slots: { nombre: { valor: 'Ana' } } } } as any;
    expect(evaluarPendiente({ conversation: conv, contact, phonesConCita: vacio })!.nombre).toBe('Ana');
  });
  it('estado cerrada muestra el motivo', () => {
    const conv = baseConv({ closed_at: '2026-07-02T00:00:00Z', close_reason: 'despedida' });
    expect(evaluarPendiente({ conversation: conv, contact: null, phonesConCita: vacio })!.estado).toBe('cerrada (despedida)');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd server && npx vitest run src/core/callsheet/__tests__/PendienteEvaluator.test.ts`
Expected: FAIL — módulo `../PendienteEvaluator` no existe.

- [ ] **Step 3: Implementar `PendienteEvaluator.ts`**

Create `server/src/core/callsheet/PendienteEvaluator.ts`:
```ts
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

/** Teléfono LLAMABLE del contacto, o null si no lo tenemos. */
export function resolveCallablePhone(conversation: ConversationRow, contact: ContactMemoryRow | null): string | null {
  const canal: Canal = (conversation.channel ?? 'whatsapp') as Canal;
  if (canal === 'whatsapp') {
    const v = validarTelefonoAR(conversation.phone);
    if (v.normalizado) return v.normalizado;
    const norm = PhoneUtils.normalize(conversation.phone);
    return norm ? norm : null;
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
  const nombre = strOrNull(conversation.contact_name) ?? strOrNull(contact?.dialogue_state?.slots?.nombre?.valor);
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
  };
}

/** Normaliza un teléfono de appointment para el set de "con cita" (misma clave que resolveCallablePhone). */
export function claveCita(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  const v = validarTelefonoAR(telefono);
  if (v.normalizado) return v.normalizado;
  const norm = PhoneUtils.normalize(telefono);
  return norm ? norm : null;
}
```

- [ ] **Step 4: Correr — PASS**

Run: `cd server && npx vitest run src/core/callsheet/__tests__/PendienteEvaluator.test.ts`
Expected: PASS. Si alguna assertion de normalizado no coincide, ajustá el número del test al `normalizado` real que devuelve `validarTelefonoAR` (no toques la lógica).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/callsheet/PendienteEvaluator.ts server/src/core/callsheet/__tests__/PendienteEvaluator.test.ts
git commit -m "feat(callsheet): PendienteEvaluator — nucleo puro de la planilla de llamados

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Endpoint `GET /api/pendientes-llamar`

**Files:**
- Create: `server/src/api/routes/pendientes.routes.ts`
- Modify: `server/src/api/app.ts`
- Test: `server/src/api/routes/__tests__/pendientes.routes.test.ts`

- [ ] **Step 1: Test que falla (armado de filas + dedup, con supabase mockeado)**

Create `server/src/api/routes/__tests__/pendientes.routes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { armarPendientes } from '../pendientes.routes';
import type { ConversationRow, ContactMemoryRow } from '../../../core/callsheet/PendienteEvaluator';

const conv = (over: Partial<ConversationRow>): ConversationRow => ({
  id: 'c', account_id: 'a1', phone: '5492215093499', channel: 'whatsapp',
  contact_name: 'X', last_message: 'm', last_message_at: '2026-07-01T00:00:00Z',
  status: 'BOT', closed_at: null, close_reason: null, ...over,
});

describe('armarPendientes', () => {
  it('excluye con cita, opt_out y FB/IG sin teléfono; dedup por teléfono', () => {
    const conversations: ConversationRow[] = [
      conv({ id: 'c1', phone: '5492215093499' }),                       // entra
      conv({ id: 'c2', phone: '5492215093499' }),                       // dup del mismo teléfono → 1 sola
      conv({ id: 'c3', phone: '5491133334444' }),                       // tiene cita → fuera
      conv({ id: 'c4', phone: '5492944000111' }),                       // opt_out → fuera
      conv({ id: 'c5', channel: 'facebook', phone: '2799887766' }),     // FB sin teléfono → fuera
    ];
    const contacts = new Map<string, ContactMemoryRow>([
      ['c4', { opt_out: true } as any],
    ]);
    const appointments = [{ phone: '5491133334444', telefono: null }];
    const filas = armarPendientes(conversations, contacts, appointments);
    const tels = filas.map((f) => f.telefono);
    expect(filas.length).toBe(1);
    expect(tels).toContain('542215093499');
  });
});
```

- [ ] **Step 2: Correr — FAIL** (`armarPendientes` no existe)

Run: `cd server && npx vitest run src/api/routes/__tests__/pendientes.routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `pendientes.routes.ts`**

Create `server/src/api/routes/pendientes.routes.ts`:
```ts
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
        let q = supabase.from('appointments').select('phone, telefono').range(from, to);
        if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);
        return q;
      });

      let filas = armarPendientes(conversations, contactsByConvId, appointments);

      // 4) Filtro de rango temporal (sobre fecha del último contacto).
      const days = RANGE_DAYS[range];
      if (days) {
        const corte = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        filas = filas.filter((f) => (f.fecha ?? '') >= corte);
      }

      res.json({ total: filas.length, filas });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? 'error' });
    }
  });

  return r;
}
```

- [ ] **Step 4: Correr — PASS**

Run: `cd server && npx vitest run src/api/routes/__tests__/pendientes.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Montar el router en `app.ts`**

En `server/src/api/app.ts`, junto a los otros imports de routers (línea ~24):
```ts
import { pendientesRouter } from './routes/pendientes.routes';
```
Y junto a los `app.use('/api/...')` accesibles para empleadas (después de la línea de `/api/agenda`, ~85). SIN `requireRole` (empleadas + admin, son quienes llaman):
```ts
  app.use('/api/pendientes-llamar', authContext, pendientesRouter());
```

- [ ] **Step 6: tsc + commit**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0.
```bash
git add server/src/api/routes/pendientes.routes.ts server/src/api/routes/__tests__/pendientes.routes.test.ts server/src/api/app.ts
git commit -m "feat(callsheet): endpoint GET /api/pendientes-llamar (trae todo, dedup, filtro rango)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Cliente — `pendientesApi` + tipos

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Agregar tipos + api**

Al final de `client/src/lib/api.ts` (usa el helper `api<T>` ya existente):
```ts
export interface FilaPendiente {
  telefono: string;
  nombre: string | null;
  canal: 'whatsapp' | 'facebook' | 'instagram';
  area: string | null;
  calificacion: string | null;
  ultimo_mensaje: string | null;
  fecha: string | null;
  estado: string;
  tema: string | null;
  conversation_id: string;
  account_id: string;
}
export interface PendientesResponse { total: number; filas: FilaPendiente[]; }

export const pendientesApi = {
  list: (params: { accountId?: string; range?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.accountId) q.set('account_id', params.accountId);
    if (params.range) q.set('range', params.range);
    const qs = q.toString();
    return api<PendientesResponse>(`/api/pendientes-llamar${qs ? `?${qs}` : ''}`);
  },
};
```

- [ ] **Step 2: tsc + commit**

Run: `cd client && npx tsc --noEmit`
Expected: exit 0.
```bash
git add client/src/lib/api.ts
git commit -m "feat(callsheet): pendientesApi + tipos en el cliente

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Página `PendientesLlamar.tsx` + ruta + sidebar

**Files:**
- Create: `client/src/pages/PendientesLlamar.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 1: Crear la página**

Create `client/src/pages/PendientesLlamar.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { pendientesApi, type FilaPendiente } from '../lib/api';

const AREA_LABELS: Record<string, string> = {
  jubilacion: 'Jubilación', jubilacion_hombre: 'Jubilación (H)', jubilacion_mujer: 'Jubilación (M)',
  pension: 'Pensión', laboral: 'Laboral', art: 'ART', accidente: 'Accidente',
};
const CANAL_LABELS: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram' };
const CALIF_LABELS: Record<string, string> = { gratis: 'Gratis', pago: 'Pago', a_confirmar: 'A confirmar' };

const RANGES = [
  { value: 'all', label: 'Todo' }, { value: '90d', label: '90 días' },
  { value: '30d', label: '30 días' }, { value: '7d', label: '7 días' },
];

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function toCSV(filas: FilaPendiente[]): string {
  const head = ['Telefono', 'Nombre', 'Canal', 'Area', 'Calificacion', 'Estado', 'Ultimo tema', 'Ultimo mensaje', 'Fecha'];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = filas.map((f) => [
    // Teléfono como texto (prefijo tab) para que Excel no coma el 0/15 ni lo pase a notación científica.
    `\t${f.telefono}`,
    f.nombre ?? '', CANAL_LABELS[f.canal] ?? f.canal, f.area ? (AREA_LABELS[f.area] ?? f.area) : '',
    f.calificacion ? (CALIF_LABELS[f.calificacion] ?? f.calificacion) : '',
    f.estado, f.tema ?? '', (f.ultimo_mensaje ?? '').replace(/\s+/g, ' ').slice(0, 200), fmtFecha(f.fecha),
  ].map((c) => esc(String(c))).join(','));
  return [head.map(esc).join(','), ...rows].join('\r\n');
}

function descargarCSV(filas: FilaPendiente[]) {
  const blob = new Blob(['﻿' + toCSV(filas)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pendientes-llamar-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PendientesLlamar() {
  const [filas, setFilas] = useState<FilaPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState('all');
  const [canal, setCanal] = useState('all');
  const [calif, setCalif] = useState('all');

  useEffect(() => {
    setLoading(true); setError(null);
    pendientesApi.list({ range })
      .then((r) => setFilas(r.filas))
      .catch((e) => setError(e?.message ?? 'Error'))
      .finally(() => setLoading(false));
  }, [range]);

  const visibles = useMemo(() => filas.filter((f) =>
    (canal === 'all' || f.canal === canal) && (calif === 'all' || f.calificacion === calif)
  ), [filas, canal, calif]);

  return (
    <div className="p-4 sm:p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-brand-ink">Pendientes de llamar</h1>
          <p className="text-sm text-brand-textMuted">Contactos sin reunión coordinada, con teléfono. {visibles.length} para llamar.</p>
        </div>
        <button
          onClick={() => descargarCSV(visibles)}
          disabled={!visibles.length}
          className="px-4 py-2 rounded-lg bg-brand-gold text-brand-ink font-semibold text-sm disabled:opacity-40 hover:opacity-90"
        >Exportar CSV</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        <select value={range} onChange={(e) => setRange(e.target.value)} className="border rounded-lg px-2 py-1 bg-white">
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={canal} onChange={(e) => setCanal(e.target.value)} className="border rounded-lg px-2 py-1 bg-white">
          <option value="all">Todos los canales</option>
          <option value="whatsapp">WhatsApp</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option>
        </select>
        <select value={calif} onChange={(e) => setCalif(e.target.value)} className="border rounded-lg px-2 py-1 bg-white">
          <option value="all">Toda calificación</option>
          <option value="gratis">Gratis</option><option value="pago">Pago</option><option value="a_confirmar">A confirmar</option>
        </select>
      </div>

      {loading && <p className="text-brand-textMuted text-sm">Cargando…</p>}
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}
      {!loading && !error && (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-bgSoft text-brand-textMuted">
              <tr>
                {['Teléfono', 'Nombre', 'Canal', 'Área', 'Calificación', 'Estado', 'Tema', 'Fecha'].map((h) => (
                  <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.conversation_id} className="border-t hover:bg-brand-bgSoft/50">
                  <td className="px-3 py-2 whitespace-nowrap font-mono">
                    <a className="text-brand-gold hover:underline" href={`https://wa.me/${f.telefono}`} target="_blank" rel="noreferrer">{f.telefono}</a>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.nombre ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{CANAL_LABELS[f.canal] ?? f.canal}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.area ? (AREA_LABELS[f.area] ?? f.area) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.calificacion ? (CALIF_LABELS[f.calificacion] ?? f.calificacion) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.estado}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={f.tema ?? ''}>{f.tema ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtFecha(f.fecha)}</td>
                </tr>
              ))}
              {!visibles.length && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-brand-textMuted">Nadie pendiente con estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```
> Nota: si alguna clase `brand-*` no existe en el tema, reemplazala por la equivalente que use `Agenda.tsx` (mirá sus clases). No inventes colores nuevos.

- [ ] **Step 2: Ruta en `App.tsx`**

En `client/src/App.tsx`, con los demás `lazy(...)` (línea ~26):
```ts
const PendientesLlamar = lazy(() => import('./pages/PendientesLlamar'));
```
Y como ruta accesible para empleadas (junto a `/agenda`, FUERA del `<RoleRoute role="admin">`, línea ~65):
```tsx
              <Route path="/pendientes-llamar" element={<PendientesLlamar />} />
```

- [ ] **Step 3: Item de sidebar en `Layout.tsx`**

En `client/src/components/Layout.tsx`, importar el icono junto a los otros de `lucide-react` (agregá `PhoneCall` a la lista de imports existente) y agregar al array `allNav` (después de la línea de `/agenda`, ~13):
```ts
  { to: '/pendientes-llamar', label: 'Llamados', icon: PhoneCall, roles: ['admin', 'empleada'] },
```

- [ ] **Step 4: Build + commit**

Run: `cd client && npx tsc --noEmit`
Expected: exit 0.
```bash
git add client/src/pages/PendientesLlamar.tsx client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat(callsheet): pagina Pendientes de llamar (tabla + filtros + export CSV) + ruta + sidebar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificación integral

- [ ] **Step 1: Suite server + tsc**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 0 errores; toda la suite verde (los ~702 previos + los nuevos de Task 1 y 2).

- [ ] **Step 2: Build cliente**

Run: `cd client && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Smoke manual (opcional, si hay entorno)**

Levantar el server, `GET /api/pendientes-llamar?range=all` con un token válido → responde `{ total, filas }`. Abrir `/pendientes-llamar` en el panel → tabla + Exportar CSV baja un archivo que abre en Excel con el teléfono como texto.

---

## Decisiones tomadas (para el ejecutor)

1. **Sin migración**: todo se lee de tablas existentes (`whatsapp_conversations`, `contact_memory`, `appointments`).
2. **Teléfono llamable** = `validarTelefonoAR().normalizado` (AR) con fallback `PhoneUtils.normalize` para WhatsApp; FB/IG SOLO si hay teléfono real capturado en la memoria.
3. **Dedup por teléfono** (no por conversación): arrastra el fix @lid.
4. **CSV en el cliente** desde las filas ya traídas: sin dependencia nueva, teléfono como texto (`\t`) + BOM para Excel/Sheets.
5. **RBAC**: empleadas + admin (son quienes llaman) → el router NO lleva `requireRole('admin')`.
6. **Carga completa**: `fetchAll` pagina hasta agotar; NO se corta en 500 como el inbox.
7. **Fuera de v1**: "marcar como llamado", xlsx nativo, paginación server-side de la UI.
