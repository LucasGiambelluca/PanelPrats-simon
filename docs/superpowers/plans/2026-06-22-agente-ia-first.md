# Agente IA-primero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar el bot de WhatsApp de "flujo-scripteado primero" a un agente IA-primero con tools, memoria largo plazo por contacto, personalidad cálido-profesional unificada y grounding estricto, activado por flag en una cuenta piloto.

**Architecture:** Un `AgentRuntime` corre un loop de tool-calling sobre el `AIService` existente (OpenAI/Groq, function-calling nativo). Las acciones (agendar, FAQ, derivar) son tools que envuelven servicios actuales (`AppointmentService`, `KnowledgeBase`, `HandoverExecutor`) con identidad inyectada server-side. La memoria vive en una tabla `contact_memory`. Se engancha en `ConversationRouter` detrás del flag `agent_mode='ai_first'`; default `flows` → resto intacto.

**Tech Stack:** Node/Express + TypeScript, Supabase (Postgres), Redis (ioredis), vitest. Spec: `docs/superpowers/specs/2026-06-22-agente-ia-first-design.md`.

---

## File Structure

| Archivo | Responsabilidad | Crear/Modificar |
|---|---|---|
| `supabase/migrations/0015_agent_runtime.sql` | tablas `contact_memory`, `account_faqs`, columnas `agent_*` | Crear |
| `server/src/core/agent/runtime/types.ts` | tipos compartidos del agente (ToolContext, AgentDeps, ContactFicha, ToolResult) | Crear |
| `server/src/core/agent/runtime/KnowledgeBase.ts` | recuperar FAQ de la cuenta (grounding) | Crear |
| `server/src/core/agent/runtime/ContactMemory.ts` | leer/mergear memoria largo plazo + armar ficha | Crear |
| `server/src/core/agent/runtime/ToolRegistry.ts` | esquemas de tools + ejecución con identidad server-side | Crear |
| `server/src/core/agent/runtime/AgentPersona.ts` | armar system prompt por capas | Crear |
| `server/src/core/agent/runtime/AgentRuntime.ts` | loop de tool-calling, límites, manejo de error | Crear |
| `server/src/services/AIService.ts` | sumar `completeWithTools()` (function-calling) | Modificar |
| `server/src/core/engine/conversation.router.ts` | enganche detrás del flag `agent_mode` | Modificar |
| `server/src/services/loadAccountContext.ts` (o donde se cargue la cuenta) | exponer `agent_mode`, `agent_name`, `agent_persona` | Modificar |

Cada archivo del runtime es chico y de una sola responsabilidad. Tests co-locados en `__tests__/` siguiendo el patrón del repo.

---

## Task 1: Migración 0015 (tablas + columnas)

**Files:**
- Create: `supabase/migrations/0015_agent_runtime.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0015: runtime del agente IA-primero. Idempotente.

-- Memoria largo plazo por contacto (1 fila por account_id+phone).
CREATE TABLE IF NOT EXISTS contact_memory (
  account_id        uuid NOT NULL,
  phone             text NOT NULL,
  profile           jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
  long_term_summary text,
  last_summary_at   timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, phone)
);
ALTER TABLE contact_memory ENABLE ROW LEVEL SECURITY;

-- Base de conocimiento por cuenta (grounding estricto de FAQ).
CREATE TABLE IF NOT EXISTS account_faqs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  pregunta   text NOT NULL,
  respuesta  text NOT NULL,
  tags       text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_faqs_account ON account_faqs(account_id);
ALTER TABLE account_faqs ENABLE ROW LEVEL SECURITY;

-- Config del agente en accounts.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_mode    text DEFAULT 'flows';  -- 'flows' | 'ai_first'
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_name    text DEFAULT 'Sofía';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_persona text;
```

- [ ] **Step 2: Verificar que no rompe el type-check ni el arranque**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0 (la migración es SQL, no afecta TS; este check confirma que no se tocó nada más).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0015_agent_runtime.sql
git commit -m "feat(agent): migración 0015 (contact_memory, account_faqs, agent_* cols)"
```

> Nota: la migración se aplica en Supabase vía el endpoint `/config/sync-db` (ya corregido para correr todas las *.sql en orden) o manual en el SQL editor. No se aplica en este task.

---

## Task 2: Tipos compartidos del runtime

**Files:**
- Create: `server/src/core/agent/runtime/types.ts`

- [ ] **Step 1: Escribir los tipos**

```typescript
// Identidad inyectada server-side al ejecutar una tool. El modelo NUNCA la provee.
export interface ToolContext {
  accountId: string;
  phone: string;
}

// Resultado normalizado de una tool (lo que se devuelve al modelo).
export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
}

// Ficha compacta del contacto que se inyecta en el prompt.
export interface ContactFicha {
  profile: Record<string, any>;
  preferences: Record<string, any>;
  summary: string | null;
  fichaText: string; // línea(s) lista(s) para el prompt
}

// Config de cuenta relevante para el agente.
export interface AgentAccountConfig {
  accountId: string;
  agentName: string;          // default 'Sofía'
  agentPersona?: string | null;
  businessContext?: string | null;
  estudioNombre?: string | null;
  apiKey?: string | null;
  model?: string | null;
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add server/src/core/agent/runtime/types.ts
git commit -m "feat(agent): tipos del runtime (ToolContext, ToolResult, ContactFicha)"
```

---

## Task 3: KnowledgeBase (grounding)

**Files:**
- Create: `server/src/core/agent/runtime/KnowledgeBase.ts`
- Test: `server/src/core/agent/runtime/__tests__/KnowledgeBase.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock supabase: account_faqs devuelve filas controladas.
const faqRows: any[] = [];
vi.mock('../../../../config/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: faqRows, error: null }) }),
    }),
  },
}));

import { KnowledgeBase } from '../KnowledgeBase';

describe('KnowledgeBase.search', () => {
  it('encuentra una FAQ por keyword y devuelve el snippet', async () => {
    faqRows.length = 0;
    faqRows.push({ pregunta: '¿Atienden moratoria previsional?', respuesta: 'Sí, gestionamos moratoria.', tags: ['moratoria'] });
    const kb = new KnowledgeBase();
    const res = await kb.search('acc1', 'me conviene la moratoria?');
    expect(res.encontrado).toBe(true);
    expect(res.snippets.join(' ')).toContain('moratoria');
  });

  it('devuelve encontrado:false cuando nada matchea (grounding estricto)', async () => {
    faqRows.length = 0;
    faqRows.push({ pregunta: '¿Dónde están?', respuesta: 'En CABA.', tags: ['ubicacion'] });
    const kb = new KnowledgeBase();
    const res = await kb.search('acc1', 'cuánto cobra el bono de criptomonedas');
    expect(res.encontrado).toBe(false);
    expect(res.snippets).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/KnowledgeBase.test.ts`
Expected: FAIL — "Cannot find module '../KnowledgeBase'"

- [ ] **Step 3: Implementar `KnowledgeBase`**

```typescript
import { supabase } from '../../../config/supabase';

export interface KnowledgeHit { encontrado: boolean; snippets: string[]; }

// Normaliza y tokeniza para matching por keyword (sin acentos, minúsculas).
function tokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9áéíóúñ ]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4); // palabras cortas no aportan señal
}

export class KnowledgeBase {
  /**
   * Recupera FAQs relevantes de la cuenta por solapamiento de keywords.
   * Grounding estricto: si nada supera el umbral, devuelve encontrado:false.
   */
  async search(accountId: string, query: string): Promise<KnowledgeHit> {
    const { data } = await supabase.from('account_faqs').select('pregunta, respuesta, tags').eq('account_id', accountId);
    const rows = (data ?? []) as Array<{ pregunta: string; respuesta: string; tags: string[] }>;
    const q = new Set(tokens(query));
    if (q.size === 0 || rows.length === 0) return { encontrado: false, snippets: [] };

    const scored = rows
      .map((r) => {
        const hay = new Set([...tokens(r.pregunta), ...(r.tags ?? [])]);
        let score = 0;
        for (const t of q) if (hay.has(t)) score++;
        return { r, score };
      })
      .filter((s) => s.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) return { encontrado: false, snippets: [] };
    return { encontrado: true, snippets: scored.map((s) => `${s.r.pregunta} → ${s.r.respuesta}`) };
  }
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/KnowledgeBase.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/KnowledgeBase.ts server/src/core/agent/runtime/__tests__/KnowledgeBase.test.ts
git commit -m "feat(agent): KnowledgeBase con recuperación keyword + grounding estricto"
```

---

## Task 4: ContactMemory (memoria largo plazo)

**Files:**
- Create: `server/src/core/agent/runtime/ContactMemory.ts`
- Test: `server/src/core/agent/runtime/__tests__/ContactMemory.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect } from 'vitest';
import { mergeProfile, buildFichaText } from '../ContactMemory';

describe('ContactMemory.mergeProfile', () => {
  it('agrega slots nuevos sin pisar los existentes con null/undefined', () => {
    const prev = { nombre: 'María', edad: 63 };
    const next = { nombre: null, situacion_previsional: 'le faltan aportes', edad: undefined };
    expect(mergeProfile(prev, next)).toEqual({
      nombre: 'María', edad: 63, situacion_previsional: 'le faltan aportes',
    });
  });
});

describe('ContactMemory.buildFichaText', () => {
  it('arma una línea compacta con perfil + próxima cita', () => {
    const ficha = buildFichaText(
      { nombre: 'María', edad: 63, situacion_previsional: 'le faltan 2 años' },
      { horario_preferido: 'mañanas' },
      'Consultó moratoria.',
      'jue 26/6 11hs',
    );
    expect(ficha).toContain('María');
    expect(ficha).toContain('63');
    expect(ficha).toContain('mañanas');
    expect(ficha).toContain('jue 26/6 11hs');
  });

  it('no rompe cuando faltan datos', () => {
    const ficha = buildFichaText({}, {}, null, null);
    expect(typeof ficha).toBe('string');
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ContactMemory.test.ts`
Expected: FAIL — "Cannot find module '../ContactMemory'"

- [ ] **Step 3: Implementar `ContactMemory` (funciones puras + clase)**

```typescript
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
      .from('contact_memory').select('profile, preferences')
      .eq('account_id', accountId).eq('phone', phone).maybeSingle();

    const profile = mergeProfile((data?.profile ?? {}) as any, patch.profile ?? {});
    const preferences = mergeProfile((data?.preferences ?? {}) as any, patch.preferences ?? {});

    await supabase.from('contact_memory').upsert({
      account_id: accountId, phone,
      profile, preferences,
      long_term_summary: patch.summary ?? data?.['long_term_summary' as any] ?? null,
      last_summary_at: patch.summary ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,phone' });
  }
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ContactMemory.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/ContactMemory.ts server/src/core/agent/runtime/__tests__/ContactMemory.test.ts
git commit -m "feat(agent): ContactMemory (merge incremental + ficha + próxima cita)"
```

---

## Task 5: ToolRegistry (tools + identidad server-side)

**Files:**
- Create: `server/src/core/agent/runtime/ToolRegistry.ts`
- Test: `server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect, vi } from 'vitest';

// Stubs de las dependencias (se inyectan, no se mockea el módulo).
const apptCreate = vi.fn();
const apptUpdate = vi.fn();
const kbSearch = vi.fn();
const handoff = vi.fn();

import { ToolRegistry } from '../ToolRegistry';

function makeRegistry() {
  return new ToolRegistry({
    appointments: { create: apptCreate, update: apptUpdate, list: vi.fn().mockResolvedValue([]), hasOverlap: vi.fn() } as any,
    knowledge: { search: kbSearch } as any,
    handoff,
  });
}

describe('ToolRegistry', () => {
  it('expone los esquemas de las 6 tools', () => {
    const schemas = makeRegistry().schemas();
    const names = schemas.map((s: any) => s.function.name).sort();
    expect(names).toEqual([
      'book_appointment', 'cancel_appointment', 'check_availability',
      'handoff_to_human', 'reschedule_appointment', 'search_knowledge',
    ]);
  });

  it('book_appointment inyecta account_id/phone del contexto, NO de los args del modelo', async () => {
    apptCreate.mockResolvedValue({ id: 'appt1' });
    const reg = makeRegistry();
    // El modelo intenta colar otro account_id/phone: deben ignorarse.
    const res = await reg.execute('book_appointment',
      { account_id: 'HACK', phone: 'HACK', nombre: 'María', start_time: 's', end_time: 'e', resumen: 'consulta' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'acc1', phone: '549111', nombre: 'María' }));
  });

  it('book_appointment mapea SLOT_TAKEN a un error legible', async () => {
    apptCreate.mockRejectedValue(new Error('SLOT_TAKEN'));
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Ana', start_time: 's', end_time: 'e', resumen: 'x' }, { accountId: 'acc1', phone: 'p' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('ocupado');
  });

  it('search_knowledge propaga encontrado:false (grounding)', async () => {
    kbSearch.mockResolvedValue({ encontrado: false, snippets: [] });
    const reg = makeRegistry();
    const res = await reg.execute('search_knowledge', { query: 'algo raro' }, { accountId: 'acc1', phone: 'p' });
    expect(res.ok).toBe(true);
    expect(res.data.encontrado).toBe(false);
  });

  it('handoff_to_human llama al handoff con el contexto', async () => {
    handoff.mockResolvedValue(undefined);
    const reg = makeRegistry();
    const res = await reg.execute('handoff_to_human', { motivo: 'pide humano', resumen_caso: 'caso X' }, { accountId: 'acc1', phone: 'p' });
    expect(res.ok).toBe(true);
    expect(handoff).toHaveBeenCalledWith('acc1', 'p', expect.objectContaining({ motivo: 'pide humano' }));
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts`
Expected: FAIL — "Cannot find module '../ToolRegistry'"

- [ ] **Step 3: Implementar `ToolRegistry`**

```typescript
import type { ToolContext, ToolResult } from './types';
import type { AppointmentService as ApptSvc } from '../../../services/AppointmentService';
import type { KnowledgeBase } from './KnowledgeBase';

export interface ToolDeps {
  appointments: typeof ApptSvc;
  knowledge: KnowledgeBase;
  // marca HANDOVER y corta el bot; recibe identidad server-side + payload del modelo.
  handoff: (accountId: string, phone: string, payload: { motivo: string; resumen_caso: string }) => Promise<void>;
}

// Esquema de tools en formato OpenAI function-calling.
const SCHEMAS = [
  { type: 'function', function: { name: 'check_availability', description: 'Lista horarios libres en una ventana de fechas.', parameters: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, oficina: { type: 'string' } }, required: ['desde', 'hasta'] } } },
  { type: 'function', function: { name: 'book_appointment', description: 'Agenda una cita. Confirmá los datos con el cliente ANTES de llamar.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, oficina: { type: 'string' }, resumen: { type: 'string' } }, required: ['nombre', 'start_time', 'end_time', 'resumen'] } } },
  { type: 'function', function: { name: 'reschedule_appointment', description: 'Reprograma una cita existente.', parameters: { type: 'object', properties: { appointment_id: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' } }, required: ['appointment_id', 'start_time', 'end_time'] } } },
  { type: 'function', function: { name: 'cancel_appointment', description: 'Cancela una cita existente.', parameters: { type: 'object', properties: { appointment_id: { type: 'string' } }, required: ['appointment_id'] } } },
  { type: 'function', function: { name: 'search_knowledge', description: 'Busca en la base del estudio. Usala SIEMPRE antes de responder temas previsionales.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'handoff_to_human', description: 'Deriva la conversación a una persona del estudio.', parameters: { type: 'object', properties: { motivo: { type: 'string' }, resumen_caso: { type: 'string' } }, required: ['motivo', 'resumen_caso'] } } },
];

export class ToolRegistry {
  constructor(private deps: ToolDeps) {}

  schemas() { return SCHEMAS; }

  /** Ejecuta una tool. La identidad (accountId/phone) viene del ctx, NUNCA de args. */
  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      switch (name) {
        case 'check_availability': {
          const list = await this.deps.appointments.list(ctx.accountId);
          // Devolvemos las citas ocupadas del pool para que el modelo razone los libres.
          const ocupadas = list
            .filter((a) => a.status !== 'cancelada' && a.start_time && (!args.oficina || (a.oficina || '') === args.oficina))
            .map((a) => ({ start: a.start_time, end: a.end_time, oficina: a.oficina }));
          return { ok: true, data: { ocupadas, desde: args.desde, hasta: args.hasta } };
        }
        case 'book_appointment': {
          const appt = await this.deps.appointments.create({
            account_id: ctx.accountId, phone: ctx.phone, telefono: ctx.phone,
            nombre: args.nombre, resumen: args.resumen ?? '', status: 'pendiente',
            start_time: args.start_time, end_time: args.end_time, oficina: args.oficina,
          } as any);
          return { ok: true, data: { appointment_id: appt.id } };
        }
        case 'reschedule_appointment': {
          await this.deps.appointments.update(args.appointment_id, { start_time: args.start_time, end_time: args.end_time });
          return { ok: true };
        }
        case 'cancel_appointment': {
          await this.deps.appointments.update(args.appointment_id, { status: 'cancelada' });
          return { ok: true };
        }
        case 'search_knowledge': {
          const hit = await this.deps.knowledge.search(ctx.accountId, args.query ?? '');
          return { ok: true, data: hit };
        }
        case 'handoff_to_human': {
          await this.deps.handoff(ctx.accountId, ctx.phone, { motivo: args.motivo ?? '', resumen_caso: args.resumen_caso ?? '' });
          return { ok: true, data: { handoff: true } };
        }
        default:
          return { ok: false, error: `tool desconocida: ${name}` };
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg === 'SLOT_TAKEN') return { ok: false, error: 'Ese horario ya está ocupado, ofrecé otro.' };
      return { ok: false, error: 'No pude completar la acción; ofrecé derivar a una persona.' };
    }
  }
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/ToolRegistry.ts server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts
git commit -m "feat(agent): ToolRegistry (6 tools, identidad server-side, SLOT_TAKEN)"
```

---

## Task 6: AgentPersona (system prompt por capas)

**Files:**
- Create: `server/src/core/agent/runtime/AgentPersona.ts`
- Test: `server/src/core/agent/runtime/__tests__/AgentPersona.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect } from 'vitest';
import { buildPersona } from '../AgentPersona';

describe('buildPersona', () => {
  const account = { accountId: 'acc1', agentName: 'Sofía', businessContext: 'Estudio previsional PYS', estudioNombre: 'PYS' } as any;

  it('incluye identidad, tono, grounding y la ficha del contacto', () => {
    const prompt = buildPersona(account, 'FICHA: María, 63. Consultó moratoria.');
    expect(prompt).toContain('Sofía');
    expect(prompt).toContain('PYS');
    expect(prompt).toContain('FICHA: María, 63');
    expect(prompt.toLowerCase()).toContain('search_knowledge'); // regla de grounding
    expect(prompt.toLowerCase()).toContain('confirm');           // confirmar antes de mutar
  });

  it('usa el default Sofía si no hay agentName', () => {
    const prompt = buildPersona({ accountId: 'acc1' } as any, 'FICHA: nuevo.');
    expect(prompt).toContain('Sofía');
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts`
Expected: FAIL — "Cannot find module '../AgentPersona'"

- [ ] **Step 3: Implementar `AgentPersona`**

```typescript
import type { AgentAccountConfig } from './types';

export function buildPersona(account: Partial<AgentAccountConfig>, fichaText: string): string {
  const nombre = account.agentName?.trim() || 'Sofía';
  const estudio = account.estudioNombre?.trim() || 'el estudio';
  const tono = account.agentPersona?.trim();

  return [
    `Sos ${nombre}, asistente de ${estudio}. Atendés por WhatsApp.`,
    '',
    'TONO (cálido pero profesional):',
    '- Tuteá. Frases cortas, estilo WhatsApp (a veces 2 mensajitos, no párrafos).',
    '- Usá el nombre de la persona cuando lo sepas.',
    '- Si está angustiada, validá la emoción primero.',
    '- Una sola pregunta a la vez.',
    '- Cero jerga legal innecesaria; si usás un término, explicalo simple.',
    '- Emojis con cuentagotas (1 ocasional). Variá el fraseo, no repitas muletillas.',
    tono ? `- Indicación extra del estudio: ${tono}` : '',
    '',
    'REGLAS (importantes):',
    '- Temas previsionales (montos, plazos, requisitos, leyes): respondé SOLO con lo que devuelva la tool search_knowledge. Si no hay info, decílo con franqueza y ofrecé derivar con handoff_to_human. NUNCA inventes datos.',
    '- Antes de agendar, reprogramar o cancelar (book/reschedule/cancel): repetí los datos y esperá que el cliente CONFIRME.',
    '- Si la persona se frustra o pide un humano, derivá con handoff_to_human pasando un resumen del caso.',
    '',
    account.businessContext ? `DATOS DEL ESTUDIO:\n${account.businessContext}\n` : '',
    fichaText,
  ].filter((l) => l !== '').join('\n');
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/AgentPersona.ts server/src/core/agent/runtime/__tests__/AgentPersona.test.ts
git commit -m "feat(agent): AgentPersona (prompt por capas, tono cálido-profesional, grounding)"
```

---

## Task 7: AIService.completeWithTools (function-calling)

**Files:**
- Modify: `server/src/services/AIService.ts` (agregar método estático `completeWithTools`)
- Test: `server/src/services/__tests__/AIService.tools.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const posts: any[] = [];
let nextResponse: any = { data: { choices: [{ message: { content: 'hola' } }] } };
vi.mock('axios', () => ({
  default: { post: (url: string, body: any) => { posts.push({ url, body }); return Promise.resolve(nextResponse); } },
}));

import { AIService } from '../AIService';

describe('AIService.completeWithTools', () => {
  beforeEach(() => { posts.length = 0; process.env.OPENAI_API_KEY = 'sk-test'; });

  it('devuelve texto cuando el modelo no pide tools', async () => {
    nextResponse = { data: { choices: [{ message: { content: 'Hola, soy Sofía' } }] } };
    const res = await AIService.completeWithTools({ systemPrompt: 'sos sofía', messages: [{ role: 'user', content: 'hola' }], tools: [] });
    expect(res.content).toContain('Sofía');
    expect(res.toolCalls).toBeUndefined();
    expect(posts[0].body.tools).toEqual([]);
  });

  it('parsea tool_calls (name + args JSON) cuando el modelo invoca una tool', async () => {
    nextResponse = { data: { choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'search_knowledge', arguments: '{"query":"moratoria"}' } }] } }] } };
    const res = await AIService.completeWithTools({ systemPrompt: 's', messages: [{ role: 'user', content: 'moratoria?' }], tools: [{ type: 'function', function: { name: 'search_knowledge' } }] as any });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0]).toMatchObject({ id: 'c1', name: 'search_knowledge', args: { query: 'moratoria' } });
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/services/__tests__/AIService.tools.test.ts`
Expected: FAIL — "completeWithTools is not a function"

- [ ] **Step 3: Implementar `completeWithTools` en `AIService`**

Agregar al `import` existente nada nuevo (usa `axios` y `logger` ya importados). Agregar dentro de la clase `AIService`, después de `complete()`:

```typescript
  /**
   * Completion con function-calling (OpenAI/Groq compatible). Para el AgentRuntime.
   * Devuelve { content } si el modelo respondió texto, o { toolCalls } si pidió tools.
   * Usa el endpoint OpenAI (primario) o Groq como fallback; Gemini NO se usa acá
   * (su API de tools difiere; el agente piloto corre sobre OpenAI/Groq).
   */
  static async completeWithTools(opts: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }>;
    tools: any[];
    apiKey?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> }> {
    const messages = [{ role: 'system', content: opts.systemPrompt }, ...opts.messages];
    const body: any = {
      messages,
      tools: opts.tools,
      tool_choice: 'auto',
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
    };

    const targets: Array<{ url: string; key?: string; model: string }> = [];
    if (OPENAI_API_KEY || opts.apiKey?.startsWith('sk-')) {
      targets.push({ url: OPENAI_API_URL, key: opts.apiKey?.startsWith('sk-') ? opts.apiKey : OPENAI_API_KEY, model: opts.model?.includes('gpt') ? opts.model : AIService.OPENAI_MODEL });
    }
    if (GROQ_API_KEY) targets.push({ url: GROQ_API_URL, key: GROQ_API_KEY, model: AIService.GROQ_MODEL });

    let lastErr: any;
    for (const t of targets) {
      try {
        const resp = await axios.post(t.url, { ...body, model: t.model },
          { headers: { Authorization: `Bearer ${t.key}`, 'Content-Type': 'application/json' }, timeout: 25000 });
        const msg = resp.data?.choices?.[0]?.message ?? {};
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
          const toolCalls = msg.tool_calls.map((c: any) => {
            let args: any = {};
            try { args = JSON.parse(c.function?.arguments ?? '{}'); } catch { args = {}; }
            return { id: c.id, name: c.function?.name, args };
          });
          return { toolCalls };
        }
        return { content: msg.content ?? '' };
      } catch (err: any) {
        lastErr = err;
        logger.warn('[AI] completeWithTools proveedor falló, probando siguiente', { error: err?.response?.data?.error?.message ?? err?.message });
      }
    }
    throw lastErr ?? new Error('Sin proveedor de IA disponible para tools');
  }
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/services/__tests__/AIService.tools.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/AIService.ts server/src/services/__tests__/AIService.tools.test.ts
git commit -m "feat(agent): AIService.completeWithTools (function-calling OpenAI/Groq)"
```

---

## Task 8: AgentRuntime (loop)

**Files:**
- Create: `server/src/core/agent/runtime/AgentRuntime.ts`
- Test: `server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime';

function makeDeps(aiScript: any[]) {
  let i = 0;
  return {
    ai: { completeWithTools: vi.fn(async () => aiScript[i++]) },
    persona: { build: vi.fn(() => 'system') },
    memory: { load: vi.fn().mockResolvedValue({ profile: {}, preferences: {}, summary: null, fichaText: 'FICHA: nuevo.' }) },
    tools: { schemas: vi.fn(() => []), execute: vi.fn() },
    loadAccount: vi.fn().mockResolvedValue({ accountId: 'acc1', agentName: 'Sofía' }),
    history: vi.fn().mockResolvedValue([]),
  };
}

describe('AgentRuntime.handle', () => {
  it('responde directo cuando el modelo no pide tools', async () => {
    const deps = makeDeps([{ content: 'Hola, soy Sofía' }]);
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola', {});
    expect(out).toEqual(['Hola, soy Sofía']);
    expect(deps.tools.execute).not.toHaveBeenCalled();
  });

  it('ejecuta una tool y vuelve a llamar al modelo con el resultado', async () => {
    const deps = makeDeps([
      { toolCalls: [{ id: 'c1', name: 'search_knowledge', args: { query: 'moratoria' } }] },
      { content: 'Sí, gestionamos moratoria.' },
    ]);
    deps.tools.execute = vi.fn().mockResolvedValue({ ok: true, data: { encontrado: true, snippets: ['x'] } });
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', '¿moratoria?', {});
    expect(deps.tools.execute).toHaveBeenCalledWith('search_knowledge', { query: 'moratoria' }, { accountId: 'acc1', phone: '549111' });
    expect(out).toEqual(['Sí, gestionamos moratoria.']);
  });

  it('corta y deriva si supera el máximo de iteraciones', async () => {
    // Siempre pide tools, nunca texto final.
    const loopResp = { toolCalls: [{ id: 'c', name: 'search_knowledge', args: {} }] };
    const deps = makeDeps(Array(20).fill(loopResp));
    deps.tools.execute = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'loop', {});
    expect(out[0].toLowerCase()).toContain('persona'); // mensaje de cortesía + derivación
    expect(deps.ai.completeWithTools.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentRuntime.test.ts`
Expected: FAIL — "Cannot find module '../AgentRuntime'"

- [ ] **Step 3: Implementar `AgentRuntime`**

```typescript
import type { ToolContext } from './types';

const MAX_ITERATIONS = 5;
const FALLBACK = 'Disculpá, esto mejor lo ve una persona del estudio. Ya te derivo. 🙌';

// Dependencias inyectadas (facilita el test y respeta el aislamiento).
export interface RuntimeDeps {
  ai: { completeWithTools: typeof import('../../../services/AIService').AIService.completeWithTools };
  persona: { build: (account: any, fichaText: string) => string };
  memory: { load: (accountId: string, phone: string) => Promise<{ fichaText: string }> };
  tools: { schemas: () => any[]; execute: (name: string, args: any, ctx: ToolContext) => Promise<{ ok: boolean; data?: any; error?: string }> };
  loadAccount: (accountId: string) => Promise<any>;
  history: (accountId: string, phone: string) => Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
}

export class AgentRuntime {
  constructor(private deps: RuntimeDeps) {}

  /** Procesa un mensaje entrante y devuelve los mensajes a enviar. */
  async handle(accountId: string, phone: string, text: string, _fileCtx: any = {}): Promise<string[]> {
    const ctx: ToolContext = { accountId, phone };
    const [account, ficha, history] = await Promise.all([
      this.deps.loadAccount(accountId),
      this.deps.memory.load(accountId, phone),
      this.deps.history(accountId, phone),
    ]);

    const systemPrompt = this.deps.persona.build(account, ficha.fichaText);
    const tools = this.deps.tools.schemas();
    const messages: any[] = [...history, { role: 'user', content: text }];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await this.deps.ai.completeWithTools({
        systemPrompt, messages, tools, apiKey: account?.apiKey, model: account?.model,
      });

      if (!res.toolCalls?.length) {
        return [res.content && res.content.trim() ? res.content.trim() : FALLBACK];
      }

      // Registrar la intención de tool del asistente y ejecutar cada llamada.
      messages.push({ role: 'assistant', content: '', tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
      for (const call of res.toolCalls) {
        const result = await this.deps.tools.execute(call.name, call.args, ctx);
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result) });
      }
    }

    // Excedió iteraciones: cortar y derivar (nunca colgar al cliente).
    return [FALLBACK];
  }
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentRuntime.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/AgentRuntime.ts server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts
git commit -m "feat(agent): AgentRuntime (loop tool-calling, límite de iteraciones + derivación)"
```

---

## Task 9: Wiring — fábrica del runtime + enganche en ConversationRouter

**Files:**
- Create: `server/src/core/agent/runtime/createAgentRuntime.ts` (compone las dependencias reales)
- Modify: `server/src/core/engine/conversation.router.ts` (gate por `agent_mode`)
- Test: `server/src/core/engine/__tests__/conversation.router.agent.test.ts`

- [ ] **Step 1: Escribir el test que falla (gate del router)**

```typescript
import { describe, it, expect, vi } from 'vitest';

// account.agent_mode controla el branch.
let accountRow: any = { agent_mode: 'flows' };
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: accountRow }) }) }) }) },
}));

const agentHandle = vi.fn().mockResolvedValue(['respuesta del agente']);
vi.mock('../../agent/runtime/createAgentRuntime', () => ({
  getAgentRuntime: () => ({ handle: agentHandle }),
}));

import { ConversationRouter } from '../conversation.router';

function makeEngine() {
  return { processMessage: vi.fn().mockResolvedValue({ messages: ['flujo'] }), forceReset: vi.fn() } as any;
}

describe('ConversationRouter gate agent_mode', () => {
  it("con agent_mode='ai_first' usa el AgentRuntime y NO el FlowEngine", async () => {
    accountRow = { agent_mode: 'ai_first' };
    const engine = makeEngine();
    const out = await new ConversationRouter(engine).processMessage('acc1', '549111', 'hola que tal', 'Lucas');
    expect(agentHandle).toHaveBeenCalledWith('acc1', '549111', 'hola que tal', expect.anything());
    expect(engine.processMessage).not.toHaveBeenCalled();
    expect(out).toEqual(['respuesta del agente']);
  });

  it("con agent_mode='flows' usa el FlowEngine (camino actual)", async () => {
    accountRow = { agent_mode: 'flows' };
    const engine = makeEngine();
    await new ConversationRouter(engine).processMessage('acc1', '549111', 'algo off-script xyz', 'Lucas');
    expect(engine.processMessage).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/core/engine/__tests__/conversation.router.agent.test.ts`
Expected: FAIL — "Cannot find module '../../agent/runtime/createAgentRuntime'" o el branch no existe.

- [ ] **Step 3a: Crear la fábrica `createAgentRuntime.ts`**

```typescript
import { AgentRuntime } from './AgentRuntime';
import { ToolRegistry } from './ToolRegistry';
import { KnowledgeBase } from './KnowledgeBase';
import { ContactMemory } from './ContactMemory';
import { buildPersona } from './AgentPersona';
import { AIService } from '../../../services/AIService';
import { AppointmentService } from '../../../services/AppointmentService';
import { HandoverExecutor } from '../../executors/HandoverExecutor';
import { supabase } from '../../../config/supabase';
import { messageStore } from '../../../services/MessageStore';

// Carga la config de cuenta relevante para el agente.
async function loadAccount(accountId: string) {
  const { data } = await supabase.from('accounts')
    .select('id, name, agent_name, agent_persona, business_context, ai_api_key, ai_model')
    .eq('id', accountId).maybeSingle();
  return {
    accountId,
    agentName: data?.agent_name ?? 'Sofía',
    agentPersona: data?.agent_persona ?? null,
    businessContext: data?.business_context ?? null,
    estudioNombre: data?.name ?? null,
    apiKey: data?.ai_api_key ?? null,
    model: data?.ai_model ?? null,
  };
}

// Últimos ~12 mensajes como historial reciente para el modelo.
async function recentHistory(accountId: string, phone: string) {
  const msgs = await messageStore.getHistory?.(accountId, phone, 12) ?? [];
  return msgs.map((m: any) => ({ role: m.direction === 'OUTBOUND' ? 'assistant' : 'user', content: m.content }));
}

// Marca HANDOVER reutilizando el executor existente.
async function handoff(accountId: string, phone: string, payload: { motivo: string; resumen_caso: string }) {
  await HandoverExecutor.markHandover?.(accountId, phone, payload.resumen_caso);
}

let singleton: AgentRuntime | null = null;
export function getAgentRuntime(): AgentRuntime {
  if (singleton) return singleton;
  const knowledge = new KnowledgeBase();
  const memory = new ContactMemory();
  const tools = new ToolRegistry({ appointments: AppointmentService, knowledge, handoff });
  singleton = new AgentRuntime({
    ai: { completeWithTools: AIService.completeWithTools.bind(AIService) },
    persona: { build: buildPersona },
    memory: { load: (a, p) => memory.load(a, p) },
    tools: { schemas: () => tools.schemas(), execute: (n, args, ctx) => tools.execute(n, args, ctx) },
    loadAccount,
    history: recentHistory,
  });
  return singleton;
}
```

> Nota de implementación: si `messageStore.getHistory` o `HandoverExecutor.markHandover` no existen con esa firma exacta, adaptá a la API real (la lógica de handover ya vive en `HandoverExecutor`/`conversation.router`; reutilizá esa). Mantené la interfaz `handoff(accountId, phone, payload)` y `history(accountId, phone)` que `AgentRuntime` espera.

- [ ] **Step 3b: Enganchar el gate en `conversation.router.ts`**

Al inicio de `processMessage`, después de calcular `const t = norm(text);`, agregar el branch del agente. Importar arriba: `import { getAgentRuntime } from '../agent/runtime/createAgentRuntime';` y `import { supabase } from '../../config/supabase';` (ya importado).

```typescript
    // Gate IA-primero: si la cuenta está en modo agente, el AgentRuntime conduce.
    // Las cuentas en 'flows' (default) siguen el camino scripteado de abajo, intacto.
    const { data: acc } = await supabase.from('accounts').select('agent_mode').eq('id', accountId).maybeSingle();
    if (acc?.agent_mode === 'ai_first') {
      return getAgentRuntime().handle(accountId, phone, text, fileCtx);
    }
```

Insertarlo justo antes del bloque `// P0 — cancelar explícito`.

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/core/engine/__tests__/conversation.router.agent.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Type-check + suite completa**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; suite verde (puede fallar el flaky `AppointmentAvailabilityExecutor` en suite completa — re-correr aislado para confirmar, como documenta AUDITORIA-2).

- [ ] **Step 6: Commit**

```bash
git add server/src/core/agent/runtime/createAgentRuntime.ts server/src/core/engine/conversation.router.ts server/src/core/engine/__tests__/conversation.router.agent.test.ts
git commit -m "feat(agent): fábrica del runtime + gate agent_mode en ConversationRouter"
```

---

## Task 10: Actualización de memoria post-conversación

**Files:**
- Create: `server/src/core/agent/runtime/MemoryUpdater.ts`
- Test: `server/src/core/agent/runtime/__tests__/MemoryUpdater.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { extractMemoryPatch } from '../MemoryUpdater';

describe('extractMemoryPatch', () => {
  it('arma el prompt de extracción y parsea el JSON del modelo', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('{"profile":{"nombre":"María","edad":63},"preferences":{},"summary":"Consultó moratoria."}') };
    const patch = await extractMemoryPatch(ai as any, [
      { role: 'user', content: 'soy maría tengo 63' },
      { role: 'assistant', content: 'hola maría' },
    ]);
    expect(patch.profile).toMatchObject({ nombre: 'María', edad: 63 });
    expect(patch.summary).toContain('moratoria');
  });

  it('devuelve patch vacío si el modelo no da JSON válido', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('no soy json') };
    const patch = await extractMemoryPatch(ai as any, [{ role: 'user', content: 'hola' }]);
    expect(patch).toEqual({ profile: {}, preferences: {}, summary: null });
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/MemoryUpdater.test.ts`
Expected: FAIL — "Cannot find module '../MemoryUpdater'"

- [ ] **Step 3: Implementar `MemoryUpdater`**

```typescript
interface AILike { complete: (opts: any) => Promise<string> }

const EXTRACT_PROMPT = [
  'Extraé memoria del cliente de esta conversación. Respondé SOLO JSON con esta forma:',
  '{"profile":{...},"preferences":{...},"summary":"resumen corto en una o dos frases"}',
  'En profile poné solo datos seguros que el cliente haya dicho (nombre, edad, situacion_previsional, localidad).',
  'No inventes. Si no hay datos para un campo, omitilo.',
].join('\n');

export async function extractMemoryPatch(ai: AILike, turns: Array<{ role: string; content: string }>): Promise<{
  profile: Record<string, any>; preferences: Record<string, any>; summary: string | null;
}> {
  const convo = turns.map((t) => `${t.role === 'user' ? 'Cliente' : 'Bot'}: ${t.content}`).join('\n');
  try {
    const raw = await ai.complete({ systemPrompt: EXTRACT_PROMPT, userMessage: convo, jsonMode: true, temperature: 0 });
    const parsed = JSON.parse(raw);
    return {
      profile: parsed.profile ?? {},
      preferences: parsed.preferences ?? {},
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    };
  } catch {
    return { profile: {}, preferences: {}, summary: null };
  }
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/MemoryUpdater.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Conectar el updater al final de `AgentRuntime.handle`**

En `AgentRuntime.ts`, agregar a `RuntimeDeps`: `updateMemory?: (accountId: string, phone: string, turns: Array<{role: string; content: string}>) => Promise<void>;`. Al final de `handle`, antes de cada `return`, disparar sin await bloqueante:

```typescript
    // Actualización de memoria fuera del camino de respuesta (no agrega latencia).
    this.deps.updateMemory?.(accountId, phone, messages.filter((m) => m.role === 'user' || m.role === 'assistant'))
      .catch(() => { /* best-effort */ });
```

Y en `createAgentRuntime.ts`, cablear `updateMemory` componiendo `extractMemoryPatch` + `ContactMemory.merge`:

```typescript
    updateMemory: async (accountId, phone, turns) => {
      const patch = await extractMemoryPatch({ complete: (o) => AIService.complete(o) }, turns);
      await memory.merge(accountId, phone, patch);
    },
```

(importá `extractMemoryPatch` desde `./MemoryUpdater`). Ajustá el test de `AgentRuntime` agregando `updateMemory: vi.fn().mockResolvedValue(undefined)` a `makeDeps` si el type-check lo exige (es opcional, pero declararlo evita romper los tests previos).

- [ ] **Step 6: Type-check + tests del runtime**

Run: `cd server && npx tsc --noEmit && npx vitest run src/core/agent`
Expected: tsc exit 0; tests del agente verdes.

- [ ] **Step 7: Commit**

```bash
git add server/src/core/agent/runtime/MemoryUpdater.ts server/src/core/agent/runtime/__tests__/MemoryUpdater.test.ts server/src/core/agent/runtime/AgentRuntime.ts server/src/core/agent/runtime/createAgentRuntime.ts
git commit -m "feat(agent): actualización de memoria post-conversación (extract + merge)"
```

---

## Task 11: Verificación final + activación del piloto

**Files:** ninguno de código (operación).

- [ ] **Step 1: Suite completa + type-check**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: tsc 0; suite verde (re-correr aislado el flaky de appointments si aparece).

- [ ] **Step 2: Aplicar migración 0015 en Supabase**

Vía `POST /api/config/sync-db` (corre todas las *.sql en orden) o el SQL editor. Verificar que existen `contact_memory`, `account_faqs` y las columnas `agent_*`.

- [ ] **Step 3: Cargar base de conocimiento de la cuenta piloto**

Insertar FAQs reales del estudio en `account_faqs` (pregunta/respuesta/tags) y/o completar `business_context`. Sin esto, el grounding estricto deriva casi todo a humano.

- [ ] **Step 4: Activar el flag en la cuenta piloto**

`UPDATE accounts SET agent_mode='ai_first', agent_name='Sofía' WHERE id='<cuenta_piloto>';`
Kill-switch: volver a `agent_mode='flows'` revierte al instante.

- [ ] **Step 5: Smoke manual**

Mandar por WhatsApp a la línea piloto: (a) saludo abierto, (b) pregunta previsional cubierta por la base, (c) pregunta NO cubierta → debe derivar sin inventar, (d) pedido de turno → debe confirmar antes de agendar.

---

## Self-Review (cobertura del spec)

- §2 Arquitectura (AgentRuntime + loop) → Tasks 8, 9. ✅
- §3 Memoria largo plazo (contact_memory) → Tasks 1, 4, 10. ✅
- §4 Tools + 4 barandas (identidad server-side, confirmar, grounding, derivar) → Tasks 5 (identidad/SLOT_TAKEN/grounding), 6 (reglas de confirmación/derivación en prompt). ✅
- §5 Personalidad + grounding (prompt por capas) → Task 6. ✅
- §6 Datos/migraciones (0015) → Task 1. ✅
- §7 Testing + kill-switch + métricas → tests por task; kill-switch Task 11; métricas: instrumentación queda como follow-up explícito (ver nota abajo). ⚠️
- KnowledgeBase + function-calling → Tasks 3, 7. ✅

**Nota de alcance:** la instrumentación de métricas del piloto (§7: % resueltas, costo/conversación, etc.) NO tiene task de código en este plan — se deja como follow-up para no inflar el alcance del primer corte. El kill-switch y los smoke tests sí están. Si querés las métricas en este corte, se agrega un Task 12 (evento estructurado al cierre de cada conversación del agente).
