# Agente "Cerebro" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página admin-only `/agente` para ver/editar el "cerebro" del agente (tono, datos, procedimientos, FAQs, zonas) y modificarlo conversacionalmente con un config-agent que propone cambios y los aplica a todas las líneas tras confirmar.

**Architecture:** Backend: módulos puros con DI (tipos `Change` → `applyChanges` fan-out, `ConfigToolRegistry` que genera Changes, `ConfigAgent` LLM+tools, `getBrainState`) detrás de un router `/api/agente` admin-only. Runtime: `AgentPersona` inyecta `agent_procedures`. Frontend: página React de dos columnas (cerebro editable + chat).

**Tech Stack:** Node/Express + TypeScript + Supabase (server), Vitest (tests, DI+stubs), React+Vite+Tailwind (client), OpenAI `completeWithTools` (gpt-4o).

**Convenciones del repo:** tests en `__tests__/` con vitest, deps inyectadas (no se mockea el módulo), `norm()` en `server/src/core/agent/context/normalize.ts`, routers factory `xRouter(): Router`, montaje en `server/src/api/app.ts`. Correr tests: `npx vitest run <path>` desde `server/`.

---

## File Structure

**Backend (server/src):**
- `core/agent/config/types.ts` — tipos `Change`, `BrainState`, `BrainDb`, `ApplyResult`.
- `core/agent/config/applyChanges.ts` — aplica `Change[]` fan-out vía `BrainDb`.
- `core/agent/config/SupabaseBrainDb.ts` — impl real de `BrainDb` sobre supabase.
- `core/agent/config/ConfigToolRegistry.ts` — schemas de tools + `toChange(name,args)`.
- `core/agent/config/ConfigAgent.ts` — LLM + tools + state en prompt → `{reply, pendingChanges}`.
- `core/agent/config/getBrainState.ts` — snapshot del cerebro vía `BrainDb`.
- `api/routes/agente.routes.ts` — `GET /state`, `POST /chat`, `POST /apply`.
- `core/agent/runtime/{AgentPersona,types,createAgentRuntime}.ts` — inyectar `agent_procedures` (edits).

**Migración:** `supabase/migrations/0027_agent_procedures.sql`.

**Frontend (client/src):**
- `lib/api.ts` — `agenteApi` (edit).
- `pages/Agente.tsx` — página cerebro + chat.
- `App.tsx`, `components/Layout.tsx` — ruta + nav (edits).
- `public/agente/bot-ok.mp4`, `public/agente/bot-avatar.png` — media.

---

## Task 1: Migración `agent_procedures`

**Files:**
- Create: `supabase/migrations/0027_agent_procedures.sql`

- [ ] **Step 1: Crear la migración**

```sql
-- 0027: "procedimientos" del agente (flujos → instrucciones en lenguaje natural).
-- El cerebro editable del apartado Agente los guarda acá; el runtime IA-primero los
-- inyecta al system prompt. Idempotente.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_procedures text;
```

- [ ] **Step 2: Verificación manual**

Aplicar la migración en Supabase (SQL editor o el flujo de migraciones del proyecto). Confirmar:
`SELECT agent_procedures FROM accounts LIMIT 1;` no da error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0027_agent_procedures.sql
git commit -m "feat(agente): migración 0027 agent_procedures"
```

---

## Task 2: Tipos del cerebro (`Change`, `BrainState`, `BrainDb`)

**Files:**
- Create: `server/src/core/agent/config/types.ts`

- [ ] **Step 1: Escribir los tipos**

```ts
// Tipos del "cerebro" del agente de atención. Un Change es un cambio PROPUESTO
// (lo generan las tools del config-agent o la edición manual); applyChanges lo
// aplica fan-out a todas las cuentas del estudio.

export type Oficina = 'CABA' | 'Quilmes' | 'Haedo';

export type Change =
  | { type: 'set_tono'; texto: string }
  | { type: 'set_datos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'set_procedimientos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'add_faq'; pregunta: string; respuesta: string; tags?: string[] }
  | { type: 'edit_faq'; pregunta: string; nueva_respuesta?: string; nueva_pregunta?: string; tags?: string[] }
  | { type: 'remove_faq'; pregunta: string }
  | { type: 'add_zona'; localidad: string; oficina: Oficina }
  | { type: 'remove_zona'; localidad: string };

export interface BrainFaq { id: string; pregunta: string; respuesta: string; tags: string[] }
export interface BrainZona { id: string; alias: string; oficina: string }

export interface BrainState {
  tono: string | null;
  datos: string | null;
  procedimientos: string | null;
  faqs: BrainFaq[];
  zonas: BrainZona[];
  lineas: number;
}

export interface ApplyResult { change: Change; ok: boolean; error?: string }

// Interfaz de persistencia inyectable (testeable sin supabase).
export type AccountField = 'agent_persona' | 'business_context' | 'agent_procedures';

export interface BrainDb {
  listAccountIds(): Promise<string[]>;
  getField(accountId: string, field: AccountField): Promise<string | null>;
  setField(accountId: string, field: AccountField, value: string): Promise<void>;
  upsertFaq(accountId: string, faq: { pregunta: string; respuesta: string; tags: string[] }): Promise<void>;
  editFaq(accountId: string, pregunta: string, patch: { respuesta?: string; pregunta?: string; tags?: string[] }): Promise<void>;
  removeFaq(accountId: string, pregunta: string): Promise<void>;
  upsertZona(accountId: string, aliasNorm: string, alias: string, oficina: string): Promise<void>;
  removeZona(accountId: string, aliasNorm: string): Promise<void>;
  listFaqs(accountId: string): Promise<BrainFaq[]>;
  listZonas(accountId: string): Promise<BrainZona[]>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add server/src/core/agent/config/types.ts
git commit -m "feat(agente): tipos Change/BrainState/BrainDb del cerebro"
```

---

## Task 3: `applyChanges` (fan-out, idempotente)

**Files:**
- Create: `server/src/core/agent/config/applyChanges.ts`
- Test: `server/src/core/agent/config/__tests__/applyChanges.test.ts`

- [ ] **Step 1: Escribir el test (con un BrainDb fake en memoria)**

```ts
import { describe, it, expect } from 'vitest';
import { applyChanges } from '../applyChanges';
import type { BrainDb, BrainFaq, BrainZona, AccountField } from '../types';

function fakeDb(accountIds = ['a1', 'a2']): BrainDb & { fields: Record<string, any>; faqs: Record<string, BrainFaq[]>; zonas: Record<string, BrainZona[]> } {
  const fields: Record<string, any> = {};
  const faqs: Record<string, BrainFaq[]> = { a1: [], a2: [] };
  const zonas: Record<string, BrainZona[]> = { a1: [], a2: [] };
  return {
    fields, faqs, zonas,
    async listAccountIds() { return accountIds; },
    async getField(id: string, f: AccountField) { return fields[`${id}:${f}`] ?? null; },
    async setField(id: string, f: AccountField, v: string) { fields[`${id}:${f}`] = v; },
    async upsertFaq(id, faq) {
      const list = faqs[id]; const ex = list.find((x) => x.pregunta === faq.pregunta);
      if (ex) { ex.respuesta = faq.respuesta; ex.tags = faq.tags; }
      else list.push({ id: `${id}-${list.length}`, ...faq });
    },
    async editFaq(id, pregunta, patch) {
      const ex = faqs[id].find((x) => x.pregunta === pregunta); if (!ex) return;
      if (patch.respuesta !== undefined) ex.respuesta = patch.respuesta;
      if (patch.pregunta !== undefined) ex.pregunta = patch.pregunta;
      if (patch.tags !== undefined) ex.tags = patch.tags;
    },
    async removeFaq(id, pregunta) { faqs[id] = faqs[id].filter((x) => x.pregunta !== pregunta); },
    async upsertZona(id, aliasNorm, alias, oficina) {
      const ex = zonas[id].find((z) => z.alias === aliasNorm);
      if (!ex) zonas[id].push({ id: `${id}-z${zonas[id].length}`, alias: aliasNorm, oficina });
    },
    async removeZona(id, aliasNorm) { zonas[id] = zonas[id].filter((z) => z.alias !== aliasNorm); },
    async listFaqs(id) { return faqs[id]; },
    async listZonas(id) { return zonas[id]; },
  };
}

describe('applyChanges — fan-out a todas las cuentas', () => {
  it('set_tono escribe agent_persona en TODAS las cuentas', async () => {
    const db = fakeDb();
    const res = await applyChanges([{ type: 'set_tono', texto: 'cálido' }], db);
    expect(res[0].ok).toBe(true);
    expect(db.fields['a1:agent_persona']).toBe('cálido');
    expect(db.fields['a2:agent_persona']).toBe('cálido');
  });

  it('set_datos modo agregar concatena al valor previo', async () => {
    const db = fakeDb();
    db.fields['a1:business_context'] = 'Horario L-V.';
    db.fields['a2:business_context'] = 'Horario L-V.';
    await applyChanges([{ type: 'set_datos', texto: 'Consulta $29.000.', modo: 'agregar' }], db);
    expect(db.fields['a1:business_context']).toContain('Horario L-V.');
    expect(db.fields['a1:business_context']).toContain('Consulta $29.000.');
  });

  it('add_faq es idempotente (no duplica por pregunta)', async () => {
    const db = fakeDb();
    const ch = { type: 'add_faq' as const, pregunta: '¿Precio?', respuesta: '$29.000', tags: ['precio'] };
    await applyChanges([ch], db);
    await applyChanges([ch], db);
    expect(db.faqs.a1).toHaveLength(1);
    expect(db.faqs.a2).toHaveLength(1);
  });

  it('add_zona normaliza la localidad e inserta en todas', async () => {
    const db = fakeDb();
    await applyChanges([{ type: 'add_zona', localidad: 'Lanús', oficina: 'Quilmes' }], db);
    expect(db.zonas.a1[0].alias).toBe('lanus');   // normalizado
    expect(db.zonas.a2[0].oficina).toBe('Quilmes');
  });

  it('remove_faq borra por pregunta en todas', async () => {
    const db = fakeDb();
    await applyChanges([{ type: 'add_faq', pregunta: 'X', respuesta: 'y' }], db);
    await applyChanges([{ type: 'remove_faq', pregunta: 'X' }], db);
    expect(db.faqs.a1).toHaveLength(0);
  });

  it('un tipo desconocido devuelve ok:false sin romper los demás', async () => {
    const db = fakeDb();
    const res = await applyChanges([{ type: 'set_tono', texto: 't' }, { type: 'wat' } as any], db);
    expect(res[0].ok).toBe(true);
    expect(res[1].ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/applyChanges.test.ts`
Expected: FAIL — "Cannot find module '../applyChanges'".

- [ ] **Step 3: Implementar applyChanges**

```ts
import type { Change, BrainDb, ApplyResult } from './types';
import { norm } from '../context/normalize';

async function forEachAccount(db: BrainDb, fn: (id: string) => Promise<void>): Promise<void> {
  const ids = await db.listAccountIds();
  for (const id of ids) await fn(id);
}

async function applyOne(change: Change, db: BrainDb): Promise<void> {
  switch (change.type) {
    case 'set_tono':
      return forEachAccount(db, (id) => db.setField(id, 'agent_persona', change.texto));
    case 'set_datos':
    case 'set_procedimientos': {
      const field = change.type === 'set_datos' ? 'business_context' : 'agent_procedures';
      return forEachAccount(db, async (id) => {
        let value = change.texto;
        if (change.modo === 'agregar') {
          const prev = (await db.getField(id, field)) ?? '';
          value = prev.trim() ? `${prev.trim()}\n${change.texto}` : change.texto;
        }
        await db.setField(id, field, value);
      });
    }
    case 'add_faq':
      return forEachAccount(db, (id) => db.upsertFaq(id, { pregunta: change.pregunta, respuesta: change.respuesta, tags: change.tags ?? [] }));
    case 'edit_faq':
      return forEachAccount(db, (id) => db.editFaq(id, change.pregunta, { respuesta: change.nueva_respuesta, pregunta: change.nueva_pregunta, tags: change.tags }));
    case 'remove_faq':
      return forEachAccount(db, (id) => db.removeFaq(id, change.pregunta));
    case 'add_zona':
      return forEachAccount(db, (id) => db.upsertZona(id, norm(change.localidad), change.localidad, change.oficina));
    case 'remove_zona':
      return forEachAccount(db, (id) => db.removeZona(id, norm(change.localidad)));
    default:
      throw new Error(`tipo de cambio desconocido: ${(change as any).type}`);
  }
}

/** Aplica cada Change fan-out a todas las cuentas. Un cambio que falla no corta los demás. */
export async function applyChanges(changes: Change[], db: BrainDb): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const change of changes) {
    try { await applyOne(change, db); out.push({ change, ok: true }); }
    catch (e: any) { out.push({ change, ok: false, error: String(e?.message ?? e) }); }
  }
  return out;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/applyChanges.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/config/applyChanges.ts server/src/core/agent/config/__tests__/applyChanges.test.ts
git commit -m "feat(agente): applyChanges fan-out idempotente del cerebro"
```

---

## Task 4: `ConfigToolRegistry` (orden → Change)

**Files:**
- Create: `server/src/core/agent/config/ConfigToolRegistry.ts`
- Test: `server/src/core/agent/config/__tests__/ConfigToolRegistry.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
import { describe, it, expect } from 'vitest';
import { ConfigToolRegistry } from '../ConfigToolRegistry';

const reg = new ConfigToolRegistry();

describe('ConfigToolRegistry', () => {
  it('expone los esquemas de tools', () => {
    const names = reg.schemas().map((s: any) => s.function.name).sort();
    expect(names).toEqual([
      'add_faq', 'add_zona', 'edit_faq', 'remove_faq', 'remove_zona',
      'set_datos', 'set_procedimientos', 'set_tono',
    ]);
  });

  it('set_tono → Change set_tono', () => {
    expect(reg.toChange('set_tono', { texto: 'cálido' })).toEqual({ type: 'set_tono', texto: 'cálido' });
  });

  it('set_datos default modo=agregar', () => {
    expect(reg.toChange('set_datos', { texto: 'x' })).toMatchObject({ type: 'set_datos', modo: 'agregar' });
  });

  it('add_zona valida la oficina (rechaza inválida)', () => {
    expect(reg.toChange('add_zona', { localidad: 'Lanús', oficina: 'CABA' })).toMatchObject({ type: 'add_zona', oficina: 'CABA' });
    expect(reg.toChange('add_zona', { localidad: 'X', oficina: 'Marte' })).toBeNull();
  });

  it('add_faq sin respuesta → null', () => {
    expect(reg.toChange('add_faq', { pregunta: '¿precio?' })).toBeNull();
    expect(reg.toChange('add_faq', { pregunta: '¿precio?', respuesta: '$29.000' })).toMatchObject({ type: 'add_faq' });
  });

  it('tool desconocida → null', () => {
    expect(reg.toChange('hack', {})).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/ConfigToolRegistry.test.ts`
Expected: FAIL — "Cannot find module '../ConfigToolRegistry'".

- [ ] **Step 3: Implementar ConfigToolRegistry**

```ts
import type { Change, Oficina } from './types';

const OFICINAS: Oficina[] = ['CABA', 'Quilmes', 'Haedo'];

const SCHEMAS = [
  { type: 'function', function: { name: 'set_tono', description: 'Reemplaza el tono/personalidad del agente.', parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'set_datos', description: 'Setea o agrega datos del estudio (horarios, precios, direcciones). modo: reemplazar | agregar (default agregar).', parameters: { type: 'object', properties: { texto: { type: 'string' }, modo: { type: 'string', enum: ['reemplazar', 'agregar'] } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'set_procedimientos', description: 'Setea o agrega instrucciones de cómo proceder (los "flujos" en lenguaje natural). modo: reemplazar | agregar (default agregar).', parameters: { type: 'object', properties: { texto: { type: 'string' }, modo: { type: 'string', enum: ['reemplazar', 'agregar'] } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'add_faq', description: 'Agrega una pregunta frecuente con su respuesta.', parameters: { type: 'object', properties: { pregunta: { type: 'string' }, respuesta: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['pregunta', 'respuesta'] } } },
  { type: 'function', function: { name: 'edit_faq', description: 'Edita una FAQ existente (identificada por su pregunta actual).', parameters: { type: 'object', properties: { pregunta: { type: 'string' }, nueva_respuesta: { type: 'string' }, nueva_pregunta: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['pregunta'] } } },
  { type: 'function', function: { name: 'remove_faq', description: 'Borra una FAQ por su pregunta.', parameters: { type: 'object', properties: { pregunta: { type: 'string' } }, required: ['pregunta'] } } },
  { type: 'function', function: { name: 'add_zona', description: 'Asocia una localidad a una oficina (CABA, Quilmes o Haedo) para el geo-routing.', parameters: { type: 'object', properties: { localidad: { type: 'string' }, oficina: { type: 'string', enum: OFICINAS } }, required: ['localidad', 'oficina'] } } },
  { type: 'function', function: { name: 'remove_zona', description: 'Quita una localidad del geo-routing.', parameters: { type: 'object', properties: { localidad: { type: 'string' } }, required: ['localidad'] } } },
];

const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');

export class ConfigToolRegistry {
  schemas() { return SCHEMAS; }

  /** Convierte una tool-call del modelo en un Change validado. null si es inválida. */
  toChange(name: string, args: any): Change | null {
    switch (name) {
      case 'set_tono':
        return str(args?.texto) ? { type: 'set_tono', texto: str(args.texto) } : null;
      case 'set_datos':
        return str(args?.texto) ? { type: 'set_datos', texto: str(args.texto), modo: args?.modo === 'reemplazar' ? 'reemplazar' : 'agregar' } : null;
      case 'set_procedimientos':
        return str(args?.texto) ? { type: 'set_procedimientos', texto: str(args.texto), modo: args?.modo === 'reemplazar' ? 'reemplazar' : 'agregar' } : null;
      case 'add_faq':
        return str(args?.pregunta) && str(args?.respuesta) ? { type: 'add_faq', pregunta: str(args.pregunta), respuesta: str(args.respuesta), tags: Array.isArray(args?.tags) ? args.tags : [] } : null;
      case 'edit_faq':
        return str(args?.pregunta) ? { type: 'edit_faq', pregunta: str(args.pregunta), nueva_respuesta: str(args?.nueva_respuesta) || undefined, nueva_pregunta: str(args?.nueva_pregunta) || undefined, tags: Array.isArray(args?.tags) ? args.tags : undefined } : null;
      case 'remove_faq':
        return str(args?.pregunta) ? { type: 'remove_faq', pregunta: str(args.pregunta) } : null;
      case 'add_zona':
        return str(args?.localidad) && OFICINAS.includes(args?.oficina) ? { type: 'add_zona', localidad: str(args.localidad), oficina: args.oficina } : null;
      case 'remove_zona':
        return str(args?.localidad) ? { type: 'remove_zona', localidad: str(args.localidad) } : null;
      default:
        return null;
    }
  }
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/ConfigToolRegistry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/config/ConfigToolRegistry.ts server/src/core/agent/config/__tests__/ConfigToolRegistry.test.ts
git commit -m "feat(agente): ConfigToolRegistry (orden → Change validado)"
```

---

## Task 5: `ConfigAgent` (LLM + tools → propuesta)

**Files:**
- Create: `server/src/core/agent/config/ConfigAgent.ts`
- Test: `server/src/core/agent/config/__tests__/ConfigAgent.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ConfigAgent } from '../ConfigAgent';
import { ConfigToolRegistry } from '../ConfigToolRegistry';
import type { BrainState } from '../types';

const state: BrainState = { tono: 'neutro', datos: 'L-V 9-18', procedimientos: null, faqs: [], zonas: [], lineas: 4 };

it('mapea las tool-calls del modelo a pendingChanges', async () => {
  const ai = { completeWithTools: vi.fn().mockResolvedValue({ toolCalls: [
    { id: 'c1', name: 'set_tono', args: { texto: 'cálido con mayores' } },
    { id: 'c2', name: 'add_faq', args: { pregunta: '¿precio?', respuesta: '$29.000' } },
  ] }) };
  const agent = new ConfigAgent({ ai, registry: new ConfigToolRegistry() });
  const r = await agent.handle([{ role: 'user', content: 'sé más cálido y agregá el precio' }], state);
  expect(r.pendingChanges).toHaveLength(2);
  expect(r.pendingChanges[0]).toMatchObject({ type: 'set_tono' });
  expect(r.reply).toBeTruthy();
});

it('si el modelo responde texto (sin tools), no propone cambios', async () => {
  const ai = { completeWithTools: vi.fn().mockResolvedValue({ content: 'Listo, ¿algo más?' }) };
  const agent = new ConfigAgent({ ai, registry: new ConfigToolRegistry() });
  const r = await agent.handle([{ role: 'user', content: 'gracias' }], state);
  expect(r.pendingChanges).toHaveLength(0);
  expect(r.reply).toBe('Listo, ¿algo más?');
});

it('descarta tool-calls inválidas (no las propone)', async () => {
  const ai = { completeWithTools: vi.fn().mockResolvedValue({ toolCalls: [{ id: 'c1', name: 'add_zona', args: { localidad: 'X', oficina: 'Marte' } }] }) };
  const agent = new ConfigAgent({ ai, registry: new ConfigToolRegistry() });
  const r = await agent.handle([{ role: 'user', content: 'x' }], state);
  expect(r.pendingChanges).toHaveLength(0);
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/ConfigAgent.test.ts`
Expected: FAIL — "Cannot find module '../ConfigAgent'".

- [ ] **Step 3: Implementar ConfigAgent**

```ts
import type { Change, BrainState } from './types';
import type { ConfigToolRegistry } from './ConfigToolRegistry';

export interface ConfigAgentDeps {
  ai: { completeWithTools: (opts: any) => Promise<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> }> };
  registry: ConfigToolRegistry;
  apiKey?: string;
  model?: string;
}

const DEFAULT_REPLY = 'Preparé los cambios, revisalos abajo y aplicá si está bien. 👇';

function buildSystemPrompt(state: BrainState): string {
  const faqs = state.faqs.length ? state.faqs.map((f) => `- ${f.pregunta} → ${f.respuesta}`).join('\n') : '(sin FAQs)';
  const zonas = state.zonas.length ? state.zonas.map((z) => `- ${z.alias} → ${z.oficina}`).join('\n') : '(sin zonas)';
  return [
    'Sos el asistente de configuración del "cerebro" del agente de atención de un estudio previsional.',
    'El admin te da órdenes en lenguaje natural para mejorar la atención. Para CADA pedido, llamá la/las',
    'tools correspondientes con el cambio propuesto. NO confirmes vos: el admin confirma después.',
    'Si el pedido no implica un cambio concreto, respondé con texto pidiendo precisión.',
    '',
    'ESTADO ACTUAL DEL CEREBRO:',
    `TONO: ${state.tono ?? '(vacío)'}`,
    `DATOS: ${state.datos ?? '(vacío)'}`,
    `PROCEDIMIENTOS: ${state.procedimientos ?? '(vacío)'}`,
    `FAQs:\n${faqs}`,
    `ZONAS:\n${zonas}`,
  ].join('\n');
}

export class ConfigAgent {
  constructor(private deps: ConfigAgentDeps) {}

  async handle(messages: Array<{ role: 'user' | 'assistant'; content: string }>, state: BrainState): Promise<{ reply: string; pendingChanges: Change[] }> {
    const res = await this.deps.ai.completeWithTools({
      systemPrompt: buildSystemPrompt(state),
      messages,
      tools: this.deps.registry.schemas(),
      apiKey: this.deps.apiKey,
      model: this.deps.model ?? 'gpt-4o',
    });
    if (!res.toolCalls?.length) {
      return { reply: (res.content && res.content.trim()) || '¿Qué querés ajustar del agente?', pendingChanges: [] };
    }
    const pendingChanges = res.toolCalls
      .map((c) => this.deps.registry.toChange(c.name, c.args))
      .filter((c): c is Change => c !== null);
    return { reply: (res.content && res.content.trim()) || DEFAULT_REPLY, pendingChanges };
  }
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/ConfigAgent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/config/ConfigAgent.ts server/src/core/agent/config/__tests__/ConfigAgent.test.ts
git commit -m "feat(agente): ConfigAgent (LLM + tools → cambios propuestos)"
```

---

## Task 6: `SupabaseBrainDb` + `getBrainState`

**Files:**
- Create: `server/src/core/agent/config/SupabaseBrainDb.ts`
- Create: `server/src/core/agent/config/getBrainState.ts`
- Test: `server/src/core/agent/config/__tests__/getBrainState.test.ts`

- [ ] **Step 1: Escribir el test de getBrainState (con BrainDb fake)**

```ts
import { describe, it, expect } from 'vitest';
import { getBrainState } from '../getBrainState';
import type { BrainDb } from '../types';

const db: BrainDb = {
  async listAccountIds() { return ['a1', 'a2', 'a3']; },
  async getField(id, f) { return id === 'a1' && f === 'agent_persona' ? 'cálido' : id === 'a1' && f === 'business_context' ? 'L-V 9-18' : null; },
  async setField() {}, async upsertFaq() {}, async editFaq() {}, async removeFaq() {}, async upsertZona() {}, async removeZona() {},
  async listFaqs(id) { return id === 'a1' ? [{ id: 'f1', pregunta: '¿precio?', respuesta: '$29.000', tags: [] }] : []; },
  async listZonas(id) { return id === 'a1' ? [{ id: 'z1', alias: 'lanus', oficina: 'Quilmes' }] : []; },
};

it('arma el snapshot desde la cuenta de referencia + cuenta las líneas', async () => {
  const s = await getBrainState(db);
  expect(s.tono).toBe('cálido');
  expect(s.datos).toBe('L-V 9-18');
  expect(s.faqs).toHaveLength(1);
  expect(s.zonas[0].oficina).toBe('Quilmes');
  expect(s.lineas).toBe(3);
});

it('sin cuentas → estado vacío, lineas 0', async () => {
  const empty: BrainDb = { ...db, listAccountIds: async () => [] };
  const s = await getBrainState(empty);
  expect(s.lineas).toBe(0);
  expect(s.faqs).toEqual([]);
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/getBrainState.test.ts`
Expected: FAIL — "Cannot find module '../getBrainState'".

- [ ] **Step 3: Implementar getBrainState**

```ts
import type { BrainDb, BrainState } from './types';

/** Snapshot del cerebro: lee de la primera cuenta (el fan-out las mantiene idénticas). */
export async function getBrainState(db: BrainDb): Promise<BrainState> {
  const ids = await db.listAccountIds();
  const ref = ids[0];
  if (!ref) return { tono: null, datos: null, procedimientos: null, faqs: [], zonas: [], lineas: 0 };
  const [tono, datos, procedimientos, faqs, zonas] = await Promise.all([
    db.getField(ref, 'agent_persona'),
    db.getField(ref, 'business_context'),
    db.getField(ref, 'agent_procedures'),
    db.listFaqs(ref),
    db.listZonas(ref),
  ]);
  return { tono, datos, procedimientos, faqs, zonas, lineas: ids.length };
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd server && npx vitest run src/core/agent/config/__tests__/getBrainState.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implementar SupabaseBrainDb (impl real, sin test unitario — es glue de DB)**

```ts
import { supabase } from '../../../config/supabase';
import type { BrainDb, BrainFaq, BrainZona, AccountField } from './types';

// Impl real de BrainDb. El "estudio" = todas las cuentas (app de un solo estudio,
// igual que accounts.routes GET que hace select('*') sin filtrar por user_id).
export class SupabaseBrainDb implements BrainDb {
  async listAccountIds(): Promise<string[]> {
    const { data } = await supabase.from('accounts').select('id');
    return ((data ?? []) as any[]).map((a) => a.id);
  }
  async getField(accountId: string, field: AccountField): Promise<string | null> {
    const { data } = await supabase.from('accounts').select(field).eq('id', accountId).maybeSingle();
    return (data as any)?.[field] ?? null;
  }
  async setField(accountId: string, field: AccountField, value: string): Promise<void> {
    await supabase.from('accounts').update({ [field]: value }).eq('id', accountId);
  }
  async listFaqs(accountId: string): Promise<BrainFaq[]> {
    const { data } = await supabase.from('account_faqs').select('id, pregunta, respuesta, tags').eq('account_id', accountId);
    return ((data ?? []) as any[]).map((f) => ({ id: f.id, pregunta: f.pregunta, respuesta: f.respuesta, tags: f.tags ?? [] }));
  }
  async upsertFaq(accountId: string, faq: { pregunta: string; respuesta: string; tags: string[] }): Promise<void> {
    const { data } = await supabase.from('account_faqs').select('id').eq('account_id', accountId).eq('pregunta', faq.pregunta).maybeSingle();
    if (data?.id) await supabase.from('account_faqs').update({ respuesta: faq.respuesta, tags: faq.tags }).eq('id', data.id);
    else await supabase.from('account_faqs').insert({ account_id: accountId, pregunta: faq.pregunta, respuesta: faq.respuesta, tags: faq.tags });
  }
  async editFaq(accountId: string, pregunta: string, patch: { respuesta?: string; pregunta?: string; tags?: string[] }): Promise<void> {
    const upd: any = {};
    if (patch.respuesta !== undefined) upd.respuesta = patch.respuesta;
    if (patch.pregunta !== undefined) upd.pregunta = patch.pregunta;
    if (patch.tags !== undefined) upd.tags = patch.tags;
    if (Object.keys(upd).length === 0) return;
    await supabase.from('account_faqs').update(upd).eq('account_id', accountId).eq('pregunta', pregunta);
  }
  async removeFaq(accountId: string, pregunta: string): Promise<void> {
    await supabase.from('account_faqs').delete().eq('account_id', accountId).eq('pregunta', pregunta);
  }
  async listZonas(accountId: string): Promise<BrainZona[]> {
    const { data } = await supabase.from('zone_gazetteer').select('id, alias_norm, oficina').eq('account_id', accountId);
    return ((data ?? []) as any[]).map((z) => ({ id: String(z.id), alias: z.alias_norm, oficina: z.oficina }));
  }
  async upsertZona(accountId: string, aliasNorm: string, alias: string, oficina: string): Promise<void> {
    await supabase.from('zone_gazetteer').upsert({ account_id: accountId, alias, alias_norm: aliasNorm, oficina }, { onConflict: 'account_id,alias_norm' });
  }
  async removeZona(accountId: string, aliasNorm: string): Promise<void> {
    await supabase.from('zone_gazetteer').delete().eq('account_id', accountId).eq('alias_norm', aliasNorm);
  }
}
```

- [ ] **Step 6: Type-check + commit**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

```bash
git add server/src/core/agent/config/SupabaseBrainDb.ts server/src/core/agent/config/getBrainState.ts server/src/core/agent/config/__tests__/getBrainState.test.ts
git commit -m "feat(agente): getBrainState + SupabaseBrainDb"
```

---

## Task 7: Runtime — inyectar `agent_procedures` en el prompt

**Files:**
- Modify: `server/src/core/agent/runtime/types.ts` (interface `AgentAccountConfig`)
- Modify: `server/src/core/agent/runtime/AgentPersona.ts`
- Modify: `server/src/core/agent/runtime/createAgentRuntime.ts:13-26` (`loadAccount`)
- Test: `server/src/core/agent/runtime/__tests__/AgentPersona.test.ts` (agregar caso)

- [ ] **Step 1: Agregar el test del bloque de procedimientos**

En `server/src/core/agent/runtime/__tests__/AgentPersona.test.ts`, agregar dentro del `describe('buildPersona', ...)`:

```ts
  it('inyecta PROCEDIMIENTOS cuando la cuenta los tiene', () => {
    const prompt = buildPersona(
      { accountId: 'acc1', agentName: 'Sofía', agentProcedures: 'Despido: preguntá hace cuánto y la edad.' } as any,
      'FICHA: nuevo.',
    );
    expect(prompt.toUpperCase()).toContain('PROCEDIMIENTOS');
    expect(prompt).toContain('preguntá hace cuánto');
  });
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts`
Expected: FAIL — el prompt no contiene "PROCEDIMIENTOS".

- [ ] **Step 3: Agregar `agentProcedures` al tipo**

En `server/src/core/agent/runtime/types.ts`, dentro de `interface AgentAccountConfig`, agregar después de `businessContext`:

```ts
  agentProcedures?: string | null;
```

- [ ] **Step 4: Inyectar el bloque en AgentPersona**

En `server/src/core/agent/runtime/AgentPersona.ts`, dentro del array que arma el prompt, agregar JUSTO ANTES de la línea `account.businessContext ? \`DATOS DEL ESTUDIO...\` : ''`:

```ts
    account.agentProcedures?.trim()
      ? `PROCEDIMIENTOS (seguí estas instrucciones del estudio para atender):\n${account.agentProcedures.trim()}\n`
      : '',
```

- [ ] **Step 5: Cargar la columna en loadAccount**

En `server/src/core/agent/runtime/createAgentRuntime.ts`, en `loadAccount` (líneas ~14-25): agregar `agent_procedures` al `.select(...)` y al objeto devuelto.

Select:
```ts
    .select('id, name, agent_name, agent_persona, business_context, agent_procedures, ai_api_key, ai_model')
```
Objeto (agregar la propiedad):
```ts
    agentProcedures: data?.agent_procedures ?? null,
```

- [ ] **Step 6: Correr tests del runtime y verlos pasar**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Type-check + commit**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

```bash
git add server/src/core/agent/runtime/types.ts server/src/core/agent/runtime/AgentPersona.ts server/src/core/agent/runtime/createAgentRuntime.ts server/src/core/agent/runtime/__tests__/AgentPersona.test.ts
git commit -m "feat(agente): runtime inyecta agent_procedures (flujos como instrucciones)"
```

---

## Task 8: Router `/api/agente` + montaje admin-only

**Files:**
- Create: `server/src/api/routes/agente.routes.ts`
- Modify: `server/src/api/app.ts` (montaje, junto a los otros routers admin ~línea 84)

- [ ] **Step 1: Implementar el router**

```ts
import { Router } from 'express';
import { AIService } from '../../services/AIService';
import { SupabaseBrainDb } from '../../core/agent/config/SupabaseBrainDb';
import { getBrainState } from '../../core/agent/config/getBrainState';
import { applyChanges } from '../../core/agent/config/applyChanges';
import { ConfigAgent } from '../../core/agent/config/ConfigAgent';
import { ConfigToolRegistry } from '../../core/agent/config/ConfigToolRegistry';
import type { Change } from '../../core/agent/config/types';

/**
 * Apartado "Agente": cerebro editable + config-agent. Solo admin: se monta detrás
 * de requireRole('admin') en app.ts. El config-agent PROPONE (POST /chat); recién
 * POST /apply escribe, fan-out a todas las cuentas del estudio.
 */
export function agenteRouter(): Router {
  const r = Router();
  const db = new SupabaseBrainDb();
  const agent = new ConfigAgent({ ai: { completeWithTools: (o) => AIService.completeWithTools(o) }, registry: new ConfigToolRegistry() });

  r.get('/state', async (_req, res) => {
    try { res.json(await getBrainState(db)); }
    catch (e: any) { res.status(500).json({ error: e?.message ?? 'error' }); }
  });

  r.post('/chat', async (req, res) => {
    try {
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const state = await getBrainState(db);
      res.json(await agent.handle(messages, state));
    } catch (e: any) { res.status(500).json({ error: e?.message ?? 'error' }); }
  });

  r.post('/apply', async (req, res) => {
    try {
      const changes = (Array.isArray(req.body?.changes) ? req.body.changes : []) as Change[];
      const results = await applyChanges(changes, db);
      res.json({ applied: results.filter((x) => x.ok).length, results });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? 'error' }); }
  });

  return r;
}
```

- [ ] **Step 2: Montar el router (admin-only)**

En `server/src/api/app.ts`, junto a los otros `requireRole('admin')` (después de la línea de `/api/analytics`), agregar:

```ts
  app.use('/api/agente', authContext, requireRole('admin'), agenteRouter());
```
Y el import arriba (junto a los otros routers):
```ts
import { agenteRouter } from './routes/agente.routes';
```

- [ ] **Step 3: Type-check + arranque**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Verificación manual (con el server corriendo y OPENAI_API_KEY)**

```bash
curl -s -H 'Authorization: Bearer dev-token' http://localhost:3001/api/agente/state | head
# Esperado: JSON { tono, datos, procedimientos, faqs, zonas, lineas }
```

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes/agente.routes.ts server/src/api/app.ts
git commit -m "feat(agente): router /api/agente (state/chat/apply) admin-only"
```

---

## Task 9: Mover los recursos (media)

**Files:**
- Create: `client/public/agente/bot-ok.mp4` (desde `recursos/vien_crea_un_video_corto_donde.mp4`)
- Create: `client/public/agente/bot-avatar.png` (desde `recursos/Gemini_Generated_Image_6ueuip6ueuip6ueu.png`)

- [ ] **Step 1: Copiar y renombrar**

```bash
mkdir -p client/public/agente
cp "recursos/vien_crea_un_video_corto_donde.mp4" client/public/agente/bot-ok.mp4
cp "recursos/Gemini_Generated_Image_6ueuip6ueuip6ueu.png" client/public/agente/bot-avatar.png
```

- [ ] **Step 2: Commit**

```bash
git add client/public/agente/bot-ok.mp4 client/public/agente/bot-avatar.png
git commit -m "chore(agente): media del apartado (animación + avatar)"
```

---

## Task 10: Frontend — `agenteApi`

**Files:**
- Modify: `client/src/lib/api.ts` (agregar al final, antes de `apiBase`)

- [ ] **Step 1: Agregar el cliente API**

En `client/src/lib/api.ts`, agregar antes de la línea `// Para mostrar URLs absolutas...`:

```ts
// ── Agente (cerebro editable, solo admin) ───────────────────
export type AgenteOficina = 'CABA' | 'Quilmes' | 'Haedo';
export type AgenteChange =
  | { type: 'set_tono'; texto: string }
  | { type: 'set_datos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'set_procedimientos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'add_faq'; pregunta: string; respuesta: string; tags?: string[] }
  | { type: 'edit_faq'; pregunta: string; nueva_respuesta?: string; nueva_pregunta?: string; tags?: string[] }
  | { type: 'remove_faq'; pregunta: string }
  | { type: 'add_zona'; localidad: string; oficina: AgenteOficina }
  | { type: 'remove_zona'; localidad: string };

export interface BrainState {
  tono: string | null;
  datos: string | null;
  procedimientos: string | null;
  faqs: Array<{ id: string; pregunta: string; respuesta: string; tags: string[] }>;
  zonas: Array<{ id: string; alias: string; oficina: string }>;
  lineas: number;
}

export const agenteApi = {
  state: () => api<BrainState>('/api/agente/state'),
  chat: (messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    api<{ reply: string; pendingChanges: AgenteChange[] }>('/api/agente/chat', {
      method: 'POST', body: JSON.stringify({ messages }),
    }),
  apply: (changes: AgenteChange[]) =>
    api<{ applied: number; results: Array<{ change: AgenteChange; ok: boolean; error?: string }> }>(
      '/api/agente/apply', { method: 'POST', body: JSON.stringify({ changes }) }),
};
```

- [ ] **Step 2: Type-check + commit**

Run: `cd client && npx tsc -b --noEmit` (o `npm run build` si no existe el script)
Expected: sin errores.

```bash
git add client/src/lib/api.ts
git commit -m "feat(agente): agenteApi (state/chat/apply) en el cliente"
```

---

## Task 11: Frontend — página `/agente`

**Files:**
- Create: `client/src/pages/Agente.tsx`
- Modify: `client/src/App.tsx` (lazy import + ruta admin)
- Modify: `client/src/components/Layout.tsx` (nav item)

- [ ] **Step 1: Crear la página**

```tsx
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Brain, Send, Loader2 } from 'lucide-react';
import { agenteApi, type BrainState, type AgenteChange } from '../lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };

// Descripción legible de un cambio propuesto (para la tarjeta de confirmación).
function describeChange(c: AgenteChange): string {
  switch (c.type) {
    case 'set_tono': return `Tono → "${c.texto}"`;
    case 'set_datos': return `Datos (${c.modo}): "${c.texto}"`;
    case 'set_procedimientos': return `Procedimientos (${c.modo}): "${c.texto}"`;
    case 'add_faq': return `Nueva FAQ: "${c.pregunta}" → "${c.respuesta}"`;
    case 'edit_faq': return `Editar FAQ "${c.pregunta}"${c.nueva_respuesta ? ` → "${c.nueva_respuesta}"` : ''}`;
    case 'remove_faq': return `Borrar FAQ "${c.pregunta}"`;
    case 'add_zona': return `Zona: ${c.localidad} → ${c.oficina}`;
    case 'remove_zona': return `Quitar zona "${c.localidad}"`;
  }
}

export default function Agente() {
  const [state, setState] = useState<BrainState | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<AgenteChange[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadState = () => agenteApi.state().then(setState).catch((e) => toast.error(e.message));
  useEffect(() => { loadState(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pending]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next); setInput(''); setBusy(true); setPending([]);
    try {
      const r = await agenteApi.chat(next);
      setMessages([...next, { role: 'assistant', content: r.reply }]);
      setPending(r.pendingChanges);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function apply() {
    if (!pending.length) return;
    setBusy(true);
    try {
      const r = await agenteApi.apply(pending);
      toast.success(`Aplicado a ${state?.lineas ?? 0} línea(s) — ${r.applied} cambio(s)`);
      setPending([]); await loadState();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 h-full">
      {/* Cerebro */}
      <section className="space-y-3 overflow-y-auto">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-brand-ink"><Brain size={20} /> Cerebro del agente</h1>
        {!state ? <Loader2 className="animate-spin" /> : (
          <>
            <Card title="Tono">{state.tono || <em className="text-gray-400">(vacío)</em>}</Card>
            <Card title="Datos del estudio">{state.datos || <em className="text-gray-400">(vacío)</em>}</Card>
            <Card title="Procedimientos">{state.procedimientos || <em className="text-gray-400">(vacío)</em>}</Card>
            <Card title={`FAQs (${state.faqs.length})`}>
              <ul className="list-disc pl-4 space-y-1">{state.faqs.map((f) => <li key={f.id}><b>{f.pregunta}</b> → {f.respuesta}</li>)}</ul>
            </Card>
            <Card title={`Zonas (${state.zonas.length})`}>
              <ul className="list-disc pl-4 space-y-1">{state.zonas.map((z) => <li key={z.id}>{z.alias} → {z.oficina}</li>)}</ul>
            </Card>
          </>
        )}
      </section>

      {/* Chat */}
      <section className="flex flex-col border border-gray-200 rounded-xl bg-white min-h-[400px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center text-center text-gray-500 mt-8">
              <video src="/agente/bot-ok.mp4" autoPlay loop muted playsInline className="w-32 h-32 object-contain" />
              <p className="mt-2">Decime qué mejorar de la atención y lo preparo. 👋</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <span className={`inline-block px-3 py-2 rounded-2xl text-sm ${m.role === 'user' ? 'bg-brand-secondary text-white' : 'bg-gray-100 text-brand-ink'}`}>{m.content}</span>
            </div>
          ))}
          {pending.length > 0 && (
            <div className="border border-brand-secondary/40 rounded-lg p-3 bg-brand-ivory">
              <p className="font-semibold text-sm mb-2">Cambios propuestos:</p>
              <ol className="list-decimal pl-5 text-sm space-y-1">{pending.map((c, i) => <li key={i}>{describeChange(c)}</li>)}</ol>
              <div className="flex gap-2 mt-3">
                <button onClick={apply} disabled={busy} className="px-3 py-1.5 rounded-lg bg-brand-secondary text-white text-sm disabled:opacity-50">Aplicar a las {state?.lineas ?? 0} líneas</button>
                <button onClick={() => setPending([])} disabled={busy} className="px-3 py-1.5 rounded-lg border text-sm">Descartar</button>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 p-3 border-t">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ej: sé más cálido con los mayores" className="flex-1 px-3 py-2 rounded-lg border text-sm" disabled={busy} />
          <button onClick={send} disabled={busy} className="px-3 py-2 rounded-lg bg-brand-secondary text-white disabled:opacity-50">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-xl bg-white p-3">
      <h2 className="text-sm font-semibold text-brand-secondary mb-1">{title}</h2>
      <div className="text-sm text-brand-ink whitespace-pre-wrap">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar la ruta en App.tsx**

En `client/src/App.tsx`: agregar el lazy import junto a los otros (~línea 25):
```tsx
const Agente = lazy(() => import('./pages/Agente'));
```
Y dentro del bloque `<Route element={<RoleRoute role="admin" />}>` (junto a /accounts, /builder…):
```tsx
                <Route path="/agente" element={<Agente />} />
```

- [ ] **Step 3: Agregar el ítem de nav en Layout.tsx**

En `client/src/components/Layout.tsx`: importar el ícono `Brain` de `lucide-react` (agregar a la lista de imports existente) y agregar al array `allNav` (después de `/builder`):
```tsx
  { to: '/agente', label: 'Agente', icon: Brain, roles: ['admin'] },
```

- [ ] **Step 4: Build del cliente**

Run: `cd client && npm run build`
Expected: build OK, sin errores de TypeScript.

- [ ] **Step 5: Verificación manual**

Levantar client + server. Login como admin. Ir a "Agente": se ve el cerebro a la izquierda y el chat con la animación a la derecha. Escribir "agregá que la consulta sale $29.000" → aparece la tarjeta de cambios → "Aplicar a las N líneas" → toast OK → el cerebro se refresca con la FAQ nueva. Verificar que como empleada la ruta `/agente` redirige a `/inbox`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Agente.tsx client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat(agente): página /agente (cerebro editable + chat config-agent)"
```

---

## Task 12: Verificación end-to-end + suite

- [ ] **Step 1: Suite del server**

Run: `cd server && npx vitest run src/core/agent/config && npx tsc --noEmit`
Expected: todos los tests de `config/` en verde, tsc limpio.

- [ ] **Step 2: Suite completa (chequear que nada se rompió)**

Run: `cd server && npx vitest run`
Expected: solo fallan los 6 tests pre-existentes (AppointmentProposalsExecutor / AppointmentAvailabilityExecutor); todo lo demás verde.

- [ ] **Step 3: Smoke conversacional opcional (con OPENAI_API_KEY)**

Probar `POST /api/agente/chat` con `{messages:[{role:'user',content:'sé más cálido y agregá que la consulta sale $29.000'}]}` → debe devolver `pendingChanges` con `set_tono` + `add_faq`. Luego `POST /api/agente/apply` con esos changes → 200. Limpiar lo que se haya tocado si se usó la DB de prod.

---

## Notas para el ejecutor

- **TDD estricto** en los módulos de `config/` y en `AgentPersona` (test rojo → impl → verde). `SupabaseBrainDb`, el router y el frontend son glue/UI: se verifican a mano (no hay runner de tests en el cliente).
- **DI**: nunca mockear módulos; inyectar deps como en el resto del repo (ver `ToolRegistry.test.ts`, `AgentRuntime.test.ts`).
- **No tocar** la lógica de agenda/booking ni los flujos del bot-builder: fuera de alcance.
- `.env` apunta a la Supabase **prod** del estudio: cualquier prueba que escriba (apply) debe limpiarse.
- Los 6 tests que ya fallaban (AppointmentProposalsExecutor/AppointmentAvailabilityExecutor) son pre-existentes y ajenos a este trabajo.
```
