# Flujos del bot más humanos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el bot responda cualquier pregunta en rol sin gastar IA en cada mensaje (detector barato), con menú sin números, sin pedir apellido y tono más humano.

**Architecture:** Se extienden los servicios existentes (enfoque A del spec). Un módulo puro `ConversationGate` centraliza el gateo barato (4 señales + reintentos) y se invoca antes de cualquier IA. Los agentes IA (`SupportAgentService`, `SupervisorService`) suman la acción `answer` que responde en rol usando `accounts.business_context`. El `PollExecutor` deja de pedir números. El flujo de entrada pasa a saludo abierto + ruteo por IA con botones de respaldo.

**Tech Stack:** TypeScript, Node, Vitest (`server/package.json`: `"test": "vitest"`), Supabase (migraciones SQL), WhatsApp (Baileys + Cloud API).

Spec de referencia: `docs/superpowers/specs/2026-06-20-bot-flows-humanos-design.md`.

**Comandos base:**
- Tests (un archivo): `cd server && npx vitest run src/core/engine/__tests__/ConversationGate.test.ts`
- Type-check: `cd server && npm run type-check`

---

### Task 1: `ConversationGate` — detector barato (puro, sin IA)

**Files:**
- Create: `server/src/core/engine/ConversationGate.ts`
- Test: `server/src/core/engine/__tests__/ConversationGate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/engine/__tests__/ConversationGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluate, matchOption, isQuestion, isLong } from '../ConversationGate';

const OPTS = ['Jubilación / ANSES', 'Despido / Trabajo', 'Otra consulta'];

describe('matchOption', () => {
  it('matchea exacto sin acentos', () => {
    expect(matchOption('jubilacion / anses', OPTS)).toBe('Jubilación / ANSES');
  });
  it('matchea parcial/fuzzy', () => {
    expect(matchOption('despido', OPTS)).toBe('Despido / Trabajo');
  });
  it('matchea por sinónimo del nodo', () => {
    expect(matchOption('me echaron', OPTS, { 'Despido / Trabajo': ['me echaron', 'despidieron'] }))
      .toBe('Despido / Trabajo');
  });
  it('devuelve null si no matchea', () => {
    expect(matchOption('xyz', OPTS)).toBeNull();
  });
});

describe('isQuestion', () => {
  it('detecta signo de pregunta', () => {
    expect(isQuestion('atienden los sábados?')).toBe(true);
  });
  it('detecta palabra-pregunta sin signo', () => {
    expect(isQuestion('cuanto cuesta una consulta')).toBe(true);
  });
  it('no marca una respuesta normal', () => {
    expect(isQuestion('despido')).toBe(false);
  });
});

describe('isLong', () => {
  it('marca texto largo', () => {
    expect(isLong('a'.repeat(121))).toBe(true);
  });
  it('marca multi-oración', () => {
    expect(isLong('Hola. Me echaron del trabajo. Quiero saber qué hago.')).toBe(true);
  });
  it('no marca respuesta corta', () => {
    expect(isLong('jubilación')).toBe(false);
  });
});

describe('evaluate', () => {
  it('match → decision match con value canónico', () => {
    expect(evaluate({ input: 'despido', expectedOptions: OPTS, retryCount: 0 }))
      .toEqual({ decision: 'match', value: 'Despido / Trabajo' });
  });
  it('pregunta off-script → escalate(question) sin gastar reintento', () => {
    expect(evaluate({ input: '¿atienden sábados?', expectedOptions: OPTS, retryCount: 0 }))
      .toEqual({ decision: 'escalate', reason: 'question' });
  });
  it('texto largo → escalate(long)', () => {
    expect(evaluate({ input: 'hola '.repeat(40), expectedOptions: OPTS, retryCount: 0 }).decision)
      .toBe('escalate');
  });
  it('no-match con reintentos disponibles → reprompt', () => {
    expect(evaluate({ input: 'mmm no se', expectedOptions: OPTS, retryCount: 0 }))
      .toEqual({ decision: 'reprompt' });
  });
  it('no-match con reintentos agotados → escalate(retry_exhausted)', () => {
    expect(evaluate({ input: 'mmm no se', expectedOptions: OPTS, retryCount: 1 }))
      .toEqual({ decision: 'escalate', reason: 'retry_exhausted' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/engine/__tests__/ConversationGate.test.ts`
Expected: FAIL — `Cannot find module '../ConversationGate'`.

- [ ] **Step 3: Write the module**

Create `server/src/core/engine/ConversationGate.ts`:

```ts
// ─── ConversationGate ─────────────────────────────────────────────────────────
// Detector barato (SIN IA) que decide si el usuario sigue el flujo o se desvió.
// Solo cuando devuelve 'escalate' el motor invoca IA (gating de costo).
// Funciones puras: no toca DB ni red.

export const LONG_CHARS = 120;

// Palabras que delatan una pregunta/pedido de info (querer info ≠ fallar el paso).
const QUESTION_WORDS = [
  'como', 'cuando', 'donde', 'cuanto', 'cuanta', 'porque', 'atienden', 'atiende',
  'cuesta', 'precio', 'valor', 'horario', 'horarios', 'ubicad', 'queda', 'hacen',
  'sirve', 'puedo', 'puede', 'tienen', 'necesito saber',
];

export type GateDecision =
  | { decision: 'match'; value: string }
  | { decision: 'reprompt' }
  | { decision: 'escalate'; reason: 'question' | 'long' | 'retry_exhausted' };

const fold = (s: string) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/gi, '').toLowerCase().trim();

/** Resuelve el input contra las opciones: exacto (fold) → fuzzy parcial → sinónimos. */
export function matchOption(
  input: string,
  options: string[],
  synonyms?: Record<string, string[]>,
): string | null {
  const ci = fold(input);
  if (!ci) return null;
  // 1. exacto / fuzzy parcial
  for (const o of options) {
    const co = fold(o);
    if (co && (co === ci || (ci.length > 2 && (co.includes(ci) || ci.includes(co))))) return o;
  }
  // 2. sinónimos declarados en el nodo
  if (synonyms) {
    for (const o of options) {
      for (const syn of synonyms[o] || []) {
        const cs = fold(syn);
        if (cs && (cs === ci || (ci.length > 2 && (cs.includes(ci) || ci.includes(cs))))) return o;
      }
    }
  }
  return null;
}

export function isQuestion(input: string): boolean {
  if (input.includes('?') || input.includes('¿')) return true;
  const f = fold(input);
  return QUESTION_WORDS.some(w => f.includes(w));
}

export function isLong(input: string): boolean {
  if ((input || '').length > LONG_CHARS) return true;
  const sentences = (input || '').split(/[.?!]+/).map(s => s.trim()).filter(s => s.length > 3);
  return sentences.length >= 2;
}

export function evaluate(params: {
  input: string;
  expectedOptions: string[];
  retryCount: number;
  maxRetries?: number;
  synonyms?: Record<string, string[]>;
}): GateDecision {
  const { input, expectedOptions, retryCount, maxRetries = 1, synonyms } = params;

  const matched = matchOption(input, expectedOptions, synonyms);
  if (matched) return { decision: 'match', value: matched };

  if (isQuestion(input)) return { decision: 'escalate', reason: 'question' };
  if (isLong(input)) return { decision: 'escalate', reason: 'long' };

  if (retryCount < maxRetries) return { decision: 'reprompt' };
  return { decision: 'escalate', reason: 'retry_exhausted' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/core/engine/__tests__/ConversationGate.test.ts`
Expected: PASS (todos verdes).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/engine/ConversationGate.ts server/src/core/engine/__tests__/ConversationGate.test.ts
git commit -m "feat(gate): ConversationGate detector barato sin IA (4 señales + reintentos)"
```

---

### Task 2: Migración `business_context`

**Files:**
- Create: `supabase/migrations/0012_account_business_context.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_account_business_context.sql`:

```sql
-- Datos del estudio por cuenta: única fuente para que la IA responda preguntas
-- generales (horario, servicios, dirección) sin inventar. Si está vacío, la IA deriva.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_context text DEFAULT '';

COMMENT ON COLUMN accounts.business_context IS
  'Texto libre: horario, servicios, dirección, qué hace y qué NO hace el estudio. Fuente de la acción answer del agente IA.';
```

- [ ] **Step 2: Commit** (la aplicación a Supabase la hace el usuario en deploy; ver nota al final)

```bash
git add supabase/migrations/0012_account_business_context.sql
git commit -m "feat(db): migración 0012 accounts.business_context"
```

---

### Task 3: Cargar `business_context` en el contexto del agente

**Files:**
- Modify: `server/src/services/SupportAgentService.ts` (interface `SupportConfig`, `loadAccountContext`)
- Test: `server/src/services/__tests__/loadAccountContext.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/__tests__/loadAccountContext.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const flowsResult = { data: [] as any[] };

vi.mock('../../config/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'accounts') {
        return { select: () => ({ eq: () => ({ maybeSingle }) }) };
      }
      return { select: () => ({ eq: () => ({ eq: () => flowsResult }) }) };
    },
  },
}));

import { SupportAgentService } from '../SupportAgentService';

describe('loadAccountContext', () => {
  beforeEach(() => { maybeSingle.mockReset(); flowsResult.data = []; });

  it('expone business_context de la cuenta en config', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        ai_support_enabled: true, ai_api_key: 'sk-x', ai_model: 'gpt-4o-mini',
        ai_support_prompt: 'rol', business_context: 'Horario: lun-vie 9-18.',
      },
    });
    const { config } = await SupportAgentService.loadAccountContext('acc-1');
    expect(config.businessContext).toBe('Horario: lun-vie 9-18.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/__tests__/loadAccountContext.test.ts`
Expected: FAIL — `config.businessContext` es `undefined`.

- [ ] **Step 3: Implement**

In `server/src/services/SupportAgentService.ts`, add to `SupportConfig` (after `prompt?: string;`):

```ts
    businessContext?: string;
```

In `loadAccountContext`, change the accounts `select` to include the column:

```ts
            const { data: acc } = await supabase
                .from('accounts')
                .select('ai_support_enabled, ai_api_key, ai_model, ai_support_prompt, business_context')
                .eq('id', accountId)
                .maybeSingle();
```

And inside the `if (acc && ...)` block, after `config.prompt = ...`, add:

```ts
                config.businessContext = (acc as any).business_context || undefined;
```

Also (outside that `if`, so it carga aunque la IA venga del nodo) set it tolerantly right after the try/catch that reads `acc`:

```ts
            // business_context puede existir aunque ai_support_enabled sea false.
            if (acc && (acc as any).business_context && !config.businessContext) {
                config.businessContext = (acc as any).business_context;
            }
```

> Nota: `acc` está declarado dentro del `try`. Mové la declaración `let acc: any = null;` antes del `try` y asigná `acc = (await supabase...).data;` para poder leerlo después. Si la columna no existe, el `catch` lo deja en `null` (compatibilidad hacia atrás).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/__tests__/loadAccountContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/SupportAgentService.ts server/src/services/__tests__/loadAccountContext.test.ts
git commit -m "feat(ai): cargar accounts.business_context en SupportConfig"
```

---

### Task 4: Acción `answer` en `SupportAgentService`

**Files:**
- Modify: `server/src/services/SupportAgentService.ts` (`SupportDecision`, prompt, `resolve`)
- Test: `server/src/services/__tests__/SupportAgentService.answer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/__tests__/SupportAgentService.answer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const extractJSON = vi.fn();
vi.mock('../AIService', () => ({ AIService: { extractJSON } }));

const loadCtx = vi.fn();
vi.mock('../../config/supabase', () => ({ supabase: {} }));

import { SupportAgentService } from '../SupportAgentService';

beforeEach(() => {
  extractJSON.mockReset();
  vi.spyOn(SupportAgentService, 'loadAccountContext').mockImplementation(loadCtx as any);
  loadCtx.mockReset();
});

describe('SupportAgentService.resolve — answer', () => {
  it('answer con business_context → devuelve reply', async () => {
    loadCtx.mockResolvedValue({
      flows: [{ id: '1', name: 'Jub', trigger: 'jubilacion' }],
      config: { apiKey: 'sk', model: 'gpt-4o-mini', businessContext: 'Horario lun-vie 9-18.' },
    });
    extractJSON.mockResolvedValue({ action: 'answer', reply: 'Atendemos lun-vie 9-18hs 🙌' });
    const d = await SupportAgentService.resolve({ accountId: 'a', text: '¿horario?' });
    expect(d.action).toBe('answer');
    expect(d.reply).toContain('9-18');
  });

  it('answer sin business_context → forzar handoff (anti-alucinación)', async () => {
    loadCtx.mockResolvedValue({
      flows: [{ id: '1', name: 'Jub', trigger: 'jubilacion' }],
      config: { apiKey: 'sk', businessContext: '' },
    });
    extractJSON.mockResolvedValue({ action: 'answer', reply: 'invento algo' });
    const d = await SupportAgentService.resolve({ accountId: 'a', text: '¿precio?' });
    expect(d.action).toBe('handoff');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/__tests__/SupportAgentService.answer.test.ts`
Expected: FAIL — `resolve` no devuelve `answer`.

- [ ] **Step 3: Implement**

In `SupportDecision`, extend the union and add `reply`:

```ts
export interface SupportDecision {
    action: 'answer' | 'route' | 'handoff' | 'none';
    reply?: string;     // texto en rol (cuando action='answer')
    trigger?: string;
    flowName?: string;
    reason?: string;
}
```

In `resolve`, replace the `systemPrompt` definition with a version that inyecta el contexto y habilita `answer`:

```ts
        const ctx = (config.businessContext || '').trim();
        const systemPrompt = `${config.prompt || DEFAULT_SUPPORT_PROMPT}

Tenés estos flujos de atención disponibles (cada uno se activa con su "trigger"):
${menu}

DATOS DEL ESTUDIO (única fuente para responder preguntas generales):
${ctx || '(no hay datos cargados)'}

El usuario escribió un mensaje. Decidí UNA acción y respondé SOLO con JSON válido:
{ "action": "answer" | "route" | "handoff", "reply": "<texto o null>", "trigger": "<trigger exacto o null>" }

REGLAS:
- "answer": SOLO si es una pregunta general respondible con los DATOS DEL ESTUDIO de arriba. En "reply" poné la respuesta en rol de atención: humana, breve, voseo argentino, máx 1 emoji, sin sonar robot. Si conviene, ofrecé avanzar ("¿Te agendo?"). NUNCA inventes datos que no estén arriba.
- "route": si revela una gestión que encaja con un flujo. En "trigger" el valor EXACTO del flujo.
- "handoff": si pide una persona, está molesto, o no podés responder con los datos de arriba. "trigger"=null.
- Ante la duda entre answer y handoff cuando el dato no está arriba, elegí handoff.`;
```

In `resolve`, after the `extractJSON` call (replace the post-parse block that currently only handles route/handoff). New logic:

```ts
        if (!parsed || !parsed.action) {
            return { action: 'handoff', reason: 'IA sin respuesta' };
        }

        // answer: validar que haya contexto (anti-alucinación) y reply no vacío.
        if (parsed.action === 'answer') {
            const reply = String((parsed as any).reply || '').trim();
            if (!ctx || !reply) {
                return { action: 'handoff', reason: 'answer sin contexto/reply' };
            }
            return { action: 'answer', reply };
        }

        if (parsed.action === 'handoff' || !parsed.trigger) {
            return { action: 'handoff', reason: parsed.action === 'handoff' ? 'IA decidió handoff' : 'sin trigger' };
        }

        const wantedTrigger = String(parsed.trigger).trim().toLowerCase();
        const match = flows.find(f => f.trigger.toLowerCase() === wantedTrigger);
        if (!match) {
            logger.info(`[SupportAgent] trigger "${wantedTrigger}" no corresponde a ningún flujo → handoff`);
            return { action: 'handoff', reason: 'trigger inválido' };
        }
        logger.info(`[SupportAgent] route → flujo "${match.name}" (trigger="${match.trigger}")`);
        return { action: 'route', trigger: match.trigger, flowName: match.name };
```

> Actualizá el tipo genérico de `extractJSON` a `{ action: string; trigger: string | null; reply?: string | null }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/__tests__/SupportAgentService.answer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/SupportAgentService.ts server/src/services/__tests__/SupportAgentService.answer.test.ts
git commit -m "feat(ai): acción answer en rol con business_context (SupportAgent)"
```

---

### Task 5: Acción `answer` en `SupervisorService` (mid-flujo)

**Files:**
- Modify: `server/src/services/SupervisorService.ts` (`SupervisorDecision`, prompt, switch)
- Test: `server/src/services/__tests__/SupervisorService.answer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/__tests__/SupervisorService.answer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const extractJSON = vi.fn();
vi.mock('../AIService', () => ({ AIService: { extractJSON } }));

import { SupportAgentService } from '../SupportAgentService';
import { SupervisorService } from '../SupervisorService';

beforeEach(() => {
  extractJSON.mockReset();
  vi.spyOn(SupportAgentService, 'loadAccountContext').mockResolvedValue({
    flows: [{ id: '1', name: 'Jub', trigger: 'jubilacion' }],
    config: { apiKey: 'sk', businessContext: 'Horario lun-vie 9-18.' },
  } as any);
});

describe('SupervisorService — answer', () => {
  it('answer con contexto → action answer + reply', async () => {
    extractJSON.mockResolvedValue({ action: 'answer', reply: 'Lun-vie 9-18hs 🙌' });
    const d = await SupervisorService.interpret({
      accountId: 'a', question: '¿Tu edad?', expectedOptions: [], userInput: '¿hasta qué hora atienden?',
    });
    expect(d.action).toBe('answer');
    expect(d.reply).toContain('9-18');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/__tests__/SupervisorService.answer.test.ts`
Expected: FAIL — `action` no es `answer`.

- [ ] **Step 3: Implement**

In `SupervisorDecision`, add `answer` to the union (existing `reply?` ya sirve):

```ts
    action: 'fill' | 'side' | 'switch' | 'human' | 'answer' | 'none';
```

In `interpret`, the `config` ya viene de `loadAccountContext`; añadí el bloque de contexto al `systemPrompt` (después de `flowsBlock`):

```ts
        const ctx = (config.businessContext || '').trim();
```

y dentro del template, agregá tras el bloque de flujos:

```
DATOS DEL ESTUDIO (única fuente para responder preguntas generales):
${ctx || '(no hay datos cargados)'}
```

y agregá una regla y la opción `answer` al JSON de salida del prompt:

```
- "answer": si hace una pregunta general respondible con los DATOS DEL ESTUDIO. En "reply" la respuesta en rol (humana, breve, voseo, máx 1 emoji). Si el dato NO está arriba, NO uses answer: usá "human".
```

(Actualizá la línea del JSON esperado para incluir `"answer"` entre las acciones.)

In the `switch (parsed.action)`, add a case before `default`:

```ts
            case 'answer': {
                const reply = String(parsed.reply || '').trim();
                if (!ctx || !reply) return { action: 'human', reason: 'answer sin contexto/reply' };
                return { action: 'answer', reply };
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/__tests__/SupervisorService.answer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/SupervisorService.ts server/src/services/__tests__/SupervisorService.answer.test.ts
git commit -m "feat(ai): acción answer mid-flujo (Supervisor) con business_context"
```

---

### Task 6: `applySupervisorOutcome` maneja `answer` + router devuelve `reply`

**Files:**
- Modify: `server/src/core/engine/flow.engine.ts` (`applySupervisorOutcome`, líneas ~408-424)
- Modify: `server/src/core/engine/conversation.router.ts` (ramas `_wildcard_pending`, `_no_flow_match`/`_restart_ai`)

- [ ] **Step 1: `answer` mid-flujo → mensaje + re-pregunta**

In `flow.engine.ts`, en `applySupervisorOutcome`, agregá el manejo de `answer` justo después del bloque `if (decision.action === 'side')`:

```ts
        if (decision.action === 'answer') {
            const txt = decision.reply ? `${decision.reply}\n\n${repromptMsg}` : repromptMsg;
            (session as any)._pendingMessages = [txt];
            return true;
        }
```

(Comportamiento idéntico a `side`: responde y el sistema repite el paso. La diferencia es el origen del texto: aquí ya viene resuelto por la IA con datos del estudio.)

- [ ] **Step 2: Router maneja `decision.action === 'answer'`**

In `conversation.router.ts`, en el bloque `_wildcard_pending` (tras obtener `decision`), antes del `if (decision.action === 'route' ...)`:

```ts
        if (decision.action === 'answer' && decision.reply) {
          return [decision.reply];
        }
```

En el bloque `_no_flow_match || _restart_ai`, tras `const decision = await SupportAgentService.resolve(...)`, antes del `if (decision.action === 'route' ...)`:

```ts
      if (decision.action === 'answer' && decision.reply) {
        return [decision.reply];
      }
```

- [ ] **Step 3: Type-check**

Run: `cd server && npm run type-check`
Expected: sin errores (las nuevas acciones ya están en los tipos de Task 4/5).

- [ ] **Step 4: Commit**

```bash
git add server/src/core/engine/flow.engine.ts server/src/core/engine/conversation.router.ts
git commit -m "feat(flujo): propagar acción answer (mid-flujo y router off-script)"
```

---

### Task 7: Conectar `ConversationGate` en `handleInput` (poll + question) con contador de reintentos

**Files:**
- Modify: `server/src/core/engine/flow.engine.ts` (`handleInput`, branch `pollNode` ~471-534 y branch genérico ~543-567)
- Test: `server/src/core/engine/__tests__/handleInput.gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/engine/__tests__/handleInput.gate.test.ts`. Este test verifica que un input que no matchea opciones, con reintentos disponibles, re-pregunta SIN llamar a la IA (Supervisor no se invoca):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const interpret = vi.fn();
vi.mock('../../../services/SupervisorService', () => ({ SupervisorService: { interpret } }));

// Helper: reusar la lógica de gateo de forma aislada vía ConversationGate ya está
// testeada en Task 1. Acá validamos el contador de reintentos en sesión.
import { evaluate } from '../ConversationGate';

beforeEach(() => interpret.mockReset());

describe('gateo con reintentos', () => {
  it('primer no-match → reprompt (no IA)', () => {
    const d = evaluate({ input: 'mmm', expectedOptions: ['A', 'B'], retryCount: 0, maxRetries: 1 });
    expect(d.decision).toBe('reprompt');
    expect(interpret).not.toHaveBeenCalled();
  });
  it('segundo no-match → escalate', () => {
    const d = evaluate({ input: 'mmm', expectedOptions: ['A', 'B'], retryCount: 1, maxRetries: 1 });
    expect(d).toEqual({ decision: 'escalate', reason: 'retry_exhausted' });
  });
});
```

> Nota: el test de integración completo del engine vive en Task 11 (`test-menu.ts`). Acá se fija el contrato del contador.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/engine/__tests__/handleInput.gate.test.ts`
Expected: PASS de `evaluate` (ya implementado), pero el wiring real del contador en el engine aún no existe — seguí al Step 3 para conectarlo.

- [ ] **Step 3: Implement — branch `pollNode`**

In `flow.engine.ts`, dentro del branch `if (currentNode.type === 'pollNode')`, reemplazá el bloque de matching manual (numérico/fold/fuzzy + el `if (index < 0 ...)` que llama al Supervisor) por el gate. Mantené el soporte numérico al inicio (si tipean número sigue valiendo), luego delegá al gate:

```ts
                const options = currentNode.data?.options || ['Sí', 'No'];
                const numericMatch = input.replace(/[\*_]/g, '').match(/\d+/);
                let index = numericMatch ? parseInt(numericMatch[0]) - 1 : -1;

                if (index < 0 || index >= options.length) {
                    const stripped = options.map((o: string) => o.replace(/^\d+[\s.)-]*\s*/, '').trim());
                    const retryKey = `_gate_retries_${currentNode.id}`;
                    const retryCount = parseInt(session.getVariable(retryKey) || '0', 10);
                    const gate = evaluate({
                        input,
                        expectedOptions: stripped,
                        retryCount,
                        maxRetries: parseInt(currentNode.data?.max_retries ?? '1', 10),
                        synonyms: currentNode.data?.synonyms,
                    });

                    const question = currentNode.data?.question || 'Elegí una opción:';
                    const repromptMsg = `Disculpá, no te seguí 🙈 ¿me lo decís de nuevo?\n\n${question}`;

                    if (gate.decision === 'match') {
                        index = stripped.findIndex((o: string) => o === gate.value);
                        session.setVariable(retryKey, '0');
                    } else if (gate.decision === 'reprompt') {
                        session.setVariable(retryKey, (retryCount + 1).toString());
                        (session as any)._pendingMessages = [repromptMsg];
                        session.status = 'waiting_input';
                        session.logInteraction(session.currentNodeId, input);
                        return;
                    } else {
                        // escalate → Supervisor IA (puede answer/fill/switch/human)
                        session.setVariable(retryKey, '0');
                        const decision = await SupervisorService.interpret({
                            accountId, question, expectedOptions: stripped,
                            userInput: input, pushName: session.getVariable('pushName'),
                        });
                        if (decision.action === 'fill' && decision.value) {
                            index = stripped.findIndex((o: string) => o === decision.value);
                        } else {
                            this.applySupervisorOutcome(session, decision, repromptMsg);
                            session.logInteraction(session.currentNodeId, input);
                            return;
                        }
                    }
                } else {
                    // index ya válido por número → match directo, limpiar reintentos
                    session.setVariable(`_gate_retries_${currentNode.id}`, '0');
                }

                if (index >= 0 && index < options.length) {
                    processedInput = options[index];
                    session.setVariable(`${varName}_index`, (index + 1).toString());
                    session.setVariable(`_poll_selected_handle_${currentNode.id}`, `option-${index}`);
                    logger.info(`[FlowEngine] [INPUT] Resolved poll input "${input}" to "${processedInput}"`);
                }
```

Add the import at the top of `flow.engine.ts` (junto a los otros imports de `./`):

```ts
import { evaluate } from './ConversationGate';
```

- [ ] **Step 4: Implement — branch genérico (questionNode con opciones)**

In the `else` branch (genérico, ~543-567), reemplazá el bloque que llama directo al Supervisor por el gate con reintentos:

```ts
                const expected = this.gatherExpectedOptions(flow, currentNode);
                if (expected.length > 0) {
                    const retryKey = `_gate_retries_${currentNode.id}`;
                    const retryCount = parseInt(session.getVariable(retryKey) || '0', 10);
                    const gate = evaluate({
                        input, expectedOptions: expected, retryCount,
                        maxRetries: parseInt(currentNode.data?.max_retries ?? '1', 10),
                        synonyms: currentNode.data?.synonyms,
                    });
                    const question = currentNode.data?.question || currentNode.data?.label || 'el paso anterior';
                    const repromptMsg = `Disculpá, no te seguí 🙈 ¿me lo repetís?`;

                    if (gate.decision === 'match') {
                        processedInput = gate.value;
                        session.setVariable(retryKey, '0');
                    } else if (gate.decision === 'reprompt') {
                        session.setVariable(retryKey, (retryCount + 1).toString());
                        (session as any)._pendingMessages = [repromptMsg];
                        session.status = 'waiting_input';
                        session.logInteraction(session.currentNodeId, input);
                        return;
                    } else {
                        session.setVariable(retryKey, '0');
                        const decision = await SupervisorService.interpret({
                            accountId, question: String(question), expectedOptions: expected,
                            userInput: input, pushName: session.getVariable('pushName'),
                        });
                        if (decision.action === 'fill' && decision.value) {
                            processedInput = decision.value;
                        } else {
                            this.applySupervisorOutcome(session, decision, String(question));
                            session.logInteraction(session.currentNodeId, input);
                            return;
                        }
                    }
                }
```

- [ ] **Step 5: Run tests + type-check**

Run: `cd server && npx vitest run src/core/engine/__tests__/handleInput.gate.test.ts && npm run type-check`
Expected: PASS y sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add server/src/core/engine/flow.engine.ts server/src/core/engine/__tests__/handleInput.gate.test.ts
git commit -m "feat(flujo): gatear handleInput con ConversationGate + contador de reintentos"
```

---

### Task 8: `PollExecutor` sin números (botones + viñetas)

**Files:**
- Modify: `server/src/core/executors/PollExecutor.ts`
- Test: `server/src/core/executors/__tests__/PollExecutor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/executors/__tests__/PollExecutor.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PollExecutor } from '../PollExecutor';

describe('PollExecutor — texto sin números', () => {
  const OLD = process.env;
  beforeEach(() => { process.env = { ...OLD }; delete process.env.WHATSAPP_CLOUD_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; });
  afterEach(() => { process.env = OLD; });

  it('fallback de texto usa viñetas y NO pide número', async () => {
    const r = await new PollExecutor().execute(
      { question: '¿En qué te ayudo?', options: ['Jubilación', 'Despido'] }, { phone: '1' } as any, {},
    );
    const txt = r.messages[0] as string;
    expect(txt).not.toMatch(/\*\d+\.\*/);          // sin "*1.*"
    expect(txt).not.toMatch(/número/i);             // sin "Respondé con el número"
    expect(txt).toContain('•');                     // viñetas
    expect(txt).toContain('Jubilación');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/executors/__tests__/PollExecutor.test.ts`
Expected: FAIL — el texto actual usa `*1.*` y "Respondé con el número".

- [ ] **Step 3: Implement**

In `PollExecutor.ts`, reemplazá el armado del menú de texto (líneas ~17-22) por viñetas sin números:

```ts
        // Texto fallback (Baileys): viñetas, sin números. El match por texto lo
        // resuelve ConversationGate (ej "me echaron" → "Despido").
        const optionLines = options.map((opt: string) => {
            const cleanOpt = opt.replace(/^\d+[\s.)-]*\s*/, '');
            return `• ${cleanOpt}`;
        }).join('\n');
        const menuText = `${question}\n\n${optionLines}`;
```

(Los botones interactivos `interactiveObj` ya no muestran números al usuario: el `id` numérico es interno de WhatsApp, el `title` es el texto. Se deja igual.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/core/executors/__tests__/PollExecutor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/executors/PollExecutor.ts server/src/core/executors/__tests__/PollExecutor.test.ts
git commit -m "feat(menu): PollExecutor texto con viñetas, sin pedir número"
```

---

### Task 9: Interpolación segura `{{var}}` (saludo sin "undefined")

**Files:**
- Create: `server/src/core/engine/interpolate.ts`
- Modify: `server/src/core/executors/MessageExecutor.ts`
- Test: `server/src/core/engine/__tests__/interpolate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/core/engine/__tests__/interpolate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpolate } from '../interpolate';

describe('interpolate', () => {
  it('reemplaza variable presente', () => {
    expect(interpolate('Hola {{nombre}}!', { nombre: 'Lucía' })).toBe('Hola Lucía!');
  });
  it('var ausente → vacío y sin doble espacio', () => {
    expect(interpolate('¡Hola {{nombre}}! 👋', {})).toBe('¡Hola! 👋');
  });
  it('respeta espacios normales', () => {
    expect(interpolate('A {{x}} B', { x: 'y' })).toBe('A y B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/engine/__tests__/interpolate.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implement**

Create `server/src/core/engine/interpolate.ts`:

```ts
// Interpolación segura de {{var}}: si la variable falta, queda vacío y se colapsa
// el espacio sobrante (evita "¡Hola undefined!" y "¡Hola  !").
export function interpolate(template: string, ctx: Record<string, any>): string {
  const out = String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => {
    const v = ctx[name];
    return v === undefined || v === null ? '' : String(v);
  });
  // colapsar doble espacio dejado por una var vacía, sin tocar saltos de línea
  return out.replace(/ {2,}/g, ' ').replace(/ +([!?.,])/g, '$1');
}
```

Then in `MessageExecutor.ts`, reemplazá el `replace` inline por el helper:

```ts
import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { interpolate } from '../engine/interpolate';

export class MessageExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const content = interpolate(data.message || data.text || '', context);
        return { messages: [content], wait_for_input: false };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/core/engine/__tests__/interpolate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/core/engine/interpolate.ts server/src/core/executors/MessageExecutor.ts server/src/core/engine/__tests__/interpolate.test.ts
git commit -m "feat(ux): interpolación segura de {{var}} (saludo sin undefined)"
```

---

### Task 10: Apellido → solo nombre

**Files:**
- Modify: `server/scripts/apply-jub-sexo.js:35`

- [ ] **Step 1: Editar el prompt del nodo**

In `server/scripts/apply-jub-sexo.js`, línea 35, cambiar:

```js
        question: 'Perfecto 👍 ¿A nombre de quién hacemos la consulta? (nombre y apellido)',
```

por:

```js
        question: 'Perfecto 👍 ¿Cómo te llamás?',
```

(El `system_prompt`/`user_prompt` ya clasifican por nombre de pila — no requieren cambios. Es el único uso de "apellido" en `server/` según `grep -ri apellido server/`.)

- [ ] **Step 2: Re-aplicar el flujo a Supabase** (lo corre el usuario; necesita `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` en `.env`)

Run: `cd server && node scripts/apply-jub-sexo.js`
Expected: `✅ Reparado. Nodos: … Edges: …`

> Si no hay credenciales en este entorno, dejar el cambio en el archivo y anotarlo en el checklist de deploy. El script es idempotente.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/apply-jub-sexo.js
git commit -m "ux: pedir solo nombre de pila (sin apellido) en jubilación"
```

---

### Task 11: Flujo de entrada — saludo abierto + ruteo IA + botones de respaldo

**Files:**
- Create: `server/scripts/seed-entrada-humana.js` (basado en el patrón de `server/scripts/seed-router-despido.js` y `apply-jub-sexo.js`)
- Modify: `server/src/core/engine/flow.engine.ts` (`handleInput`: soporte de nodo `data.route_by_ai`)
- Modify: `server/scripts/test-menu.ts` (recorrido nuevo)

- [ ] **Step 1: Soporte de nodo `route_by_ai` en el engine (test primero)**

Create `server/src/core/engine/__tests__/route_by_ai.contract.test.ts` — fija el contrato de la decisión usada por el nodo de saludo:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const resolve = vi.fn();
vi.mock('../../../services/SupportAgentService', () => ({ SupportAgentService: { resolve } }));
import { SupportAgentService } from '../../../services/SupportAgentService';

beforeEach(() => resolve.mockReset());

describe('route_by_ai usa SupportAgentService.resolve', () => {
  it('route → trigger del flujo', async () => {
    resolve.mockResolvedValue({ action: 'route', trigger: 'jubilacion' });
    const d = await SupportAgentService.resolve({ accountId: 'a', text: 'me jubilo' });
    expect(d).toEqual({ action: 'route', trigger: 'jubilacion' });
  });
});
```

Run: `cd server && npx vitest run src/core/engine/__tests__/route_by_ai.contract.test.ts`
Expected: PASS (contrato; el mock devuelve lo esperado).

- [ ] **Step 2: Implementar `route_by_ai` en `handleInput`**

In `flow.engine.ts`, al comienzo de `handleInput`, después de obtener `currentNode` (y antes del bloque `executor.handleInput`), agregá:

```ts
        // Nodo de saludo abierto: la respuesta libre se rutea por IA (answer/route/handoff).
        if (currentNode.data?.route_by_ai) {
            const { SupportAgentService } = await import('../../services/SupportAgentService');
            const decision = await SupportAgentService.resolve({
                accountId, text: input, pushName: session.getVariable('pushName'),
            });
            if (decision.action === 'route' && decision.trigger) {
                (session as any)._exitToAI = true;
                (session as any)._aiResult = { route: decision.trigger };
                session.logInteraction(session.currentNodeId, input);
                return;
            }
            if (decision.action === 'answer' && decision.reply) {
                (session as any)._pendingMessages = [decision.reply];
                // tras responder, avanzar al siguiente nodo (botones de respaldo)
            } else if (decision.action === 'handoff') {
                (session as any)._exitToAI = true;
                (session as any)._aiResult = { handoff: true };
                session.logInteraction(session.currentNodeId, input);
                return;
            }
            // answer o none → caer al avance normal (muestra el poll de botones)
            session.setVariable(currentNode.data?.variable || 'consulta', input);
            session.logInteraction(session.currentNodeId, input);
            const nextId = this.findNextNodeId(flow, currentNode.id, undefined);
            if (nextId) { session.currentNodeId = nextId; } else { session.status = 'waiting_input'; }
            return;
        }
```

> Esto reusa el mecanismo `_exitToAI` / `_aiResult` que el motor ya convierte en `_restart_ai` (línea ~269) y que el router honra (`conversation.router.ts` líneas 86-94). Verificá que `_exitToAI` se chequee tras `handleInput` en `executeMessage` (alrededor de la línea 264-269); si el flag se llama distinto, usá el existente.

- [ ] **Step 3: Seed del flujo de entrada**

Create `server/scripts/seed-entrada-humana.js`. Define el flujo wildcard de entrada con 2 nodos: saludo abierto (`route_by_ai`) → poll de botones de respaldo. Usá el patrón de conexión Supabase de `apply-jub-sexo.js` (dotenv + createClient). Estructura de nodos:

```js
// nodo 1: saludo abierto
{
  id: 'saludo', type: 'questionNode',
  position: { x: 0, y: 0 },
  data: {
    question: '¡Hola{{nombre}}! 👋 Contame, ¿en qué te puedo ayudar?',
    variable: 'consulta',
    route_by_ai: true,
  },
}
// nodo 2: botones de respaldo (sin números)
{
  id: 'menu', type: 'pollNode',
  position: { x: 0, y: 200 },
  data: {
    question: '¿Con cuál te ayudo?',
    options: ['Jubilación / ANSES', 'Despido / Trabajo', 'Otra consulta'],
    variable: 'motivo',
  },
}
```

Edges: `saludo --(default)--> menu`, y desde `menu` los `option-0/1/2` hacia los flowLinks de cada área (replicar el cableado de `seed-router-despido.js`). El `trigger_word` del flujo debe ser `*` (wildcard) para que sea el catch-all de entrada. Marcá el flujo como `is_active: true` y seteá `accounts.flow_id` a este flujo si corresponde (igual que el router actual).

> El `{{nombre}}` se resuelve con `interpolate` (Task 9) usando `pushName`/`nombre`. Si falta, queda "¡Hola! 👋".

- [ ] **Step 4: Aplicar seed** (lo corre el usuario, necesita credenciales)

Run: `cd server && node scripts/seed-entrada-humana.js`
Expected: log de confirmación con ids de nodos/edges.

- [ ] **Step 5: Actualizar `test-menu.ts`**

In `server/scripts/test-menu.ts`, ajustá el recorrido para la entrada nueva: primer mensaje del bot = saludo abierto; simular una respuesta libre ("me echaron del trabajo") y verificar ruteo a Despido; simular una pregunta ("¿atienden sábados?") y verificar `answer`/handoff según `business_context`. Mantené el estilo de aserciones existente del archivo.

- [ ] **Step 6: Type-check + tests**

Run: `cd server && npm run type-check && npx vitest run`
Expected: sin errores; toda la suite verde.

- [ ] **Step 7: Commit**

```bash
git add server/src/core/engine/flow.engine.ts server/scripts/seed-entrada-humana.js server/scripts/test-menu.ts server/src/core/engine/__tests__/route_by_ai.contract.test.ts
git commit -m "feat(entrada): saludo abierto + ruteo IA con botones de respaldo"
```

---

### Task 12: Verificación final + regresión

**Files:** (ninguno nuevo)

- [ ] **Step 1: Suite completa**

Run: `cd server && npx vitest run`
Expected: todos los tests verdes (ConversationGate, loadAccountContext, SupportAgent.answer, Supervisor.answer, handleInput.gate, PollExecutor, interpolate, route_by_ai, + suites previas).

- [ ] **Step 2: Type-check**

Run: `cd server && npm run type-check`
Expected: sin errores.

- [ ] **Step 3: Smoke manual (opcional, requiere entorno con WhatsApp)**

Probar en una cuenta con `business_context` cargado:
- "hola" → saludo abierto (sin menú numerado).
- "me echaron del trabajo" → rutea a Despido sin pedir número.
- "¿atienden sábados?" → responde en rol con el horario.
- En jubilación: "¿cómo te llamás?" (no pide apellido); nombre infiere sexo.
- Pregunta off-topic dentro de un flujo → responde y re-pregunta el paso.

- [ ] **Step 4: Commit (si hubo ajustes de smoke)**

```bash
git add -A
git commit -m "test: verificación final flujos humanos"
```

---

## Nota de deploy (no es código)

- Aplicar la migración `0012` a Supabase (el proyecto usa `supabase/migrations`; correr el SQL en el entorno de la base).
- Cargar `accounts.business_context` por cuenta (horario, servicios, dirección, qué hace y qué NO hace). **Sin esto, las preguntas generales derivan a humano** (comportamiento seguro por diseño).
- Re-aplicar seeds que tocan Supabase con credenciales: `apply-jub-sexo.js`, `seed-entrada-humana.js`.

## Self-review (cobertura del spec)

- Sección 1 (ConversationGate) → Task 1 + wiring Task 7. ✓
- Sección 2 (IA answer + route + handoff) → Tasks 4, 5, 6. ✓
- Sección 3 (menú híbrido sin números) → Tasks 8, 11. ✓
- Sección 4 (apellido → nombre, tono, interpolación) → Tasks 9, 10 + reprompt humano en Task 7. ✓
- Sección 5 (business_context + migración + wiring) → Tasks 2, 3, 4, 5, 6. ✓
- Error handling (IA cae → handoff; context vacío → handoff; compat hacia atrás) → Tasks 4, 5; defaults `max_retries`/`style`. ✓
- Edición admin del textarea `business_context`: marcado como iteración aparte en el spec; no bloquea (carga por SQL). Fuera del alcance de este plan.
