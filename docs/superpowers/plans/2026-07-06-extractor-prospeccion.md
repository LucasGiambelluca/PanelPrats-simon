# Extractor de Prospección — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mensaje inicial rico en datos → el agente extrae todo (nombre, edad, aportes, zona, teléfono, modalidad), lo sanea y deja de re-preguntar: prompt con "DATOS YA APORTADOS", agendado pre-cargado, calificación en ≤2 turnos.

**Architecture:** Nueva pasada de extracción LLM-enjaulada (`ProspectExtractor`, JSON temp 0 + saneadores de código) que corre EN PARALELO al `IntentClassifier` dentro de `ConversationController.handleTurn`, solo en el 1er mensaje o mensajes ≥120 chars (tope 1/día). Sus slots van a `dialogue_state` (jsonb existente, sin migración). El consumo es la parte clave: `AgentRuntime` recibe del controller un bloque "DATOS YA APORTADOS" para el system prompt y un `prefill` para `BookingFlow` (que ya sabe saltear etapas si recibe datos).

**Tech Stack:** TypeScript (Node), vitest (`cd server && npm run test:run`), Supabase (sin cambios de schema), patrón LLM-enjaulado existente (`IntentClassifier` como plantilla).

**Spec:** `docs/superpowers/specs/2026-07-06-extractor-prospeccion-design.md` (commit c956bf5)

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `server/src/core/agent/context/ProspectExtractor.ts` | Crear | Extracción LLM + saneadores + gating (`shouldExtract`) — funciones puras + 1 llamada IA |
| `server/src/core/agent/context/__tests__/ProspectExtractor.test.ts` | Crear | Tests unitarios sin red |
| `server/src/core/agent/context/DialogueState.ts` | Modificar | + `extractor_last_at` en el tipo, + `buildDatosAportados()`, + `slotsPrefill()` |
| `server/src/core/agent/context/__tests__/DialogueState.test.ts` | Modificar | Tests de las 2 funciones nuevas |
| `server/src/core/agent/runtime/ConversationController.ts` | Modificar | Dep opcional `extract`, `Promise.all` con classify, merge + área fallback |
| `server/src/core/agent/runtime/__tests__/ConversationController.test.ts` | Modificar | Tests de integración con extractor mockeado |
| `server/src/core/agent/context/IntentClassifier.ts` | Modificar | Claves de slots cerradas (whitelist) |
| `server/src/core/agent/context/__tests__/IntentClassifier.test.ts` | Modificar | Test: clave desconocida se descarta |
| `server/src/core/agent/runtime/AgentRuntime.ts` | Modificar | Outcome extendido (datosAportados/prefill), prompt, gate y tool con prefill |
| `server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts` | Modificar | Tests: prompt contiene bloque; booking.start recibe prefill |
| `server/src/core/agent/context/BookingFlow.ts` | Modificar | `telefonoSugerido`: confirmar en vez de pedir de cero |
| `server/src/core/agent/context/__tests__/BookingFlow.test.ts` | Modificar | Tests del teléfono sugerido |
| `server/src/core/agent/runtime/createAgentRuntime.ts` | Modificar | Wiring: extractor real + wrapper del controller |

Todos los comandos se corren desde `server/`.

---

### Task 1: `ProspectExtractor` — saneadores y gating (puros)

**Files:**
- Create: `server/src/core/agent/context/ProspectExtractor.ts`
- Create: `server/src/core/agent/context/__tests__/ProspectExtractor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/core/agent/context/__tests__/ProspectExtractor.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeProspect, shouldExtract } from '../ProspectExtractor';

describe('sanitizeProspect — saneadores', () => {
  it('mensaje rico completo → todos los slots saneados', () => {
    const raw = {
      nombre: ' Ana López ', edad: 63, genero: 'F', anios_aporte: 30,
      localidad: 'Quilmes', telefono: '11 5174 9871', modalidad: 'Presencial',
      area_texto: 'quiero jubilarme', urgencia: 'normal', mejor_horario: 'a la tarde', hijos: 2,
    };
    const r = sanitizeProspect(raw, 'soy Ana López, tengo 63 años...');
    expect(r.slots.nombre).toBe('Ana López');
    expect(r.slots.edad).toBe(63);
    expect(r.slots.genero).toBe('f');
    expect(r.slots.anios_aporte).toBe(30);
    expect(r.slots.zona).toBe('Quilmes');           // localidad → clave 'zona' (la que usa el resto)
    expect(r.slots.telefono).toBe('541151749871');  // normalizado por validarTelefonoAR
    expect(r.slots.modalidad).toBe('presencial');
    expect(r.slots.hijos).toBe(2);
  });

  it('valores fuera de rango o inválidos se DESCARTAN sin romper el resto', () => {
    const raw = { edad: 140, anios_aporte: 99, telefono: '123', genero: 'x', modalidad: 'telepatía', nombre: 'A' };
    const r = sanitizeProspect(raw, 'hola');
    expect(r.slots.edad).toBeUndefined();
    expect(r.slots.anios_aporte).toBeUndefined();
    expect(r.slots.telefono).toBeUndefined();  // teléfono inválido AR → descartado
    expect(r.slots.genero).toBeUndefined();
    expect(r.slots.modalidad).toBeUndefined();
    expect(r.slots.nombre).toBeUndefined();    // 1 letra no es nombre
  });

  it('AreaDetector sobre el texto original PISA al modelo', () => {
    const r = sanitizeProspect({ area_texto: 'laboral' }, 'quiero jubilarme, tengo 63');
    expect(r.area).toMatch(/^jubilacion/); // regex del texto gana sobre area_texto del modelo
  });

  it('area_texto del modelo solo se usa re-validado si el regex no detectó nada', () => {
    const r = sanitizeProspect({ area_texto: 'me despidieron del trabajo' }, 'hola buenas tardes');
    expect(r.area).toBe('laboral'); // re-pasado por detectArea
    const r2 = sanitizeProspect({ area_texto: 'quiero un préstamo' }, 'hola buenas tardes');
    expect(r2.area).toBeNull();     // area_texto no matchea ningún área → null
  });

  it('crudo no-objeto → resultado vacío, nunca throw', () => {
    expect(sanitizeProspect(null, 'x')).toEqual({ slots: {}, area: null });
    expect(sanitizeProspect('json roto', 'x')).toEqual({ slots: {}, area: null });
    expect(sanitizeProspect([1, 2], 'x')).toEqual({ slots: {}, area: null });
  });
});

describe('shouldExtract — cuándo corre la pasada profunda', () => {
  const NOW = '2026-07-06T15:00:00.000Z';
  it('primer mensaje (sin historial) → true aunque sea corto', () => {
    expect(shouldExtract({ text: 'hola quiero jubilarme', historyLength: 0, extractorLastAt: null, now: NOW })).toBe(true);
  });
  it('mensaje ≥120 chars con historial → true', () => {
    const largo = 'x'.repeat(120);
    expect(shouldExtract({ text: largo, historyLength: 8, extractorLastAt: null, now: NOW })).toBe(true);
  });
  it('mensaje corto con historial → false', () => {
    expect(shouldExtract({ text: 'a la tarde', historyLength: 8, extractorLastAt: null, now: NOW })).toBe(false);
  });
  it('tope 1/día: ya corrió hoy → false; corrió ayer → true', () => {
    const largo = 'x'.repeat(200);
    expect(shouldExtract({ text: largo, historyLength: 2, extractorLastAt: '2026-07-06T09:00:00.000Z', now: NOW })).toBe(false);
    expect(shouldExtract({ text: largo, historyLength: 2, extractorLastAt: '2026-07-05T09:00:00.000Z', now: NOW })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/core/agent/context/__tests__/ProspectExtractor.test.ts`
Expected: FAIL — "Cannot find module '../ProspectExtractor'"

- [ ] **Step 3: Write the implementation (parte pura)**

```typescript
// server/src/core/agent/context/ProspectExtractor.ts
// ─── ProspectExtractor ────────────────────────────────────────────────────────
// Pasada de extracción PROFUNDA sobre mensajes ricos (1er mensaje o ≥120 chars).
// LLM enjaulado: temp 0, JSON cerrado; los saneadores de código deciden qué entra.
// REGLA DURA: nunca throw. Falla → { slots:{}, area:null } y la conversación sigue.
// Spec: docs/superpowers/specs/2026-07-06-extractor-prospeccion-design.md

import { validarTelefonoAR } from '../../../utils/phone-ar';
import { detectArea } from './AreaDetector';

export interface ProspectResult {
  slots: Record<string, string | number>;
  area: string | null;
}

interface AILike { complete: (opts: any) => Promise<string> }

const num = (v: any): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/** Gating puro: 1er mensaje o ≥120 chars, máx 1 pasada por día (comparación de fecha UTC). */
export function shouldExtract(input: {
  text: string;
  historyLength: number;
  extractorLastAt: string | null | undefined;
  now: string;
}): boolean {
  const rich = input.historyLength === 0 || input.text.trim().length >= 120;
  if (!rich) return false;
  if (input.extractorLastAt && input.extractorLastAt.slice(0, 10) === input.now.slice(0, 10)) return false;
  return true;
}

/** Saneo del crudo del modelo. Nada pasa sin validar. Claves de salida = las del resto del sistema. */
export function sanitizeProspect(raw: any, originalText: string): ProspectResult {
  const area =
    detectArea(originalText) ??
    (raw && typeof raw === 'object' && !Array.isArray(raw) && str(raw.area_texto)
      ? detectArea(str(raw.area_texto))
      : null);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { slots: {}, area: null };

  const slots: Record<string, string | number> = {};

  const nombre = str(raw.nombre);
  if (nombre.length >= 2 && nombre.length <= 60) slots.nombre = nombre;

  const edad = num(raw.edad);
  if (edad !== null && edad >= 18 && edad <= 110) slots.edad = edad;

  const aportes = num(raw.anios_aporte);
  if (aportes !== null && aportes >= 0 && aportes <= 60) slots.anios_aporte = aportes;

  const hijos = num(raw.hijos);
  if (hijos !== null && hijos >= 0 && hijos <= 20) slots.hijos = hijos;

  const genero = str(raw.genero).toLowerCase();
  if (genero === 'm' || genero === 'f') slots.genero = genero;

  const modalidad = str(raw.modalidad).toLowerCase();
  if (modalidad === 'presencial' || modalidad === 'video') slots.modalidad = modalidad;

  // localidad → clave 'zona': la clave que ya usan BookingFlow y el clasificador.
  const zona = str(raw.localidad);
  if (zona && zona.length <= 80) slots.zona = zona;

  const tel = str(raw.telefono);
  if (tel) {
    const v = validarTelefonoAR(tel);
    if (v.valido && v.normalizado) slots.telefono = v.normalizado;
  }

  const urgencia = str(raw.urgencia).toLowerCase();
  if (urgencia === 'alta' || urgencia === 'normal') slots.urgencia = urgencia;

  const horario = str(raw.mejor_horario);
  if (horario && horario.length <= 60) slots.mejor_horario = horario;

  return { slots, area };
}

const EXTRACT_PROMPT = [
  'Sos extractor de datos para un estudio previsional y laboral argentino.',
  'Del mensaje del usuario extraé SOLO los datos que estén EXPLÍCITOS. Respondé SOLO JSON:',
  '',
  '{"nombre":..,"edad":..,"genero":"m|f",..,"anios_aporte":..,"localidad":..,"telefono":..,"modalidad":"presencial|video","area_texto":..,"hijos":..,"urgencia":"alta|normal","mejor_horario":..}',
  '',
  'REGLAS:',
  '- Dato AUSENTE → null. NUNCA inventes ni deduzcas (no adivines género por el nombre... salvo "me jubilo como mujer" u otro dato explícito).',
  '- "edad" y "anios_aporte" enteros. "telefono" tal cual lo escribió.',
  '- "localidad": ciudad/barrio/zona donde vive.',
  '- "area_texto": frase textual del motivo de consulta (ej. "quiero jubilarme", "me despidieron").',
  '- "urgencia": "alta" solo si expresa apuro explícito.',
  '- SOLO JSON, sin markdown.',
].join('\n');

/** Llamada al LLM + saneo. Best-effort: cualquier falla → resultado vacío. */
export async function extractProspect(
  ai: AILike,
  input: { text: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; apiKey?: string; model?: string },
): Promise<ProspectResult> {
  try {
    const historyLines = (input.history ?? [])
      .slice(-4)
      .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
      .join('\n');
    const userMessage = [historyLines, `Mensaje a extraer: "${input.text}"`].filter(Boolean).join('\n');

    const raw = await ai.complete({
      systemPrompt: EXTRACT_PROMPT,
      userMessage,
      jsonMode: true,
      temperature: 0,
      maxTokens: 250,
      apiKey: input.apiKey,
      model: input.model,
    });

    let parsed: any = {};
    try {
      const clean = String(raw).replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {};
    }
    return sanitizeProspect(parsed, input.text);
  } catch {
    return { slots: {}, area: null };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/core/agent/context/__tests__/ProspectExtractor.test.ts`
Expected: PASS (todos)

Nota: si `validarTelefonoAR('11 5174 9871')` normaliza distinto a `541151749871`, ajustar el valor esperado del test al normalizado real (verificar con `utils/phone-ar.ts` — el test de área 11 con 8 dígitos debe dar válido).

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/context/ProspectExtractor.ts src/core/agent/context/__tests__/ProspectExtractor.test.ts
git commit -m "feat(extractor): ProspectExtractor con saneadores y gating (spec P1)"
```

---

### Task 2: `extractProspect` — comportamiento con IA mockeada

**Files:**
- Modify: `server/src/core/agent/context/__tests__/ProspectExtractor.test.ts` (agregar describe)

- [ ] **Step 1: Write the failing tests** (agregar al final del archivo de test)

```typescript
import { extractProspect } from '../ProspectExtractor';

describe('extractProspect — LLM mockeado', () => {
  it('mensaje rico → JSON del modelo saneado y con área', async () => {
    const ai = {
      complete: async () => JSON.stringify({
        nombre: 'Ana López', edad: 63, anios_aporte: 30, localidad: 'Quilmes',
        genero: 'f', area_texto: 'quiero jubilarme',
      }),
    };
    const r = await extractProspect(ai, { text: 'Hola soy Ana López, tengo 63 años, 30 de aportes, vivo en Quilmes, quiero jubilarme' });
    expect(r.slots).toMatchObject({ nombre: 'Ana López', edad: 63, anios_aporte: 30, zona: 'Quilmes', genero: 'f' });
    expect(r.area).toMatch(/^jubilacion/);
  });

  it('modelo devuelve basura no-JSON → vacío, sin throw', async () => {
    const ai = { complete: async () => 'no puedo ayudarte con eso' };
    const r = await extractProspect(ai, { text: 'hola' });
    expect(r).toEqual({ slots: {}, area: detectAreaOf('hola') });
  });

  it('IA tira excepción → vacío, sin throw', async () => {
    const ai = { complete: async () => { throw new Error('sin saldo'); } };
    const r = await extractProspect(ai, { text: 'hola' });
    expect(r).toEqual({ slots: {}, area: null });
  });

  it('markdown fences se limpian', async () => {
    const ai = { complete: async () => '```json\n{"edad": 70}\n```' };
    const r = await extractProspect(ai, { text: 'hola tengo setenta' });
    expect(r.slots.edad).toBe(70);
  });
});

// helper local: qué área da el detector para ese texto (para no hardcodear null/valor)
import { detectArea as detectAreaOf } from '../AreaDetector';
```

(Mover el `import` del helper arriba del archivo junto a los demás imports.)

- [ ] **Step 2: Run tests — verify new ones pass** (la implementación ya existe de Task 1)

Run: `npm run test:run -- src/core/agent/context/__tests__/ProspectExtractor.test.ts`
Expected: PASS. Si el caso "no-JSON" falla porque `sanitizeProspect` con raw `{}` devuelve área del texto: el expected usa `detectAreaOf('hola')` justamente para eso.

- [ ] **Step 3: Commit**

```bash
git add src/core/agent/context/__tests__/ProspectExtractor.test.ts
git commit -m "test(extractor): extractProspect con IA mockeada (fallbacks y parseo)"
```

---

### Task 3: `DialogueState` — `extractor_last_at` + `buildDatosAportados` + `slotsPrefill`

**Files:**
- Modify: `server/src/core/agent/context/DialogueState.ts`
- Modify: `server/src/core/agent/context/__tests__/DialogueState.test.ts` (agregar describes)

- [ ] **Step 1: Write the failing tests** (agregar al final del test existente)

```typescript
import { buildDatosAportados, slotsPrefill, createDialogueState, mergeSlots } from '../DialogueState';

describe('buildDatosAportados', () => {
  it('sin slots llenos → string vacío', () => {
    expect(buildDatosAportados(createDialogueState())).toBe('');
  });
  it('slots llenos → bloque con encabezado y una línea por dato', () => {
    const s = mergeSlots(createDialogueState(), { nombre: 'Ana', edad: 63, zona: 'Quilmes' });
    const block = buildDatosAportados(s);
    expect(block).toContain('DATOS YA APORTADOS');
    expect(block).toContain('- nombre: Ana');
    expect(block).toContain('- edad: 63');
    expect(block).toContain('- zona: Quilmes');
  });
  it('slots pendientes NO aparecen', () => {
    let s = createDialogueState();
    s = { ...s, slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 1 } } };
    expect(buildDatosAportados(s)).toBe('');
  });
});

describe('slotsPrefill', () => {
  it('extrae solo las claves de booking, con modalidad validada', () => {
    const s = mergeSlots(createDialogueState(), {
      nombre: 'Ana', zona: 'Quilmes', modalidad: 'video', telefono: '541151749871', edad: 63,
    });
    expect(slotsPrefill(s)).toEqual({ nombre: 'Ana', zona: 'Quilmes', modalidad: 'video', telefono: '541151749871' });
  });
  it('modalidad inválida no entra; vacío → {}', () => {
    const s = mergeSlots(createDialogueState(), { modalidad: 'telepatia' });
    expect(slotsPrefill(s)).toEqual({});
    expect(slotsPrefill(createDialogueState())).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npm run test:run -- src/core/agent/context/__tests__/DialogueState.test.ts`
Expected: FAIL — "buildDatosAportados is not exported" (o similar)

- [ ] **Step 3: Implement** — en `DialogueState.ts`:

(a) Al interface `DialogueState` agregar el campo (después de `ask_streak`):

```typescript
  extractor_last_at?: string | null; // última pasada del ProspectExtractor (tope 1/día)
```

(b) Al final del archivo agregar:

```typescript
/**
 * Bloque "DATOS YA APORTADOS" para el system prompt del tool-loop.
 * Solo slots 'lleno' con valor real. Vacío si no hay nada (no ensucia el prompt).
 */
export function buildDatosAportados(state: DialogueState): string {
  const llenos = Object.entries(state.slots)
    .filter(([, s]) => s.estado === 'lleno' && s.valor !== null && s.valor !== '');
  if (llenos.length === 0) return '';
  return [
    'DATOS YA APORTADOS POR EL CLIENTE (no los vuelvas a preguntar; usalos):',
    ...llenos.map(([k, s]) => `- ${k}: ${s.valor}`),
  ].join('\n');
}

export interface BookingPrefill {
  nombre?: string;
  zona?: string;
  modalidad?: 'presencial' | 'video';
  telefono?: string;
}

/**
 * Datos de agendado ya aportados, para pre-cargar BookingFlow
 * (que ya saltea etapas cuando los recibe).
 */
export function slotsPrefill(state: DialogueState): BookingPrefill {
  const val = (k: string): string | undefined => {
    const s = state.slots[k];
    return s && s.estado === 'lleno' && s.valor !== null && s.valor !== '' ? String(s.valor) : undefined;
  };
  const out: BookingPrefill = {};
  const nombre = val('nombre'); if (nombre) out.nombre = nombre;
  const zona = val('zona'); if (zona) out.zona = zona;
  const m = val('modalidad'); if (m === 'presencial' || m === 'video') out.modalidad = m;
  const tel = val('telefono'); if (tel) out.telefono = tel;
  return out;
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `npm run test:run -- src/core/agent/context/__tests__/DialogueState.test.ts`
Expected: PASS (los existentes + nuevos)

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/context/DialogueState.ts src/core/agent/context/__tests__/DialogueState.test.ts
git commit -m "feat(extractor): buildDatosAportados + slotsPrefill + extractor_last_at (spec P2a)"
```

---

### Task 4: `ConversationController` — extractor en paralelo al clasificador

**Files:**
- Modify: `server/src/core/agent/runtime/ConversationController.ts`
- Modify: `server/src/core/agent/runtime/__tests__/ConversationController.test.ts` (agregar describe)

- [ ] **Step 1: Write the failing tests** (agregar al final; deps mínimas autocontenidas, sin depender de helpers del archivo)

```typescript
import { extractProspectDepsTest } from './helpers-no-existe'; // ← NO crear: ver nota
```

Nota: NO crear helpers nuevos. Construir deps inline así:

```typescript
import { ConversationController, type ControllerDeps } from '../ConversationController';
import { createDialogueState } from '../../context/DialogueState';

function extractorDeps(overrides: Partial<ControllerDeps> = {}): { deps: ControllerDeps; saved: any[] } {
  const saved: any[] = [];
  const deps: ControllerDeps = {
    classify: async () => ({
      intent: 'responder_dato', quiere_continuar: true, nivel_frustracion: 0,
      es_cierre: false, slots_detectados: {}, confianza: 0.9,
    }),
    history: async () => [],
    loadState: async () => null,
    saveState: async (_a, _p, s) => { saved.push(s); },
    setOptOut: async () => {},
    closeConversation: async () => {},
    handoff: async () => {},
    redactar: async (obj) => `[msg:${obj.slice(0, 20)}]`,
    detectArea: () => null,
    now: () => '2026-07-06T15:00:00.000Z',
    ...overrides,
  };
  return { deps, saved };
}

describe('ConversationController — ProspectExtractor integrado', () => {
  it('primer mensaje: llama extract y mergea slots + area al estado', async () => {
    let extractCalled = false;
    const { deps, saved } = extractorDeps({
      extract: async () => { extractCalled = true; return { slots: { nombre: 'Ana', edad: 63 }, area: 'jubilacion' }; },
    });
    const c = new ConversationController(deps);
    await c.handleTurn('acc', '549x', 'Hola soy Ana, 63 años, quiero jubilarme');
    expect(extractCalled).toBe(true);
    const final = saved[saved.length - 1];
    expect(final.slots.nombre?.valor).toBe('Ana');
    expect(final.slots.edad?.valor).toBe(63);
    expect(final.area).toBe('jubilacion');           // área del extractor (detectArea mock dio null)
    expect(final.extractor_last_at).toBe('2026-07-06T15:00:00.000Z');
  });

  it('mensaje corto con historial: NO llama extract', async () => {
    let extractCalled = false;
    const { deps } = extractorDeps({
      history: async () => [{ role: 'assistant', content: '¿Su edad?' }],
      extract: async () => { extractCalled = true; return { slots: {}, area: null }; },
    });
    const c = new ConversationController(deps);
    await c.handleTurn('acc', '549x', '63');
    expect(extractCalled).toBe(false);
  });

  it('extract rechaza (promise reject) → el turno sigue normal', async () => {
    const { deps, saved } = extractorDeps({
      extract: async () => { throw new Error('api caída'); },
    });
    const c = new ConversationController(deps);
    const out = await c.handleTurn('acc', '549x', 'Hola soy Ana, 63 años');
    expect(out.kind === 'resolved' || out.kind === 'advance').toBe(true);
    expect(saved.length).toBeGreaterThan(0); // guardó estado igual
  });

  it('el clasificador GANA sobre el extractor en el mismo slot (fase 5 mergea después)', async () => {
    const { deps, saved } = extractorDeps({
      classify: async () => ({
        intent: 'responder_dato', quiere_continuar: true, nivel_frustracion: 0,
        es_cierre: false, slots_detectados: { edad: 64 }, confianza: 0.9,
      }),
      extract: async () => ({ slots: { edad: 63 }, area: null }),
    });
    const c = new ConversationController(deps);
    await c.handleTurn('acc', '549x', 'Perdón, tengo 64, no 63. Como le decía, aporté 30 años en relación de dependencia y vivo en Quilmes centro.');
    const final = saved[saved.length - 1];
    expect(final.slots.edad?.valor).toBe(64);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npm run test:run -- src/core/agent/runtime/__tests__/ConversationController.test.ts`
Expected: FAIL — `extract` no existe en `ControllerDeps` (error de tipos) / extract nunca llamado

- [ ] **Step 3: Implement** — en `ConversationController.ts`:

(a) Imports: agregar `shouldExtract` y el tipo:

```typescript
import { shouldExtract, type ProspectResult } from '../context/IntentClassifier'; // ← NO: va en ProspectExtractor
```

Correcto:

```typescript
import { shouldExtract, type ProspectResult } from '../context/ProspectExtractor';
```

(b) En `ControllerDeps` agregar (después de `classify`):

```typescript
  // Extracción profunda de datos (spec extractor P1): corre en paralelo al clasificador
  // SOLO en mensajes ricos (shouldExtract). Best-effort: falla → null y el turno sigue.
  extract?: (text: string, ctx: { history: Array<{ role: 'user' | 'assistant'; content: string }> }) => Promise<ProspectResult | null>;
```

(c) Destructurar `extract` del `this.deps` junto a los demás (línea ~80).

(d) Reemplazar el bloque "Detectar área + clasificar intención" (hoy):

```typescript
    // ── Detectar área + clasificar intención (con historial como contexto) ─────
    const area = detectArea(text) ?? state2.area;
    const hist = loadHistory ? await loadHistory(accountId, phone).catch(() => []) : [];
    const intent = await classify(text, { dialogueState: state2, area, history: hist });
```

por:

```typescript
    // ── Detectar área + clasificar + extraer (extractor en PARALELO: cero latencia extra) ─
    let area = detectArea(text) ?? state2.area;
    const hist = loadHistory ? await loadHistory(accountId, phone).catch(() => []) : [];
    const wantExtract = !!extract && shouldExtract({
      text, historyLength: hist.length,
      extractorLastAt: state2.extractor_last_at ?? null, now: now(),
    });
    const [intent, prospect] = await Promise.all([
      classify(text, { dialogueState: state2, area, history: hist }),
      wantExtract ? extract!(text, { history: hist }).catch(() => null) : Promise.resolve(null),
    ]);
    // Merge del extractor ANTES del turno (la fase 5 mergea los slots del clasificador
    // DESPUÉS → en un empate gana el clasificador, que es específico de este turno).
    if (prospect) {
      state2 = mergeSlots({ ...state2, extractor_last_at: now() }, prospect.slots);
      if (!area && prospect.area) area = prospect.area;
    }
```

- [ ] **Step 4: Run to verify PASS**

Run: `npm run test:run -- src/core/agent/runtime/__tests__/ConversationController.test.ts`
Expected: PASS (existentes + 4 nuevos). Si algún test existente construye `ControllerDeps` como objeto literal exacto, `extract?` es opcional → no rompe.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/runtime/ConversationController.ts src/core/agent/runtime/__tests__/ConversationController.test.ts
git commit -m "feat(extractor): extractor en paralelo al clasificador en el controller (spec P1)"
```

---

### Task 5: `IntentClassifier` — claves de slots cerradas (spec P3)

**Files:**
- Modify: `server/src/core/agent/context/IntentClassifier.ts`
- Modify: `server/src/core/agent/context/__tests__/IntentClassifier.test.ts` (agregar tests)

- [ ] **Step 1: Write the failing tests**

```typescript
import { sanitizeIntent } from '../IntentClassifier';

describe('sanitizeIntent — claves de slots cerradas', () => {
  it('claves permitidas pasan; desconocidas se descartan', () => {
    const r = sanitizeIntent({
      intent: 'responder_dato',
      slots_detectados: { edad: 63, zona: 'Quilmes', signo_zodiacal: 'tauro', comida_favorita: 'ñoquis' },
    });
    expect(r.slots_detectados).toEqual({ edad: 63, zona: 'Quilmes' });
  });
  it('valores no-primitivos se descartan', () => {
    const r = sanitizeIntent({ intent: 'otro', slots_detectados: { edad: { anidado: true }, nombre: 'Ana' } });
    expect(r.slots_detectados).toEqual({ nombre: 'Ana' });
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npm run test:run -- src/core/agent/context/__tests__/IntentClassifier.test.ts`
Expected: FAIL — `signo_zodiacal` presente en el resultado

- [ ] **Step 3: Implement** — en `IntentClassifier.ts`:

(a) Después de `INTENT_LABELS` agregar:

```typescript
// Claves de slots PERMITIDAS — mismo esquema que ProspectExtractor (spec P3).
// Cualquier otra clave que invente el modelo se descarta en el sanitizador.
export const SLOT_KEYS = new Set([
  'nombre', 'dni', 'edad', 'anios_aporte', 'fecha', 'hora', 'modalidad',
  'zona', 'nacionalidad', 'telefono', 'genero', 'hijos', 'urgencia', 'mejor_horario',
]);
```

(b) En `sanitizeIntent`, reemplazar el bloque de `slots_detectados`:

```typescript
  // slots_detectados: solo objeto plano + SOLO claves permitidas + valores primitivos
  const slotsRaw = raw.slots_detectados;
  const slots_detectados: Record<string, string | number> = {};
  if (slotsRaw && typeof slotsRaw === 'object' && !Array.isArray(slotsRaw)) {
    for (const [k, v] of Object.entries(slotsRaw)) {
      if (!SLOT_KEYS.has(k)) continue;
      if (typeof v === 'string' || typeof v === 'number') slots_detectados[k] = v;
    }
  }
```

(c) En `CLASSIFY_PROMPT`, reemplazar la línea de claves sugeridas:

```
  '  Claves sugeridas: nombre, dni, edad, anios_aporte, fecha, hora, modalidad, zona, nacionalidad.',
```

por:

```
  '  Claves PERMITIDAS (las únicas válidas; cualquier otra se ignora): nombre, dni, edad, anios_aporte, fecha, hora, modalidad, zona, nacionalidad, telefono, genero, hijos, urgencia, mejor_horario.',
```

- [ ] **Step 4: Run to verify PASS**

Run: `npm run test:run -- src/core/agent/context/__tests__/IntentClassifier.test.ts`
Expected: PASS (existentes + nuevos). Si un test existente usaba una clave fuera de la lista, agregarla a `SLOT_KEYS` solo si es un dato real del dominio; si era basura de test, actualizar el test.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/context/IntentClassifier.ts src/core/agent/context/__tests__/IntentClassifier.test.ts
git commit -m "feat(extractor): claves de slots cerradas en el clasificador (spec P3)"
```

---

### Task 6: `AgentRuntime` — consumir datosAportados + prefill (spec P2a/P2b/P2c)

**Files:**
- Modify: `server/src/core/agent/runtime/AgentRuntime.ts`
- Modify: `server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts` (agregar describe)

- [ ] **Step 1: Write the failing tests** (autocontenidos; mocks completos de RuntimeDeps)

```typescript
import { AgentRuntime } from '../AgentRuntime';

function runtimeDeps(overrides: any = {}) {
  const calls: any = { systemPrompts: [] as string[], bookingStartArgs: [] as any[] };
  const deps: any = {
    ai: { completeWithTools: async (o: any) => { calls.systemPrompts.push(o.systemPrompt); return { content: 'ok' }; } },
    persona: { build: () => 'PERSONA_BASE' },
    memory: { load: async () => ({ fichaText: 'FICHA', calificacion: null }) },
    tools: { schemas: () => [], execute: async () => ({ ok: true }) },
    loadAccount: async () => ({ channel: 'whatsapp' }),
    history: async () => [],
    ...overrides,
  };
  return { deps, calls };
}

describe('AgentRuntime — datosAportados + prefill', () => {
  it('advance con datosAportados → el system prompt del tool-loop lo incluye', async () => {
    const { deps, calls } = runtimeDeps({
      conversation: { handleTurn: async () => ({ kind: 'advance', datosAportados: 'DATOS YA APORTADOS POR EL CLIENTE (no los vuelvas a preguntar; usalos):\n- edad: 63' }) },
    });
    const rt = new AgentRuntime(deps);
    await rt.handle('acc', '549x', 'quiero jubilarme');
    expect(calls.systemPrompts[0]).toContain('DATOS YA APORTADOS');
    expect(calls.systemPrompts[0]).toContain('- edad: 63');
  });

  it('gate determinístico pasa nombre/zona/telefonoSugerido del prefill a booking.start', async () => {
    const { deps, calls } = runtimeDeps({
      conversation: { handleTurn: async () => ({ kind: 'advance', prefill: { nombre: 'Ana', zona: 'Quilmes', telefono: '541151749871' } }) },
      bookingIntent: () => ({ start: true }),
      areaDetector: () => null,
      booking: {
        isActive: async () => false,
        advance: async () => ({ messages: [], active: false }),
        start: async (_a: string, _p: string, args: any) => { calls.bookingStartArgs.push(args); return { messages: ['¿En qué localidad vive?'], active: true }; },
      },
    });
    const rt = new AgentRuntime(deps);
    await rt.handle('acc', '549x', 'quiero un turno');
    expect(calls.bookingStartArgs[0]).toMatchObject({ nombre: 'Ana', zona: 'Quilmes', telefonoSugerido: '541151749871' });
  });

  it('start_booking del LLM: los args del modelo GANAN sobre el prefill, pero el prefill completa lo vacío', async () => {
    let started: any = null;
    const { deps } = runtimeDeps({
      conversation: { handleTurn: async () => ({ kind: 'advance', prefill: { nombre: 'Ana', zona: 'Quilmes' } }) },
      ai: { completeWithTools: async () => ({ toolCalls: [{ id: '1', name: 'start_booking', args: { zona: 'Haedo' } }] }) },
      booking: {
        isActive: async () => false,
        advance: async () => ({ messages: [], active: false }),
        start: async (_a: string, _p: string, args: any) => { started = args; return { messages: ['ok'], active: true }; },
      },
    });
    const rt = new AgentRuntime(deps);
    await rt.handle('acc', '549x', 'dale agendame');
    expect(started).toMatchObject({ nombre: 'Ana', zona: 'Haedo' }); // zona del modelo gana; nombre del prefill completa
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npm run test:run -- src/core/agent/runtime/__tests__/AgentRuntime.test.ts`
Expected: FAIL — prompt sin bloque / args sin nombre-zona

- [ ] **Step 3: Implement** — en `AgentRuntime.ts`:

(a) Tipo de `conversation` en `RuntimeDeps` (reemplazar el actual):

```typescript
  conversation?: {
    handleTurn: (accountId: string, phone: string, text: string) =>
      Promise<
        | { kind: 'resolved'; messages: string[] }
        | {
            kind: 'advance';
            directive?: string;
            // Bloque "DATOS YA APORTADOS" para el system prompt (spec extractor P2a).
            datosAportados?: string;
            // Datos ya aportados para pre-cargar el agendado (spec P2b/P2c/P2d).
            prefill?: { nombre?: string; zona?: string; modalidad?: 'presencial' | 'video'; telefono?: string };
          }
      >;
  };
```

(b) En `handle()`, antes del bloque `if (this.deps.booking && await isActive...)` declarar:

```typescript
    // Prefill de agendado que sale del controller (slots ya aportados). El teléfono viaja
    // como telefonoSugerido: BookingFlow lo CONFIRMA antes de usarlo (spec P2d).
    let prefill: { nombre?: string; zona?: string; modalidad?: 'presencial' | 'video'; telefono?: string } = {};
```

(c) En el bloque del controller (donde hoy procesa `outcome`), después de la línea del `directive`:

```typescript
        if (outcome.kind === 'advance') {
          if (outcome.datosAportados) systemPrompt = `${systemPrompt}\n\n${outcome.datosAportados}`;
          if (outcome.prefill) prefill = outcome.prefill;
        }
```

(d) Gate determinístico (hoy `booking.start(accountId, phone, { modalidad: intent.modalidad, needsPhone }, ...)`):

```typescript
              const r = await this.deps.booking.start(accountId, phone, {
                modalidad: intent.modalidad ?? prefill.modalidad,
                zona: prefill.zona,
                nombre: prefill.nombre,
                telefonoSugerido: prefill.telefono,
                needsPhone,
              }, ctx.conversation ?? text);
```

(e) `start_booking` del tool-loop (hoy `{ ...(startCall.args ?? {}), needsPhone }`):

```typescript
          const r = await this.deps.booking.start(accountId, phone, {
            modalidad: prefill.modalidad,
            zona: prefill.zona,
            nombre: prefill.nombre,
            telefonoSugerido: prefill.telefono,
            ...(startCall.args ?? {}),   // lo que dijo el modelo GANA sobre el prefill
            needsPhone,
          }, ctx.conversation ?? text);
```

- [ ] **Step 4: Run to verify PASS**

Run: `npm run test:run -- src/core/agent/runtime/__tests__/AgentRuntime.test.ts`
Expected: PASS (existentes + 3 nuevos)

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/runtime/AgentRuntime.ts src/core/agent/runtime/__tests__/AgentRuntime.test.ts
git commit -m "feat(extractor): AgentRuntime consume datosAportados y prefill de agendado (spec P2)"
```

---

### Task 7: `BookingFlow` — `telefonoSugerido`: confirmar, no pedir de cero (spec P2d)

**Files:**
- Modify: `server/src/core/agent/context/BookingFlow.ts`
- Modify: `server/src/core/agent/context/__tests__/BookingFlow.test.ts` (agregar describe)

Contexto para el implementador: hoy `startBooking` ya acepta `telefono` (confiado, agenda directo) — ese camino queda intacto (lo usa el LLM cuando el cliente dictó el número en el chat). `telefonoSugerido` es el NUEVO camino para el teléfono que capturó el extractor: **se confirma antes de usar**.

- [ ] **Step 1: Write the failing tests** (mirar el `makeDeps`/helpers del archivo de test existente y reusarlos para `deps`; los tests nuevos solo necesitan `freeSlots` con 1 slot y `book` espía)

```typescript
describe('telefonoSugerido — confirmar en vez de pedir de cero (FB/IG)', () => {
  // deps mínimas: 1 slot libre y book espía (reusar el patrón de makeDeps del archivo).
  function depsConSlot(booked: any[]) {
    return {
      suggestOffice: async () => ({ oficina_sugerida: null, necesita_aclaracion: false }),
      videoOfficeName: async () => 'VIDEO',
      defaultOffice: async () => null,
      presencialOffices: async () => [],
      freeSlots: async () => [{ start: '2026-07-08T13:00:00.000Z', end: '2026-07-08T13:30:00.000Z', oficina: 'VIDEO' }],
      book: async (b: any) => { booked.push(b); return { modalidad: 'video' }; },
    } as any;
  }

  it('needsPhone + telefonoSugerido: tras el nombre pide CONFIRMACIÓN del número', async () => {
    const booked: any[] = [];
    const deps = depsConSlot(booked);
    let step = await startBooking({ modalidad: 'video', needsPhone: true, telefonoSugerido: '541151749871' }, deps);
    step = await advanceBooking(step.state, 'el primero', deps);       // elige slot → ask_name
    step = await advanceBooking(step.state, 'Ana López', deps);        // nombre → debe CONFIRMAR el sugerido
    expect(step.state.stage).toBe('ask_phone');
    expect(step.messages[0]).toContain('541151749871');
    expect(booked).toHaveLength(0);                                    // NO agendó todavía
  });

  it('confirma con "sí" → agenda con el teléfono sugerido', async () => {
    const booked: any[] = [];
    const deps = depsConSlot(booked);
    let step = await startBooking({ modalidad: 'video', needsPhone: true, telefonoSugerido: '541151749871', nombre: 'Ana' }, deps);
    step = await advanceBooking(step.state, 'el primero', deps);       // con nombre ya puesto → va directo a confirmar teléfono
    expect(step.state.stage).toBe('ask_phone');
    step = await advanceBooking(step.state, 'sí, ese', deps);
    expect(booked).toHaveLength(1);
    expect(booked[0].telefono).toBe('541151749871');
  });

  it('responde con OTRO número → valida y usa el nuevo', async () => {
    const booked: any[] = [];
    const deps = depsConSlot(booked);
    let step = await startBooking({ modalidad: 'video', needsPhone: true, telefonoSugerido: '541151749871', nombre: 'Ana' }, deps);
    step = await advanceBooking(step.state, 'el primero', deps);
    step = await advanceBooking(step.state, 'mejor al 011 4785 9600', deps);
    expect(booked).toHaveLength(1);
    expect(booked[0].telefono).not.toBe('541151749871');
  });

  it('sin needsPhone (WhatsApp): telefonoSugerido se ignora, agenda directo', async () => {
    const booked: any[] = [];
    const deps = depsConSlot(booked);
    let step = await startBooking({ modalidad: 'video', needsPhone: false, telefonoSugerido: '541151749871', nombre: 'Ana' }, deps);
    step = await advanceBooking(step.state, 'el primero', deps);
    expect(booked).toHaveLength(1); // WhatsApp ya tiene el número del canal
  });
});
```

(Ajustar imports/`deps` al patrón real del archivo de tests existente — `startBooking`/`advanceBooking` ya se importan ahí.)

- [ ] **Step 2: Run to verify FAIL**

Run: `npm run test:run -- src/core/agent/context/__tests__/BookingFlow.test.ts`
Expected: FAIL — `telefonoSugerido` no existe en el tipo de args

- [ ] **Step 3: Implement** — en `BookingFlow.ts`:

(a) En `BookingState` agregar (después de `telefono`):

```typescript
  telefonoSugerido?: string;                                  // teléfono capturado por el extractor: se CONFIRMA antes de usar
```

(b) En `startBooking`, args pasa a:

```typescript
  args: { modalidad?: 'presencial' | 'video'; zona?: string; nombre?: string; telefono?: string; telefonoSugerido?: string; needsPhone?: boolean },
```

y en el `state` inicial agregar:

```typescript
    telefonoSugerido: args.telefonoSugerido?.trim() || undefined,
```

(c) En `afterName`, reemplazar:

```typescript
function afterName(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  if (state.needsPhone && !state.telefono) {
    return Promise.resolve({
      state: { ...state, stage: 'ask_phone' as const },
      messages: ['¿A qué número de teléfono lo contactamos? Con código de área, por favor.'],
      active: true,
    });
  }
  return bookNow(state, deps);
}
```

por:

```typescript
function afterName(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  if (state.needsPhone && !state.telefono) {
    // Teléfono capturado por el extractor → CONFIRMAR, no pedir de cero (spec P2d).
    if (state.telefonoSugerido) {
      return Promise.resolve({
        state: { ...state, stage: 'ask_phone' as const },
        messages: [`¿Lo contactamos al ${state.telefonoSugerido}? Si prefiere otro número, escríbamelo con código de área.`],
        active: true,
      });
    }
    return Promise.resolve({
      state: { ...state, stage: 'ask_phone' as const },
      messages: ['¿A qué número de teléfono lo contactamos? Con código de área, por favor.'],
      active: true,
    });
  }
  return bookNow(state, deps);
}
```

(d) En `advanceBooking`, case `'ask_phone'`, agregar como PRIMERA regla del case:

```typescript
      // Confirmación del teléfono sugerido por el extractor: "sí/dale" → usarlo.
      if (state.telefonoSugerido && isAffirmative(text)) {
        return bookNow({ ...state, telefono: state.telefonoSugerido }, deps);
      }
```

(El resto del case queda igual: si escribe otro número, `validarTelefonoAR` lo toma; si escribe "este mismo" en FB/IG, la regla existente re-pide.)

- [ ] **Step 4: Run to verify PASS**

Run: `npm run test:run -- src/core/agent/context/__tests__/BookingFlow.test.ts`
Expected: PASS (existentes + 4 nuevos)

- [ ] **Step 5: Verificar pass-through en BookingService**

Leer `server/src/core/agent/context/BookingService.ts`: confirmar que `start(accountId, phone, args, conversation)` pasa `args` a `startBooking` sin filtrar claves. Si filtra (whitelist de campos), agregar `telefonoSugerido` al pass-through. Si pasa verbatim, no tocar.

- [ ] **Step 6: Commit**

```bash
git add src/core/agent/context/BookingFlow.ts src/core/agent/context/__tests__/BookingFlow.test.ts
git commit -m "feat(extractor): BookingFlow confirma telefonoSugerido en vez de pedir de cero (spec P2d)"
```

---

### Task 8: Wiring en `createAgentRuntime`

**Files:**
- Modify: `server/src/core/agent/runtime/createAgentRuntime.ts`

- [ ] **Step 1: Implement** (wiring puro, sin test unitario propio — lo cubre el typecheck + suite):

(a) Imports nuevos:

```typescript
import { extractProspect } from '../context/ProspectExtractor';
import { buildDatosAportados, slotsPrefill } from '../context/DialogueState';
```

(b) En el constructor del `ConversationController` (deps), agregar después de `classify`:

```typescript
    // Extracción profunda en mensajes ricos (1er mensaje / ≥120 chars). gpt-4o:
    // corre poco (tope 1/día por conversación) y es el turno que más plata vale.
    extract: (text, ectx) => extractProspect({ complete: (o) => AIService.complete(o) }, { text, history: ectx.history, model: 'gpt-4o' }),
```

(c) Reemplazar el wiring de `conversation` en el `new AgentRuntime({...})`:

```typescript
    conversation: { handleTurn: (a, p, t) => conversationController.handleTurn(a, p, t) },
```

por:

```typescript
    conversation: {
      handleTurn: async (a, p, t) => {
        const o = await conversationController.handleTurn(a, p, t);
        if (o.kind === 'resolved') return o;
        // El estado del turno sale del controller: de ahí el bloque para el prompt
        // y el prefill de agendado (spec extractor P2).
        return {
          kind: 'advance' as const,
          directive: o.directive,
          datosAportados: buildDatosAportados(o.state),
          prefill: slotsPrefill(o.state),
        };
      },
    },
```

(Nota: `ControllerOutcome` 'advance' ya incluye `state` — verificar el tipo exportado; si el import del tipo no expone `state`, importar `ControllerOutcome` desde `ConversationController` y usarlo.)

- [ ] **Step 2: Typecheck + suite completa**

Run: `npx tsc --noEmit` (o el script de build del repo: `npm run build` si existe)
Expected: sin errores de tipos.

Run: `npm run test:run`
Expected: TODA la suite verde (≈723+ tests previos + ~20 nuevos). Cualquier test que falle por los cambios de tipos → arreglarlo antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add src/core/agent/runtime/createAgentRuntime.ts
git commit -m "feat(extractor): wiring del ProspectExtractor en el runtime (spec P1+P2)"
```

---

### Task 9: Verificación end-to-end + cierre

- [ ] **Step 1: Simulación del caso que motivó todo**

Mirar `server/scripts/sim-agent.ts` (simulador existente de conversaciones). Correr una simulación con el mensaje rico:

```
"Hola soy Ana López, tengo 63 años, 30 años de aportes, vivo en Quilmes, quiero jubilarme"
```

Verificar en la salida:
1. El agente NO pregunta nombre, edad, aportes ni zona.
2. La calificación se resuelve en ≤2 turnos (llama `set_qualification` con edad=63).
3. Al agendar, ofrece sedes/horarios directamente (no pregunta zona).

Si `sim-agent.ts` requiere env/keys que no están, alternativa: test de integración en `ConversationController.test.ts` + `AgentRuntime.test.ts` ya cubren el camino (los de Task 4 y 6) — dejar la sim para el smoke manual en dev.

- [ ] **Step 2: Suite completa final + typecheck**

Run: `npm run test:run && npx tsc --noEmit`
Expected: todo verde.

- [ ] **Step 3: Commit final si quedó algo suelto + resumen**

```bash
git status --short   # nada pendiente de los archivos del plan
git log --oneline -8 # ~7 commits del extractor
```

---

## Self-review del plan (hecho)

- **Cobertura vs spec:** P1 (Tasks 1-2-4-8) · P2a (3, 6, 8) · P2b (6) · P2c (6) · P2d (7) · P2e/calificación (vía P2a, sin código extra — el libreto ya dice "no re-pedir") · P3 (5) · manejo de errores §4 (tests de Tasks 1, 2, 4) · testing §5 (todas) · sin migración §3 ✓.
- **Placeholders:** ninguno — todo step de código tiene el código.
- **Consistencia de tipos:** `ProspectResult` (T1) = lo que consume `ControllerDeps.extract` (T4) = lo que produce el wiring (T8). `BookingPrefill` (T3) = `prefill` en RuntimeDeps (T6) = args con `telefonoSugerido` (T7). `extractor_last_at` (T3) = lo que lee `shouldExtract` vía controller (T4).
- **Riesgo señalado:** los tests existentes de `ConversationController`/`AgentRuntime`/`BookingFlow` tienen helpers propios que no vi completos — los tests nuevos son autocontenidos para no depender de ellos, y cada task corre el archivo entero para detectar roturas.
