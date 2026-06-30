# Gate de calificación área-aware + memoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El agente deja de saltear la calificación del libreto cuando el cliente pide "una cita por Jubilación de mujer"; además registra la calificación estructurada por área y la reusa al volver (con TTL).

**Architecture:** (1) `AreaDetector` regex clasifica el mensaje en un área de calificación. (2) El gate determinístico de `AgentRuntime` ya NO arranca el `BookingFlow` cuando el mensaje toca un área (deja que el LLM/libreto califique). (3) Nueva tool `set_qualification` persiste el resultado por área en `contact_memory.calificacion` (mapa por área). (4) Al cargar la ficha, una calificación vigente (< TTL) se inyecta para que el agente no re-pregunte.

**Tech Stack:** TypeScript, Node, vitest, Supabase (PostgREST). Tools en formato OpenAI function-calling.

**Run de tests:** desde `server/` → `npx vitest run <path>`.

**Convención de commits:** terminar el mensaje con
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `server/src/core/agent/context/AreaDetector.ts` | **nuevo** — `detectArea(text): AreaKey \| null` por regex |
| `server/src/core/agent/context/__tests__/AreaDetector.test.ts` | **nuevo** — tests del detector |
| `server/src/core/agent/runtime/AgentRuntime.ts` | gate área-aware + dep `areaDetector` + bloque de calificación en la ficha |
| `server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts` | tests del gate |
| `server/src/core/agent/runtime/ContactMemory.ts` | `buildCalificacionFicha` (puro), `setCalificacion`, `load` devuelve `calificacion` |
| `server/src/core/agent/runtime/__tests__/ContactMemory.test.ts` | tests de `buildCalificacionFicha` |
| `server/src/core/agent/runtime/ToolRegistry.ts` | tool `set_qualification` (schema + execute) + dep `setCalificacion` |
| `server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts` | test de la tool + actualizar lista de esquemas |
| `server/src/core/agent/runtime/AgentPersona.ts` | reglas soft: registrar calificación + usar CALIFICACIÓN PREVIA |
| `server/src/core/agent/runtime/__tests__/AgentPersona.test.ts` | assert de las reglas nuevas |
| `server/src/core/agent/runtime/createAgentRuntime.ts` | cablear `areaDetector`, `setCalificacion`, `calificacion_ttl_days`, `calificacion` |
| `supabase/migrations/0030_calificacion.sql` | **nuevo** — 2 columnas |

---

## Task 1: AreaDetector

**Files:**
- Create: `server/src/core/agent/context/AreaDetector.ts`
- Test: `server/src/core/agent/context/__tests__/AreaDetector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/agent/context/__tests__/AreaDetector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectArea } from '../AreaDetector';

describe('detectArea', () => {
  it('jubilación de mujer (caso real del bug)', () => {
    expect(detectArea('¿Puedo reservar una cita por Jubilacion de mujer?')).toBe('jubilacion_mujer');
  });
  it('jubilación de hombre', () => {
    expect(detectArea('quiero la jubilación de hombre')).toBe('jubilacion_hombre');
  });
  it('jubilación sin género', () => {
    expect(detectArea('me quiero jubilar')).toBe('jubilacion');
  });
  it('pensión por viudez antes que jubilación', () => {
    expect(detectArea('pensión por viudez, falleció mi esposo')).toBe('pension_viudez');
  });
  it('laboral / despido', () => {
    expect(detectArea('me despidieron sin causa')).toBe('laboral');
  });
  it('ART / accidente de trabajo (no es tránsito)', () => {
    expect(detectArea('tuve un accidente de trabajo')).toBe('art');
  });
  it('accidente de tránsito', () => {
    expect(detectArea('me chocaron en la esquina')).toBe('transito');
  });
  it('pedido de turno SIN área → null', () => {
    expect(detectArea('quiero sacar un turno')).toBeNull();
  });
  it('vacío → null', () => {
    expect(detectArea('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AreaDetector.test.ts`
Expected: FAIL — `Cannot find module '../AreaDetector'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/core/agent/context/AreaDetector.ts`:

```ts
// Clasificación DETERMINÍSTICA (regex) del área de la consulta. Se usa para que el
// gate de agendado NO saltee el procedimiento de calificación del libreto: si el
// mensaje toca un área, manda el LLM/libreto (que califica antes de agendar).
// Todas las áreas que devuelve este detector REQUIEREN calificación.

export type AreaKey =
  | 'jubilacion_hombre'
  | 'jubilacion_mujer'
  | 'jubilacion'
  | 'pension_viudez'
  | 'laboral'
  | 'art'
  | 'transito';

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function detectArea(text: string): AreaKey | null {
  const t = norm(text);
  if (!t) return null;

  // Orden de prioridad: específicos antes que genéricos.
  if (/\baccidente\s+de\s+transito\b|\bme\s+choc|\bchoque\b|\bsiniestro\b/.test(t)) return 'transito';
  if (/\bart\b|\baccidente\s+(laboral|de\s+trabajo|en\s+el\s+trabajo)\b/.test(t)) return 'art';
  if (/\b(pension|viudez|viuda|viudo|fallecio|falleci)\b/.test(t)) return 'pension_viudez';
  if (/\b(despido|despidieron|me\s+echaron|indemnizacion|reclamo\s+laboral|laboral|en\s+negro)\b/.test(t)) return 'laboral';

  if (/\b(jubilaci|jubilar|jubilo|jubilarme|jubilarse)/.test(t)) {
    if (/\b(mujer|femenino|senora|sra|esposa|mama)\b/.test(t)) return 'jubilacion_mujer';
    if (/\b(hombre|masculino|senor|sr|esposo|papa)\b/.test(t)) return 'jubilacion_hombre';
    return 'jubilacion';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AreaDetector.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/context/AreaDetector.ts server/src/core/agent/context/__tests__/AreaDetector.test.ts
git commit -m "feat(agente): AreaDetector — clasifica el área de calificación por regex"
```

---

## Task 2: Gate área-aware en AgentRuntime

**Files:**
- Modify: `server/src/core/agent/runtime/AgentRuntime.ts` (dep nueva + bloque del gate `:104-111`)
- Test: `server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts`

- [ ] **Step 1: Write the failing tests** (reproducen el bug)

Append estos dos tests dentro del `describe('AgentRuntime.handle', ...)` en
`server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts`:

```ts
  it('gate NO arranca booking si el mensaje toca un área de calificación (manda el LLM)', async () => {
    const deps = makeDeps([{ content: 'Soy Estela. ¿Me decís tu edad?' }]);
    (deps as any).booking = {
      isActive: vi.fn().mockResolvedValue(false),
      advance: vi.fn(),
      start: vi.fn().mockResolvedValue({ messages: ['NO debería arrancar'], active: true }),
    };
    (deps as any).bookingIntent = vi.fn(() => ({ start: true }));
    (deps as any).areaDetector = vi.fn(() => 'jubilacion_mujer');
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', '¿Puedo reservar una cita por Jubilación de mujer?', {});
    expect((deps as any).booking.start).not.toHaveBeenCalled();   // NO saltea el libreto
    expect(deps.ai.completeWithTools).toHaveBeenCalled();          // sí pasó por el LLM
    expect(out).toEqual(['Soy Estela. ¿Me decís tu edad?']);
  });

  it('gate SÍ arranca booking en un pedido de turno sin área', async () => {
    const deps = makeDeps([{ content: 'no debería llamarse el LLM' }]);
    (deps as any).booking = {
      isActive: vi.fn().mockResolvedValue(false),
      advance: vi.fn(),
      start: vi.fn().mockResolvedValue({ messages: ['¿Presencial o por videollamada?'], active: true }),
    };
    (deps as any).bookingIntent = vi.fn(() => ({ start: true }));
    (deps as any).areaDetector = vi.fn(() => null);
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'quiero sacar un turno', {});
    expect((deps as any).booking.start).toHaveBeenCalled();
    expect(deps.ai.completeWithTools).not.toHaveBeenCalled();
    expect(out).toEqual(['¿Presencial o por videollamada?']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentRuntime.test.ts`
Expected: el primer test FALLA — hoy el gate ignora el área y llama `booking.start`
(`expect(booking.start).not.toHaveBeenCalled()` falla). El segundo PASA ya.

- [ ] **Step 3: Implementar el gate área-aware**

En `server/src/core/agent/runtime/AgentRuntime.ts`:

3a. Agregar el import del tipo (debajo del import de LoopGuard, al inicio):

```ts
import type { AreaKey } from '../context/AreaDetector';
```

3b. En la interfaz `RuntimeDeps`, justo después de la línea
`bookingIntent?: (text: string) => { start: boolean; modalidad?: 'presencial' | 'video' };`
agregar:

```ts
  // Clasifica el área de la consulta. Si el mensaje toca un área de calificación,
  // el gate NO arranca el booking determinístico (deja calificar al LLM/libreto).
  areaDetector?: (text: string) => AreaKey | null;
```

3c. Reemplazar el bloque del gate (`else if (this.deps.booking && this.deps.bookingIntent)`):

```ts
    } else if (this.deps.booking && this.deps.bookingIntent) {
      // Intención clara de turno nuevo → arrancamos el flujo de una, sin esperar al LLM.
      const intent = this.deps.bookingIntent(text);
      if (intent.start) {
        // PERO: si el mensaje toca un área de calificación (jubilación, etc.), NO
        // arrancamos el booking: lo conduce el LLM/libreto, que califica primero y
        // recién después llama start_booking. El gate solo arranca pedidos "pelados".
        const area = this.deps.areaDetector?.(text) ?? null;
        if (!area) {
          const r = await this.deps.booking.start(accountId, phone, { modalidad: intent.modalidad }, ctx.conversation ?? text);
          if (r.messages.length) return finishWith(r.messages);
        }
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentRuntime.test.ts`
Expected: PASS (todos, incluidos los dos nuevos).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/AgentRuntime.ts server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts
git commit -m "fix(agente): el gate de agendado no saltea la calificación del área

El gate determinístico bookingIntent arrancaba el BookingFlow apenas veía
'reservar/cita/turno', salteando el libreto de calificación. Ahora, si el
mensaje toca un área (jubilación, etc.), deja que el LLM/libreto califique."
```

---

## Task 3: ContactMemory — buildCalificacionFicha (puro) + setCalificacion + load

**Files:**
- Modify: `server/src/core/agent/runtime/ContactMemory.ts`
- Test: `server/src/core/agent/runtime/__tests__/ContactMemory.test.ts`

- [ ] **Step 1: Write the failing tests** (función pura)

Primero, ampliar el import existente al tope del archivo
`server/src/core/agent/runtime/__tests__/ContactMemory.test.ts`:

```ts
import { mergeProfile, buildFichaText, buildCalificacionFicha } from '../ContactMemory';
```

Luego, append este `describe` al final del archivo:

```ts
describe('ContactMemory.buildCalificacionFicha', () => {
  const NOW = Date.parse('2026-06-30T12:00:00.000Z');
  const fresca = {
    jubilacion_mujer: {
      resultado: 'gratis',
      datos: { edad: 61, hijos: 2, aportes_aprox: 22 },
      calificado_at: '2026-06-25T12:00:00.000Z', // hace 5 días
    },
  };

  it('inyecta una calificación vigente (< TTL) con sus datos', () => {
    const out = buildCalificacionFicha(fresca, 'jubilacion_mujer', 30, NOW);
    expect(out).toContain('CALIFICACIÓN PREVIA');
    expect(out).toContain('Jubilación Mujer');
    expect(out).toContain('61 años');
    expect(out).toContain('hace 5 días');
  });

  it('ignora una calificación vencida (> TTL)', () => {
    const vieja = { jubilacion_mujer: { ...fresca.jubilacion_mujer, calificado_at: '2026-01-01T12:00:00.000Z' } };
    expect(buildCalificacionFicha(vieja, 'jubilacion_mujer', 30, NOW)).toBe('');
  });

  it('sin calificación → string vacío', () => {
    expect(buildCalificacionFicha(null, null, 30, NOW)).toBe('');
    expect(buildCalificacionFicha({}, null, 30, NOW)).toBe('');
  });

  it('sin área del mensaje, renderiza todas las frescas', () => {
    const out = buildCalificacionFicha(fresca, null, 30, NOW);
    expect(out).toContain('Jubilación Mujer');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ContactMemory.test.ts`
Expected: FAIL — `buildCalificacionFicha` no existe (export).

- [ ] **Step 3: Implementar en ContactMemory.ts**

3a. Import del tipo al inicio de `server/src/core/agent/runtime/ContactMemory.ts`
(debajo de `import type { ContactFicha } from './types';`):

```ts
import type { AreaKey } from '../context/AreaDetector';
```

3b. Agregar (después de `buildFichaText`, antes de `export class ContactMemory`):

```ts
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
```

3c. Hacer que `load()` traiga `calificacion` y la devuelva. Reemplazar el `select` y el
return de `load()`:

```ts
  async load(accountId: string, phone: string): Promise<ContactFicha> {
    const { data } = await supabase
      .from('contact_memory').select('profile, preferences, long_term_summary, calificacion')
      .eq('account_id', accountId).eq('phone', phone).maybeSingle();

    const profile = (data?.profile ?? {}) as Record<string, any>;
    const preferences = (data?.preferences ?? {}) as Record<string, any>;
    const summary = (data?.long_term_summary ?? null) as string | null;
    const calificacion = ((data as any)?.calificacion ?? null) as Record<string, any> | null;
```

…y en el `return` de `load()` agregar `calificacion`:

```ts
    return { profile, preferences, summary, calificacion, fichaText: buildFichaText(profile, preferences, summary, proximaCita) };
```

3d. Agregar `calificacion` al tipo `ContactFicha` en `server/src/core/agent/runtime/types.ts`
(campo opcional, no rompe consumidores):

```ts
  calificacion?: Record<string, any> | null;
```

3e. Agregar el método `setCalificacion` dentro de la clase `ContactMemory` (después de
`saveLoopGuardState`):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ContactMemory.test.ts`
Expected: PASS (los nuevos + los previos de mergeProfile/buildFichaText).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/ContactMemory.ts server/src/core/agent/runtime/types.ts server/src/core/agent/runtime/__tests__/ContactMemory.test.ts
git commit -m "feat(agente): memoria de calificación por área + bloque de ficha con TTL"
```

---

## Task 4: AgentRuntime inyecta el bloque de calificación en la ficha

**Files:**
- Modify: `server/src/core/agent/runtime/AgentRuntime.ts`
- Test: `server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts`

- [ ] **Step 1: Write the failing test**

Append en `describe('AgentRuntime.handle', ...)`:

```ts
  it('inyecta la CALIFICACIÓN PREVIA vigente en la ficha del persona', async () => {
    const deps = makeDeps([{ content: 'Listo' }]);
    (deps as any).memory = {
      load: vi.fn().mockResolvedValue({
        profile: {}, preferences: {}, summary: null, fichaText: 'FICHA: María.',
        calificacion: { jubilacion_mujer: { resultado: 'gratis', datos: { edad: 61 }, calificado_at: new Date().toISOString() } },
      }),
    };
    (deps as any).areaDetector = vi.fn(() => 'jubilacion_mujer');
    (deps as any).loadAccount = vi.fn().mockResolvedValue({ accountId: 'acc1', agentName: 'Sofía', calificacionTtlDays: 30 });
    const rt = new AgentRuntime(deps as any);
    await rt.handle('acc1', '549111', 'hola de nuevo', {});
    const fichaArg = deps.persona.build.mock.calls[0][1] as string;
    expect(fichaArg).toContain('FICHA: María.');
    expect(fichaArg).toContain('CALIFICACIÓN PREVIA');
    expect(fichaArg).toContain('Jubilación Mujer');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentRuntime.test.ts -t "CALIFICACIÓN PREVIA"`
Expected: FAIL — hoy la ficha pasada al persona es `ficha.fichaText` sin el bloque.

- [ ] **Step 3: Implementar la composición de la ficha**

3a. En `server/src/core/agent/runtime/AgentRuntime.ts` agregar el import del helper
(debajo del import de LoopGuard / AreaKey):

```ts
import { buildCalificacionFicha } from './ContactMemory';
```

3b. Extender el tipo de la dep `memory` en `RuntimeDeps` para incluir `calificacion`:

```ts
  memory: { load: (accountId: string, phone: string) => Promise<{ fichaText: string; calificacion?: Record<string, any> | null }> };
```

3c. En `handle`, reemplazar la línea
`const systemPrompt = this.deps.persona.build(account, ficha.fichaText, continuity);`
por:

```ts
    // Calificación previa vigente (< TTL por cuenta) → a la ficha, para no re-preguntar.
    const msgArea = this.deps.areaDetector?.(text) ?? null;
    const ttlDays = Number((account as any)?.calificacionTtlDays) || 30;
    const calBlock = buildCalificacionFicha(ficha.calificacion, msgArea, ttlDays, (this.deps.now ?? Date.now)());
    const fichaText = calBlock ? `${ficha.fichaText}\n${calBlock}` : ficha.fichaText;
    const systemPrompt = this.deps.persona.build(account, fichaText, continuity);
```

> Nota: el gate de Task 2 recomputa `this.deps.areaDetector?.(text)`. Es barato (regex)
> y mantiene los dos bloques independientes; no hace falta compartir la variable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentRuntime.test.ts`
Expected: PASS (todos; el resto de tests no define `areaDetector`/`calificacion` y
siguen pasando porque `buildCalificacionFicha(undefined, null, 30, …)` devuelve `''`).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/AgentRuntime.ts server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts
git commit -m "feat(agente): inyecta la calificación previa vigente en la ficha"
```

---

## Task 5: Tool set_qualification

**Files:**
- Modify: `server/src/core/agent/runtime/ToolRegistry.ts`
- Test: `server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

5a. En `server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts`, agregar el stub al
top-level (junto a los otros `const ... = vi.fn()`):

```ts
const setCalificacion = vi.fn();
```

5b. En `makeRegistry()`, agregar la dep al objeto del `new ToolRegistry({...})`:

```ts
    setCalificacion,
```

5c. Actualizar el test `expone los esquemas de las tools` para incluir el nuevo nombre
(lista ordenada alfabéticamente):

```ts
    expect(names).toEqual([
      'book_appointment', 'cancel_appointment', 'check_availability',
      'handoff_to_human', 'list_offices', 'pick_option', 'reschedule_appointment',
      'search_knowledge', 'set_qualification', 'start_booking', 'suggest_office', 'validate_phone',
    ]);
```

5d. Agregar el test de ejecución:

```ts
  it('set_qualification persiste el resultado por área con los datos y el sello', async () => {
    const reg = makeRegistry();
    const res = await reg.execute('set_qualification',
      { area: 'jubilacion_mujer', resultado: 'gratis', edad: 61, hijos: 2, aportes_aprox: 22 },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(setCalificacion).toHaveBeenCalledWith('acc1', '549111', 'jubilacion_mujer',
      expect.objectContaining({ resultado: 'gratis', datos: { edad: 61, hijos: 2, aportes_aprox: 22 } }));
    const entry = setCalificacion.mock.calls[0][3];
    expect(typeof entry.calificado_at).toBe('string');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts`
Expected: FAIL — `set_qualification` no está en los esquemas ni en `execute`
(devuelve `tool desconocida`).

- [ ] **Step 3: Implementar en ToolRegistry.ts**

3a. Agregar la dep a `ToolDeps` (después de `buildFicha?`):

```ts
  // Registro de la calificación del área (memoria estructurada por área).
  setCalificacion?: (accountId: string, phone: string, area: string, entry: { resultado: string; datos: Record<string, any>; calificado_at: string }) => Promise<void>;
```

3b. Agregar el schema al final del array `SCHEMAS` (después de `validate_phone`):

```ts
  { type: 'function', function: { name: 'set_qualification', description: 'Registrá el resultado de la calificación del área (jubilación, pensión, laboral, ART, tránsito) cuando terminaste las preguntas del PROCEDIMIENTO, ANTES de ofrecer agendar.', parameters: { type: 'object', properties: { area: { type: 'string', enum: ['jubilacion_hombre', 'jubilacion_mujer', 'jubilacion', 'pension_viudez', 'laboral', 'art', 'transito'] }, resultado: { type: 'string', enum: ['gratis', 'pago', 'descartar'] }, edad: { type: 'number' }, hijos: { type: 'number' }, aportes_aprox: { type: 'number' }, notas: { type: 'string' } }, required: ['area', 'resultado'] } } },
```

3c. Agregar el `case` en `execute` (antes de `default:`):

```ts
        case 'set_qualification': {
          if (!this.deps.setCalificacion || !args?.area || !args?.resultado) return { ok: true, data: { registrado: false } };
          const datos: Record<string, any> = {};
          if (args.edad != null) datos.edad = args.edad;
          if (args.hijos != null) datos.hijos = args.hijos;
          if (args.aportes_aprox != null) datos.aportes_aprox = args.aportes_aprox;
          if (args.notas) datos.notas = args.notas;
          await this.deps.setCalificacion(ctx.accountId, ctx.phone, String(args.area), {
            resultado: String(args.resultado), datos, calificado_at: new Date().toISOString(),
          });
          return { ok: true, data: { registrado: true } };
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/ToolRegistry.ts server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts
git commit -m "feat(agente): tool set_qualification registra la calificación por área"
```

---

## Task 6: Persona — reglas soft de calificación

**Files:**
- Modify: `server/src/core/agent/runtime/AgentPersona.ts`
- Test: `server/src/core/agent/runtime/__tests__/AgentPersona.test.ts`

- [ ] **Step 1: Write the failing test**

Agregar en `describe('buildPersona', ...)`:

```ts
  it('instruye registrar la calificación y usar la CALIFICACIÓN PREVIA', () => {
    const prompt = buildPersona({ accountId: 'acc1', agentName: 'Sofía' } as any, 'FICHA: nuevo.');
    expect(prompt.toLowerCase()).toContain('set_qualification');
    expect(prompt.toUpperCase()).toContain('CALIFICACIÓN PREVIA');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts -t "CALIFICACIÓN PREVIA"`
Expected: FAIL — el prompt no menciona `set_qualification` ni "CALIFICACIÓN PREVIA".

- [ ] **Step 3: Implementar en AgentPersona.ts**

3a. En el array de la sección `'AGENDAR UN TURNO (MUY IMPORTANTE):'`, después de la línea
que empieza con `'- Cuando el cliente te dé un número de contacto, validalo...'`, agregar:

```ts
    '- Cuando termines las preguntas de calificación del PROCEDIMIENTO (jubilación, pensión, laboral, ART, tránsito), registrá el resultado con la tool set_qualification (resultado: gratis/pago/descartar, + edad/hijos/aportes si los tenés) ANTES de ofrecer agendar.',
    '- Si la FICHA trae un bloque CALIFICACIÓN PREVIA vigente, NO repitas esas preguntas: retomá desde ahí y ofrecé agendar (o el análisis pago), según el resultado registrado.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/runtime/AgentPersona.ts server/src/core/agent/runtime/__tests__/AgentPersona.test.ts
git commit -m "feat(agente): persona instruye registrar y reusar la calificación"
```

---

## Task 7: Wire en createAgentRuntime + migración 0030

**Files:**
- Modify: `server/src/core/agent/runtime/createAgentRuntime.ts`
- Create: `supabase/migrations/0030_calificacion.sql`

- [ ] **Step 1: Crear la migración**

Create `supabase/migrations/0030_calificacion.sql`:

```sql
-- 0030: memoria de calificación por área + TTL de reuso configurable por cuenta.
-- contact_memory.calificacion: mapa { area_key: { resultado, datos, calificado_at } }.
ALTER TABLE contact_memory ADD COLUMN IF NOT EXISTS calificacion jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS calificacion_ttl_days integer DEFAULT 30;
```

- [ ] **Step 2: Cablear las deps en createAgentRuntime.ts**

2a. Agregar el import (junto a `import { detectBookingIntent } from '../context/BookingFlow';`):

```ts
import { detectArea } from '../context/AreaDetector';
```

2b. En `loadAccount`, agregar `calificacion_ttl_days` al `.select(...)`:

```ts
    .select('id, name, agent_name, agent_persona, business_context, agent_procedures, ai_api_key, ai_model, agent_loop_guard, calificacion_ttl_days')
```

…y al objeto que retorna `loadAccount`, agregar:

```ts
    calificacionTtlDays: (data as any)?.calificacion_ttl_days ?? 30,
```

2c. En el objeto del `new ToolRegistry({...})`, agregar la dep (después de `buildFicha`):

```ts
    setCalificacion: (a, p, area, entry) => memory.setCalificacion(a, p, area, entry),
```

2d. En el `new AgentRuntime({...})`, después de `bookingIntent: detectBookingIntent,`,
agregar:

```ts
    areaDetector: detectArea,
```

- [ ] **Step 3: Verificar typecheck + suite completa del módulo agente**

Run: `cd server && npx tsc --noEmit && npx vitest run src/core/agent`
Expected: typecheck sin errores y todos los tests del agente en verde.

- [ ] **Step 4: Commit**

```bash
git add server/src/core/agent/runtime/createAgentRuntime.ts supabase/migrations/0030_calificacion.sql
git commit -m "chore(agente): cablea areaDetector + set_qualification + migración 0030"
```

- [ ] **Step 5: Avisar al operador (migración sin aplicar)**

La migración 0030 NO se aplica sola. Recordarle al usuario que corra
`supabase db push` (o el método habitual del proyecto) contra el Supabase del estudio
para crear las columnas `contact_memory.calificacion` y `accounts.calificacion_ttl_days`.
Hasta entonces: `setCalificacion`/`load` degradan con gracia (try/catch) y el TTL usa 30.

---

## Notas de cierre

- **Smoke manual sugerido** (tras aplicar 0030): mandar "¿Puedo reservar una cita por
  Jubilación de mujer?" al agente y verificar que pregunta edad/calificación ANTES de
  ofrecer horarios (no salta a "presencial o videollamada").
- **Fuera de alcance** (otros bugs detectados, próximos planes): #2 `outOfCoverage`
  agenda presencial para otra provincia; #3 dirección basura `CABA123`; #4 recordatorio
  inmediato; #5 truncado de primeros chars en el envío WhatsApp.
