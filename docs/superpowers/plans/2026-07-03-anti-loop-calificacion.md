# Anti-loop de calificación + menos fricción — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminar el loop donde el bot repite el mismo dato de calificación N veces (cliente divaga) y reducir la fricción de horarios, sin perder la flexibilidad del LLM.

**Architecture:** Approach A — un guard determinístico (`AskLoopGuard`) cuenta cuántas veces seguidas el bot preguntó el mismo TEMA sin respuesta; el `ConversationController` computa el streak (con la señal del `IntentClassifier`) y su salida `advance` lleva una directiva de escalación que el `AgentRuntime` inyecta al system prompt del turno. El LLM sigue calificando pero enjaulado contra el loop. Salida "a confirmar" para no trabarse ante un dato decisor faltante. Mejora del matcheo de horarios en `OptionResolver`.

**Tech Stack:** Node/TypeScript, vitest. Tests: `cd server && npx vitest run <ruta>`. Spec: `docs/superpowers/specs/2026-07-03-anti-loop-calificacion-design.md`.

---

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `server/src/core/agent/context/AskLoopGuard.ts` | **Nuevo** — detección de tema, respuesta, streak, directiva (puro) |
| `server/src/core/agent/context/DialogueState.ts` | Campo `ask_streak?: AskStreak \| null` |
| `server/src/core/agent/runtime/ConversationController.ts` | Computa streak, `advance` lleva `directive?` |
| `server/src/core/agent/runtime/AgentRuntime.ts` | `conversation.handleTurn` advance con `directive?`; inyecta al systemPrompt |
| `server/src/core/agent/context/QualificationRules.ts` | `validateQualification` acepta `a_confirmar` |
| `server/src/core/agent/runtime/ToolRegistry.ts` | schema `set_qualification.a_confirmar`; persiste `perfil_json.a_confirmar` |
| `server/src/core/agent/context/OptionResolver.ts` | horarios "14 y 40", "Viernes 14 10", "mañana 15 y 30" |
| `client/src/pages/Agenda.tsx` | badge "FALTA CONFIRMAR" desde `perfil_json.a_confirmar` |

Tests: `context/__tests__/{AskLoopGuard,QualificationRules,OptionResolver}.test.ts`, `runtime/__tests__/{ConversationController,AgentRuntime,ToolRegistry}.test.ts`.

---

### Task 1: AskLoopGuard (módulo puro)

**Files:**
- Create: `server/src/core/agent/context/AskLoopGuard.ts`
- Test: `server/src/core/agent/context/__tests__/AskLoopGuard.test.ts`

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { detectAskedTopic, clientAnswered, nextStreak, escalationDirective } from '../AskLoopGuard';

describe('detectAskedTopic', () => {
  it('detecta cada tema por keyword', () => {
    expect(detectAskedTopic('¿cuántos años de aportes tiene?')).toBe('aportes');
    expect(detectAskedTopic('¿tiene aportes por tareas insalubres?')).toBe('insalubres');
    expect(detectAskedTopic('¿es usted argentino o extranjero?')).toBe('nacionalidad');
    expect(detectAskedTopic('¿me dice su nombre?')).toBe('nombre');
    expect(detectAskedTopic('¿cuántos años tiene?')).toBe('edad');
    expect(detectAskedTopic('¿en qué zona vive?')).toBe('zona');
    expect(detectAskedTopic('¿a qué número lo contactamos?')).toBe('telefono');
    expect(detectAskedTopic('¿cuántos hijos tiene?')).toBe('hijos');
    expect(detectAskedTopic('¿cuál le queda más cómodo?')).toBe('horario');
  });
  it('no confunde una afirmación con una pregunta de dato', () => {
    expect(detectAskedTopic('Perfecto, queda agendado.')).toBeNull();
  });
});

describe('clientAnswered', () => {
  it('número responde aportes/edad', () => {
    expect(clientAnswered('aportes', 'como 25 años')).toBe(true);
    expect(clientAnswered('aportes', 'La Ferrere')).toBe(false);
    expect(clientAnswered('edad', 'tengo 61')).toBe(true);
  });
  it('sí/no responde insalubres', () => {
    expect(clientAnswered('insalubres', 'no, trabajé en un lavadero')).toBe(true);
    expect(clientAnswered('insalubres', 'mañana a la tarde')).toBe(false);
  });
  it('argentino/extranjero responde nacionalidad', () => {
    expect(clientAnswered('nacionalidad', 'soy argentino')).toBe(true);
    expect(clientAnswered('nacionalidad', 'no sé')).toBe(false);
  });
});

describe('nextStreak', () => {
  it('mismo tema no respondido incrementa', () => {
    expect(nextStreak({ topic: 'aportes', count: 1 }, 'aportes', false)).toEqual({ topic: 'aportes', count: 2 });
  });
  it('respondido resetea a null', () => {
    expect(nextStreak({ topic: 'aportes', count: 3 }, 'aportes', true)).toBeNull();
  });
  it('tema nuevo arranca en 1', () => {
    expect(nextStreak({ topic: 'aportes', count: 2 }, 'nacionalidad', false)).toEqual({ topic: 'nacionalidad', count: 1 });
  });
  it('sin pregunta de dato (null) resetea', () => {
    expect(nextStreak({ topic: 'aportes', count: 2 }, null, true)).toBeNull();
  });
});

describe('escalationDirective', () => {
  it('count<2 → null', () => { expect(escalationDirective('aportes', 1)).toBeNull(); });
  it('count 2 → reformular simple', () => {
    expect(escalationDirective('aportes', 2)).toMatch(/reformul/i);
    expect(escalationDirective('aportes', 2)).toMatch(/aportes/);
  });
  it('count 3 → último intento', () => {
    expect(escalationDirective('aportes', 3)).toMatch(/ÚLTIMO|ultimo/i);
  });
  it('count>=4 → no preguntar más, a_confirmar/avanzar', () => {
    const d = escalationDirective('aportes', 4);
    expect(d).toMatch(/NO vuelvas a preguntar/i);
    expect(d).toMatch(/a_confirmar/);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AskLoopGuard.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar AskLoopGuard.ts**

```ts
// ─── AskLoopGuard ─────────────────────────────────────────────────────────────
// Detecta el loop semántico donde el bot repite el MISMO dato de calificación con
// fraseo variado (el anti-echo no lo caza). Funciones puras: sin IA, sin reloj, sin red.
// El controller computa el streak; al pasar el umbral, inyecta una directiva de
// escalación al system prompt para que el LLM reformule y avance (nunca repita).

import { norm } from './normalize';

export type AskTopic =
  | 'nombre' | 'edad' | 'aportes' | 'insalubres' | 'nacionalidad'
  | 'anio_ingreso' | 'hijos' | 'zona' | 'telefono' | 'horario';

export interface AskStreak { topic: AskTopic; count: number }

// Orden IMPORTA: los específicos antes que los genéricos (insalubres/anio_ingreso
// contienen palabras que también matchearían edad/nacionalidad).
const TOPIC_PATTERNS: Array<[AskTopic, RegExp]> = [
  ['insalubres', /insalubre|tareas? pesadas?|trabajo (pesado|insalubre)/],
  ['anio_ingreso', /ano.*ingreso|ingreso al pais|figura en el dni/],
  ['aportes', /aportes?|anios? de aporte|cuanto aporto/],
  ['nacionalidad', /argentino o extranjero|nacionalidad|es extranjero/],
  ['hijos', /cuantos hijos|tiene hijos/],
  ['edad', /cuantos anos tiene|su edad|que edad/],
  ['nombre', /su nombre|como se llama|a nombre de quien|me dice su nombre|decirme su nombre/],
  ['zona', /que zona|localidad|donde vive|de donde es/],
  ['telefono', /telefono|celular|numero.*contact|numero.*whatsapp|a que numero/],
  ['horario', /que horario|cual le queda|dia le queda|le ofrezco|tengo disponible/],
];

/** Qué dato pidió el bot en su último mensaje. null si no pregunta un dato. */
export function detectAskedTopic(botText: string): AskTopic | null {
  const t = norm(botText);
  if (!t) return null;
  for (const [topic, re] of TOPIC_PATTERNS) if (re.test(t)) return topic;
  return null;
}

const HAS_NUM = /\d/;
function mencionaOficioInsalubre(t: string): boolean {
  return /construccion|albanil|obra|mineria|minero|fundicion|frigorifico|estiba|pintura|soldadura|lavadero|petrole|quimic/.test(t);
}

/** ¿El mensaje del cliente responde ese tema? Heurística por tipo de dato. */
export function clientAnswered(topic: AskTopic, clientText: string): boolean {
  const t = norm(clientText);
  if (!t) return false;
  switch (topic) {
    case 'aportes': case 'edad': case 'hijos': case 'anio_ingreso':
      return HAS_NUM.test(t);
    case 'telefono':
      return (t.replace(/\D/g, '').length >= 8);
    case 'insalubres':
      return /\b(si|sip|no|nop|tengo|tuve|nunca|jamas|tareas? insalubres?)\b/.test(t) || mencionaOficioInsalubre(t);
    case 'nacionalidad':
      return /argentin|extranjer|boliviano|paraguayo|peruano|chileno|uruguayo|nacido/.test(t);
    case 'nombre':
      return t.split(' ').some((w) => /^[a-z]{3,}$/.test(w) && !['hola','buenas','gracias','señor','senora','señora'].includes(w));
    case 'zona':
      return t.split(' ').some((w) => w.length >= 3);
    case 'horario':
      return HAS_NUM.test(t) || /manana|tarde|lunes|martes|miercoles|jueves|viernes|mediodia/.test(t);
    default:
      return false;
  }
}

/** Mismo tema no respondido → count++; tema nuevo → 1; respondido o sin-pregunta → null. */
export function nextStreak(prev: AskStreak | null, asked: AskTopic | null, answered: boolean): AskStreak | null {
  if (!asked || answered) return null;
  if (prev && prev.topic === asked) return { topic: asked, count: prev.count + 1 };
  return { topic: asked, count: 1 };
}

const TEMA_ES: Record<AskTopic, string> = {
  nombre: 'el nombre', edad: 'la edad', aportes: 'los años de aportes',
  insalubres: 'los aportes por tareas insalubres', nacionalidad: 'la nacionalidad',
  anio_ingreso: 'el año de ingreso al país', hijos: 'la cantidad de hijos',
  zona: 'la zona/localidad', telefono: 'el teléfono', horario: 'el horario',
};

/** Directiva a inyectar al system prompt. null si count < 2. */
export function escalationDirective(topic: AskTopic, count: number): string | null {
  const tema = TEMA_ES[topic];
  if (count < 2) return null;
  if (count === 2) {
    return `El cliente todavía no respondió sobre ${tema}. Reformulá la pregunta de forma MÁS SIMPLE y corta, UNA sola vez, con otras palabras. No repitas la frase anterior.`;
  }
  if (count === 3) {
    return `Es tu ÚLTIMO intento por ${tema}: preguntalo de la forma más simple posible, con un ejemplo concreto. Si el cliente ya intentó responder, no insistas más.`;
  }
  return `NO vuelvas a preguntar ${tema}. Registrá la calificación con lo que ya tenés: si ${tema} es necesario para decidir gratis/pago, llamá set_qualification con a_confirmar incluyendo "${topic}" y resultado "gratis"; si no es decisivo, seguí al paso siguiente (agendar). Nunca dejes al cliente esperando por ${tema}.`;
}
```

- [ ] **Step 4: Correr — PASS**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/AskLoopGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/agent/context/AskLoopGuard.ts server/src/core/agent/context/__tests__/AskLoopGuard.test.ts
git commit -m "feat(agente): AskLoopGuard — detecta loop semantico de calificacion y escala directiva

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wiring — DialogueState.ask_streak + ConversationController + AgentRuntime

**Files:**
- Modify: `server/src/core/agent/context/DialogueState.ts` (interface + createDialogueState)
- Modify: `server/src/core/agent/runtime/ConversationController.ts`
- Modify: `server/src/core/agent/runtime/AgentRuntime.ts`
- Test: `server/src/core/agent/runtime/__tests__/ConversationController.test.ts`, `.../AgentRuntime.test.ts`

- [ ] **Step 1: DialogueState — campo**

En `DialogueState.ts`, importar el tipo y agregar el campo:
```ts
import type { AskStreak } from './AskLoopGuard';
```
En `interface DialogueState` agregar: `ask_streak?: AskStreak | null;`
En `createDialogueState()` agregar al objeto: `ask_streak: null,`

- [ ] **Step 2: ControllerOutcome — directive en advance (test que falla)**

En `ConversationController.test.ts` agregar (reusar mocks del archivo; el helper `makeClosedDeps`/existentes; si hace falta un history con último bot preguntando aportes, mockealo):
```ts
import { describe, it, expect, vi } from 'vitest';
import { ConversationController } from '../ConversationController';
import { createDialogueState } from '../../context/DialogueState';

function makeAdvanceDeps(over: any = {}) {
  const state = { ...createDialogueState(), fase: 'calificacion' as const, area: 'jubilacion_mujer',
    slots: { edad: { valor: 61, estado: 'lleno' as const, pedido_count: 0 } },
    ask_streak: { topic: 'aportes' as const, count: 2 } };
  return {
    classify: vi.fn().mockResolvedValue({ intent: 'otro', quiere_continuar: true, nivel_frustracion: 0, es_cierre: false, slots_detectados: {}, confianza: 0.9 }),
    history: vi.fn().mockResolvedValue([{ role: 'assistant', content: '¿Cuántos años de aportes tiene?' }, { role: 'user', content: 'La Ferrere' }]),
    loadState: vi.fn().mockResolvedValue(state),
    saveState: vi.fn().mockResolvedValue(undefined),
    setOptOut: vi.fn(), closeConversation: vi.fn(), handoff: vi.fn(),
    redactar: vi.fn().mockResolvedValue('...'),
    detectArea: () => 'jubilacion_mujer',
    now: () => '2026-07-03T12:00:00.000Z',
    ...over,
  };
}

describe('ask_streak → directiva en advance', () => {
  it('bot preguntó aportes, cliente no respondió (streak 2→3) → advance con directive', async () => {
    const deps = makeAdvanceDeps();
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', 'La Ferrere');
    expect(out.kind).toBe('advance');
    expect((out as any).directive).toMatch(/aportes/);
    const saved = deps.saveState.mock.calls.at(-1)?.[2];
    expect(saved.ask_streak).toEqual({ topic: 'aportes', count: 3 });
  });
  it('cliente responde el dato → streak reset, sin directive', async () => {
    const deps = makeAdvanceDeps({ classify: vi.fn().mockResolvedValue({ intent: 'responder_dato', quiere_continuar: true, nivel_frustracion: 0, es_cierre: false, slots_detectados: { aportes: 25 }, confianza: 0.9 }) });
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', 'tengo 25 años de aportes');
    expect((out as any).directive).toBeFalsy();
    const saved = deps.saveState.mock.calls.at(-1)?.[2];
    expect(saved.ask_streak).toBeNull();
  });
});
```

- [ ] **Step 3: Correr — FAIL**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ConversationController.test.ts`
Expected: FAIL — `directive` undefined / ask_streak no computado.

- [ ] **Step 4: Implementar en ConversationController**

Import arriba: `import { detectAskedTopic, clientAnswered, nextStreak, escalationDirective } from '../context/AskLoopGuard';`

En `ControllerOutcome` (líneas ~63-67), extender el caso advance:
```ts
export type ControllerOutcome =
  | { kind: 'resolved'; messages: string[]; state: DialogueState }
  | { kind: 'advance'; state: DialogueState; directive?: string };
```

Justo ANTES del `return { kind: 'advance', state: s };` final (línea ~255), computar el streak con el historial + el classifier:
```ts
    // ── Anti-loop de calificación: si el bot repite el mismo dato sin respuesta,
    // escalar una directiva para el tool-loop (reformular → último → avanzar).
    const lastBot = [...hist].reverse().find((m) => m.role === 'assistant');
    const askedPrev = lastBot ? detectAskedTopic(lastBot.content) : null;
    const answered = askedPrev
      ? (askedPrev in (intent.slots_detectados || {}) || clientAnswered(askedPrev, text))
      : true;
    const streak = nextStreak(s.ask_streak ?? null, askedPrev, answered);
    s = { ...s, ask_streak: streak };
    const directive = streak && streak.count >= 2 ? escalationDirective(streak.topic, streak.count) : null;
    await saveState(accountId, phone, s);
    return { kind: 'advance', state: s, directive: directive ?? undefined };
```
(reemplaza el `await saveState(...)` + `return { kind: 'advance', state: s };` que ya estaban al final — no dupliques el saveState.)

`hist` ya existe en handleTurn (el historial que carga el controller). Si el nombre difiere, usá el que corresponda.

- [ ] **Step 5: AgentRuntime — inyectar la directiva (test que falla)**

En `AgentRuntime.ts`, el tipo del dep conversation (líneas ~47-49) pasa a:
```ts
  conversation?: {
    handleTurn: (accountId: string, phone: string, text: string) =>
      Promise<{ kind: 'resolved'; messages: string[] } | { kind: 'advance'; directive?: string }>;
  };
```

Test en `AgentRuntime.test.ts` (con makeDeps del archivo):
```ts
it('inyecta la directiva del controller al system prompt del tool-loop', async () => {
  const deps = makeDeps([{ content: 'Reformulo la pregunta.' }]);
  const seen: any[] = [];
  deps.ai.completeWithTools = vi.fn(async (o: any) => { seen.push(o.systemPrompt); return { content: 'ok' }; });
  (deps as any).conversation = { handleTurn: vi.fn().mockResolvedValue({ kind: 'advance', directive: 'NO vuelvas a preguntar los años de aportes.' }) };
  const rt = new AgentRuntime(deps as any);
  await rt.handle('acc1', 'p1', 'La Ferrere', {});
  expect(seen[0]).toMatch(/DIRECTIVA DEL SISTEMA/);
  expect(seen[0]).toMatch(/años de aportes/);
});
```

- [ ] **Step 6: Correr — FAIL**, luego implementar en AgentRuntime.

En `handle`, donde se llama `conversation.handleTurn` (línea ~144):
```ts
        const outcome = await this.deps.conversation.handleTurn(accountId, phone, text).catch(() => ({ kind: 'advance' as const }));
        if (outcome.kind === 'resolved') return finishWith(outcome.messages);
        // 'advance' → puede traer una directiva anti-loop para el tool-loop.
        if ((outcome as any).directive) systemPrompt = `${systemPrompt}\n\nDIRECTIVA DEL SISTEMA (obligatoria): ${(outcome as any).directive}`;
```
Para que esto compile, `systemPrompt` debe ser `let` (hoy es `const` en línea ~81): cambiá `const systemPrompt = ...` por `let systemPrompt = ...`.

- [ ] **Step 7: Correr suites**

Run: `cd server && npx vitest run src/core/agent/runtime && npx tsc --noEmit`
Expected: PASS, tsc limpio.

- [ ] **Step 8: Commit**

```bash
git add server/src/core/agent/context/DialogueState.ts server/src/core/agent/runtime/ConversationController.ts server/src/core/agent/runtime/AgentRuntime.ts server/src/core/agent/runtime/__tests__/ConversationController.test.ts server/src/core/agent/runtime/__tests__/AgentRuntime.test.ts
git commit -m "feat(agente): anti-loop — streak de tema + directiva de escalacion inyectada al tool-loop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Salida "a confirmar" (validateQualification + set_qualification + perfil_json)

**Files:**
- Modify: `server/src/core/agent/context/QualificationRules.ts`
- Modify: `server/src/core/agent/runtime/ToolRegistry.ts`
- Test: `server/src/core/agent/context/__tests__/QualificationRules.test.ts`, `.../ToolRegistry.test.ts`

- [ ] **Step 1: Test validateQualification con a_confirmar**

```ts
describe('validateQualification — a_confirmar', () => {
  const H = 'jubilacion_hombre', M = 'jubilacion_mujer';
  it('hombre 60 sin insalubres pero a_confirmar:[insalubres] → acepta', () => {
    expect(validateQualification(H, 'gratis', { edad: 60, nacionalidad: 'argentino', a_confirmar: ['insalubres'] }).ok).toBe(true);
  });
  it('hombre 64 sin nacionalidad pero a_confirmar:[nacionalidad] → acepta', () => {
    expect(validateQualification(H, 'gratis', { edad: 64, a_confirmar: ['nacionalidad'] }).ok).toBe(true);
  });
  it('mujer 61 sin aportes pero a_confirmar:[aportes] → acepta', () => {
    expect(validateQualification(M, 'gratis', { edad: 61, a_confirmar: ['aportes'] }).ok).toBe(true);
  });
  it('sin a_confirmar sigue rechazando (no afloja el criterio general)', () => {
    expect(validateQualification(M, 'gratis', { edad: 61 }).ok).toBe(false);
    expect(validateQualification(H, 'gratis', { edad: 60, nacionalidad: 'argentino' }).ok).toBe(false);
  });
  it('sin edad rechaza aunque haya a_confirmar (la edad es dura)', () => {
    expect(validateQualification(H, 'gratis', { a_confirmar: ['insalubres','edad'] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr — FAIL**, implementar en QualificationRules.

En `validateQualification`, al principio (después del check de edad dura), calcular el set de temas a confirmar y saltearlos:
```ts
  const aConf = new Set<string>(Array.isArray(datos.a_confirmar) ? datos.a_confirmar : []);
```
Y en cada chequeo que puede fallar por un dato faltante, agregar el escape `&& !aConf.has('<tema>')`:
- hombre <63 insalubres: `if (edad < 63 && !insalubres && !aConf.has('insalubres')) return ...`
- hombre nacionalidad: `if (nac !== 'argentino' && nac !== 'extranjero' && !aConf.has('nacionalidad')) return ...`
- hombre extranjero anio_ingreso: `if (nac === 'extranjero' && !(Number(datos.anio_ingreso) <= 2008) && !aConf.has('anio_ingreso')) return ...`
- mujer 60-63 aportes: dentro del branch 60-63, `if (!Number.isFinite(Number(datos.aportes_aprox)) && !aConf.has('aportes')) return ...` y el `<=19` sigue rechazando SOLO si el dato existe (si está en a_confirmar y no hay número, no evalúa el <=19).
(La edad NUNCA se saltea por a_confirmar.)

- [ ] **Step 3: set_qualification schema + persistencia (test)**

Test en `ToolRegistry.test.ts`:
```ts
it('set_qualification acepta a_confirmar y book_appointment lo copia a perfil_json', async () => {
  const setCalificacion = vi.fn();
  // getCalificacion mock que devuelve la entry con a_confirmar (área jubilacion_mujer)
  const getCalificacion = vi.fn().mockResolvedValue({ area: 'jubilacion_mujer', entry: { resultado: 'gratis', datos: { edad: 61, a_confirmar: ['aportes'] } } });
  const reg = new ToolRegistry({ ...baseDeps, setCalificacion, getCalificacion });
  const r1 = await reg.execute('set_qualification', { area: 'jubilacion_mujer', resultado: 'gratis', edad: 61, a_confirmar: ['aportes'] }, { accountId: 'a1', phone: 'p1' });
  expect(r1.ok).toBe(true);
  // al agendar, perfil_json.a_confirmar copiado (mirá cómo el test arma create/buildFicha)
  const created = apptCreate.mock.calls.at(-1)?.[0];
  // si el harness de test corre book_appointment, el perfil_json debe incluir a_confirmar
});
```
(Adaptá al patrón real del test file; el punto es: schema acepta `a_confirmar` y `book_appointment` lo escribe en `perfil_json.a_confirmar`.)

- [ ] **Step 4: Implementar en ToolRegistry**

- `set_qualification` schema properties: agregar `a_confirmar: { type: 'array', items: { type: 'string' }, description: 'Temas que faltan confirmar (ej ["aportes"]); permite agendar gratis a confirmar sin trabarse.' }`.
- En el case `set_qualification`: `if (Array.isArray(args.a_confirmar) && args.a_confirmar.length) datos.a_confirmar = args.a_confirmar.map(String);` (antes de validateQualification, así el validador lo ve).
- En `book_appointment`, al armar `perfil_json`: si la calificación copiada (intake / picked.entry.datos) trae `a_confirmar`, incluirlo: `perfil_json = { ...(perfil_json || {}), a_confirmar: picked?.entry?.datos?.a_confirmar ?? null };` (o desde `intake`). Reusar la lectura de calificación que ya hace Fix 4.

- [ ] **Step 5: Correr — PASS + commit**

Run: `cd server && npx vitest run src/core/agent && npx tsc --noEmit`
```bash
git add server/src/core/agent/context/QualificationRules.ts server/src/core/agent/runtime/ToolRegistry.ts server/src/core/agent/context/__tests__/QualificationRules.test.ts server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts
git commit -m "feat(agente): calificacion 'a confirmar' — agenda gratis sin trabarse y marca la ficha para el abogado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: OptionResolver — horarios "14 y 40" / "Viernes 14 10" / "mañana 15 y 30"

**Files:**
- Modify: `server/src/core/agent/context/OptionResolver.ts`
- Test: `server/src/core/agent/context/__tests__/OptionResolver.test.ts`

- [ ] **Step 1: Tests que fallan**

```ts
describe('formatos de hora extra (fricción prod)', () => {
  const offered = [
    { index: 1, label: 'vie 10/07 14:10', value: '2026-07-10T17:10:00.000Z' },
    { index: 2, label: 'vie 10/07 14:40', value: '2026-07-10T17:40:00.000Z' },
    { index: 3, label: 'lun 06/07 15:30', value: '2026-07-06T18:30:00.000Z' },
  ];
  const pick = (t: string) => resolveOption({ userText: t, offered });
  it('"14 y 40" → 14:40', () => { expect(pick('14 y 40').matchedValue).toBe('2026-07-10T17:40:00.000Z'); });
  it('"Viernes 14 10" → vie 14:10', () => { expect(pick('Viernes 14 10').matchedValue).toBe('2026-07-10T17:10:00.000Z'); });
  it('"el lunes 15 y 30" → lun 15:30', () => { expect(pick('el lunes 15 y 30').matchedValue).toBe('2026-07-06T18:30:00.000Z'); });
  it('hora sin match exacto sigue devolviendo null', () => { expect(pick('a las 20').matchedValue).toBeNull(); });
});
```

- [ ] **Step 2: Correr — FAIL**, implementar.

En `OptionResolver.ts`, ampliar `canonTimes` (de Fix 1) para cubrir "N y MM" y "N y media/cuarto":
```ts
    .replace(/\b([01]?\d|2[0-3])\s+y\s+(media|cuarto|treinta|quince|[0-5]?\d)\b/g, (_m, h, mm) => {
      const min = mm === 'media' || mm === 'treinta' ? '30' : mm === 'cuarto' || mm === 'quince' ? '15' : String(mm).padStart(2, '0');
      return `${h}:${min}`;
    })
```
(agregar ANTES del replace de `[.\s]` para que "14 y 40" → "14:40" gane; y mantené la guarda de años.)
Para "Viernes 14 10": `requestedDay` ya detecta "viernes"; `requestedTime` sobre `canonTimes("viernes 14 10")` debe dar {h:14,m:10} — verificá que el replace `[.\s]` convierte "14 10" → "14:10" y que el día no se lo come. Si hace falta, en el bloque 2b el filtro por día + hora ya combina ambos (Fix 2). Ajustá para que el match día+hora funcione con estos ejemplos.

- [ ] **Step 3: Correr — PASS + commit**

Run: `cd server && npx vitest run src/core/agent/context/__tests__/OptionResolver.test.ts`
```bash
git add server/src/core/agent/context/OptionResolver.ts server/src/core/agent/context/__tests__/OptionResolver.test.ts
git commit -m "fix(agente): OptionResolver acepta '14 y 40' / 'Viernes 14 10' / 'lunes 15 y 30'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Agenda UI — badge "FALTA CONFIRMAR"

**Files:**
- Modify: `client/src/lib/api.ts` (Appointment: `perfil_json` ya existe; asegurar tipo)
- Modify: `client/src/pages/Agenda.tsx`

- [ ] **Step 1: Badge en el detalle**

En `Agenda.tsx`, cerca del badge de cobro (Fix 5), cuando `(selectedApp?.perfil_json as any)?.a_confirmar?.length`:
```tsx
{(selectedApp?.perfil_json as any)?.a_confirmar?.length > 0 && (
  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-100 text-orange-900 border border-orange-300 font-semibold text-sm">
    <span>⚠</span>
    <span>FALTA CONFIRMAR: {((selectedApp!.perfil_json as any).a_confirmar as string[]).join(', ')}</span>
  </div>
)}
```
Ajustá clases al tema light/dark como el resto. Si `perfil_json` no está tipado en `Appointment` (api.ts), agregar `perfil_json?: Record<string, any> | null;`.

- [ ] **Step 2: Build**

Run: `cd client && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.ts client/src/pages/Agenda.tsx
git commit -m "feat(agenda): badge FALTA CONFIRMAR cuando la calificacion quedo a confirmar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificación integral + re-simulación

- [ ] **Step 1: Suite completa + tsc**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: 0 errores, toda la suite verde.

- [ ] **Step 2: Re-simular (throttled) el set de cobertura**

Correr `server/scripts/sim-replay-full.ts` (ts-node, con el throttle ya aplicado) sobre `scratchpad/no-book-50.jsonl` y comparar con la corrida previa: loops de calificación (debe bajar a ~0), y de los clientes de cobertura que enganchan, cuántos llegan a la oferta presencial (debe subir). Guardar el reporte.

Run: `cd server && node_modules/.bin/ts-node --transpile-only scripts/sim-replay-full.ts`

- [ ] **Step 3: Revisar 5-8 transcripciones** donde antes loopeaba, confirmar que ahora reformula y avanza (o agenda a confirmar).

---

## Decisiones tomadas (para el ejecutor)

1. **Escalera de escalación**: 2º reformular simple → 3º último intento simple → ≥4 no preguntar más (a_confirmar/avanzar). Nunca repetir idéntico.
2. **a_confirmar** solo afloja los datos NO-edad; la edad sigue siendo dura.
3. **Sin migración**: `a_confirmar` va en `perfil_json` (jsonb existente).
4. **El guard inyecta directiva, no decide**: el LLM sigue leyendo el mensaje completo (fortaleza para mensajes con varios datos).
5. **Reusar el estado del controller**: no se agregan cargas ni deps nuevas a AgentRuntime; el `advance` lleva la directiva.
