# Re-enganche nocturno Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retomar a la mañana siguiente, con un mensaje, las conversaciones que se cortaron de noche (el contacto "se fue a descansar"), respetando la ventana de 24h de WhatsApp.

**Architecture:** Una decisión PURA `shouldReengage(...)` (testeable con relojes fijos) + un `NightReengageScheduler` (mismo patrón que `NudgeScheduler`: `setInterval`, guard `running`, inyecta `AccountManager`) que cada 10 min busca conversaciones candidatas, evalúa la decisión y manda el texto configurado por cuenta, marcando idempotencia.

**Tech Stack:** Node/TypeScript, Supabase, vitest (DI + stubs), `Intl.DateTimeFormat` para hora local AR.

**Convenciones:** tests en `__tests__/`, deps inyectadas (no mockear módulos), correr `npx vitest run <path>` desde `server/`. Branch `feat-omnichannel`. Zona horaria `America/Argentina/Buenos_Aires`.

---

## File Structure
- `supabase/migrations/0028_reengage.sql` — columnas opt-in + idempotencia.
- `server/src/services/reengage/shouldReengage.ts` — decisión pura + helpers de hora local.
- `server/src/services/reengage/__tests__/shouldReengage.test.ts` — tests de la decisión.
- `server/src/services/NightReengageScheduler.ts` — el scheduler.
- `server/src/services/__tests__/NightReengageScheduler.test.ts` — test del tick (stubs).
- `server/src/index.ts` — arranque del scheduler (edit).

---

## Task 1: Migración `0028_reengage.sql`

**Files:**
- Create: `supabase/migrations/0028_reengage.sql`

- [ ] **Step 1: Crear la migración**

```sql
-- 0028: re-enganche nocturno. Opt-in por cuenta + texto + marca de idempotencia
-- (el last_message_at por el que ya se re-enganchó esa conversación). Idempotente.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS reengage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reengage_text    text;

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS reengaged_for timestamptz;
```

- [ ] **Step 2: Verificación manual**

Aplicar en Supabase. Confirmar: `SELECT reengage_enabled, reengage_text FROM accounts LIMIT 1;` y
`SELECT reengaged_for FROM whatsapp_conversations LIMIT 1;` no dan error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_reengage.sql
git commit -m "feat(reenganche): migración 0028 (opt-in + idempotencia)"
```

---

## Task 2: Decisión pura `shouldReengage` + helpers de hora

**Files:**
- Create: `server/src/services/reengage/shouldReengage.ts`
- Test: `server/src/services/reengage/__tests__/shouldReengage.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
import { describe, it, expect } from 'vitest';
import { shouldReengage, horaLocal, esNoche, esManana } from '../shouldReengage';

// Helper: ISO de una fecha/hora local AR (UTC-3) → instante UTC.
const arLocal = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h + 3, mi)); // AR = UTC-3

describe('helpers de hora local AR', () => {
  it('horaLocal interpreta UTC-3', () => {
    expect(horaLocal(arLocal(2026, 7, 1, 23))).toBe(23);
    expect(horaLocal(arLocal(2026, 7, 1, 2))).toBe(2);
  });
  it('esNoche cubre 22..08', () => {
    expect(esNoche(22)).toBe(true);
    expect(esNoche(2)).toBe(true);
    expect(esNoche(7)).toBe(true);
    expect(esNoche(8)).toBe(false);
    expect(esNoche(15)).toBe(false);
  });
  it('esManana cubre 09..21', () => {
    expect(esManana(9)).toBe(true);
    expect(esManana(8)).toBe(false);
    expect(esManana(22)).toBe(false);
  });
});

describe('shouldReengage', () => {
  const base = {
    lastMessageAt: arLocal(2026, 7, 1, 23),   // anoche 23:00
    reengagedFor: null as Date | null,
    lastInboundAt: arLocal(2026, 7, 1, 23),    // inbound anoche → dentro de 24h a la mañana
    status: 'BOT',
    now: arLocal(2026, 7, 2, 9, 30),           // hoy 09:30
  };

  it('charla cortada de noche → re-engancha a la mañana', () => {
    expect(shouldReengage(base)).toBe(true);
  });
  it('de madrugada NO (now no es mañana)', () => {
    expect(shouldReengage({ ...base, now: arLocal(2026, 7, 2, 3) })).toBe(false);
  });
  it('último mensaje de día (no de noche) → NO', () => {
    expect(shouldReengage({ ...base, lastMessageAt: arLocal(2026, 7, 1, 15) })).toBe(false);
  });
  it('ya re-enganchado para ese last_message_at → NO', () => {
    expect(shouldReengage({ ...base, reengagedFor: base.lastMessageAt })).toBe(false);
  });
  it('fuera de la ventana 24h (inbound viejo) → NO', () => {
    expect(shouldReengage({ ...base, lastInboundAt: arLocal(2026, 6, 30, 23) })).toBe(false);
  });
  it('sin inbound nunca → NO', () => {
    expect(shouldReengage({ ...base, lastInboundAt: null })).toBe(false);
  });
  it('conversación en HANDOVER → NO', () => {
    expect(shouldReengage({ ...base, status: 'HANDOVER' })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/services/reengage/__tests__/shouldReengage.test.ts`
Expected: FAIL — "Cannot find module '../shouldReengage'".

- [ ] **Step 3: Implementar**

```ts
const TZ = 'America/Argentina/Buenos_Aires';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hora local (0-23) en la zona del estudio para ese instante. */
export function horaLocal(date: Date): number {
  const hh = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(date);
  const h = Number(hh);
  return h === 24 ? 0 : h;
}

/** Noche: 22:00–07:59 local. */
export function esNoche(hora: number): boolean {
  return hora >= 22 || hora < 8;
}

/** Mañana/día hábil de contacto: 09:00–21:59 local. */
export function esManana(hora: number): boolean {
  return hora >= 9 && hora < 22;
}

export interface ReengageInput {
  lastMessageAt: Date;
  reengagedFor: Date | null;
  lastInboundAt: Date | null;
  status: string;
  now: Date;
}

/** ¿Hay que re-enganchar esta conversación ahora? Pura, sin efectos. */
export function shouldReengage(i: ReengageInput): boolean {
  if (i.status !== 'BOT') return false;                                   // humano la maneja
  if (!esNoche(horaLocal(i.lastMessageAt))) return false;                 // se cortó de noche
  if (!esManana(horaLocal(i.now))) return false;                          // ahora es de mañana
  if (i.reengagedFor && i.reengagedFor.getTime() === i.lastMessageAt.getTime()) return false; // idempotente
  if (!i.lastInboundAt) return false;                                     // nunca escribió → sin ventana
  if (i.now.getTime() - i.lastInboundAt.getTime() > DAY_MS) return false; // fuera de 24h
  return true;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd server && npx vitest run src/services/reengage/__tests__/shouldReengage.test.ts`
Expected: PASS (3 describes, 13 asserts → "passed").

- [ ] **Step 5: Commit**

```bash
git add src/services/reengage/shouldReengage.ts src/services/reengage/__tests__/shouldReengage.test.ts
git commit -m "feat(reenganche): decisión pura shouldReengage + helpers de hora AR"
```

---

## Task 3: `NightReengageScheduler`

**Files:**
- Create: `server/src/services/NightReengageScheduler.ts`
- Test: `server/src/services/__tests__/NightReengageScheduler.test.ts`

- [ ] **Step 1: Escribir el test (deps inyectadas)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { NightReengageScheduler } from '../NightReengageScheduler';

const arLocal = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h + 3, mi));

function makeDeps(over: any = {}) {
  return {
    // cuentas opt-in
    listEnabledAccounts: over.listEnabledAccounts ?? vi.fn().mockResolvedValue([
      { id: 'acc1', reengage_text: '¡Buen día! ¿Seguimos?' },
    ]),
    // conversaciones candidatas de esa cuenta
    listConversations: over.listConversations ?? vi.fn().mockResolvedValue([
      { id: 'c1', account_id: 'acc1', phone: '5491111', status: 'BOT', last_message_at: arLocal(2026, 7, 1, 23).toISOString(), reengaged_for: null },
    ]),
    lastInboundAt: over.lastInboundAt ?? vi.fn().mockResolvedValue(arLocal(2026, 7, 1, 23)),
    isConnected: over.isConnected ?? vi.fn().mockReturnValue(true),
    sendMessage: over.sendMessage ?? vi.fn().mockResolvedValue(undefined),
    markReengaged: over.markReengaged ?? vi.fn().mockResolvedValue(undefined),
    now: over.now ?? (() => arLocal(2026, 7, 2, 9, 30)),
  };
}

describe('NightReengageScheduler.tick', () => {
  it('manda el texto de la cuenta y marca reengaged_for', async () => {
    const deps = makeDeps();
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).toHaveBeenCalledWith('acc1', '5491111', '¡Buen día! ¿Seguimos?');
    expect(deps.markReengaged).toHaveBeenCalledWith('c1', arLocal(2026, 7, 1, 23).toISOString());
  });

  it('usa el texto default si la cuenta no tiene reengage_text', async () => {
    const deps = makeDeps({ listEnabledAccounts: vi.fn().mockResolvedValue([{ id: 'acc1', reengage_text: null }]) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).toHaveBeenCalledWith('acc1', '5491111', expect.stringContaining('Buen día'));
  });

  it('no manda si la cuenta está desconectada', async () => {
    const deps = makeDeps({ isConnected: vi.fn().mockReturnValue(false) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('no manda si shouldReengage es false (de madrugada)', async () => {
    const deps = makeDeps({ now: () => arLocal(2026, 7, 2, 3) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('no repite si ya se re-enganchó para ese last_message_at', async () => {
    const deps = makeDeps({ listConversations: vi.fn().mockResolvedValue([
      { id: 'c1', account_id: 'acc1', phone: '5491111', status: 'BOT', last_message_at: arLocal(2026, 7, 1, 23).toISOString(), reengaged_for: arLocal(2026, 7, 1, 23).toISOString() },
    ]) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/services/__tests__/NightReengageScheduler.test.ts`
Expected: FAIL — "Cannot find module '../NightReengageScheduler'".

- [ ] **Step 3: Implementar (con deps inyectadas para testear; el wiring real va en Task 4)**

```ts
import { shouldReengage } from './reengage/shouldReengage';

export const DEFAULT_REENGAGE_TEXT = '¡Buen día! ¿Seguimos con tu consulta de ayer? 🙂';

export interface ReengageConversation {
  id: string; account_id: string; phone: string; status: string;
  last_message_at: string | null; reengaged_for: string | null;
}
export interface ReengageDeps {
  listEnabledAccounts: () => Promise<Array<{ id: string; reengage_text: string | null }>>;
  listConversations: (accountId: string) => Promise<ReengageConversation[]>;
  lastInboundAt: (accountId: string, phone: string) => Promise<Date | null>;
  isConnected: (accountId: string) => boolean;
  sendMessage: (accountId: string, phone: string, text: string) => Promise<void>;
  markReengaged: (conversationId: string, lastMessageAt: string) => Promise<void>;
  now?: () => Date;
}

/**
 * NightReengageScheduler — retoma a la mañana las conversaciones cortadas de noche.
 * Patrón NudgeScheduler: tick periódico, idempotente, dentro de la ventana 24h.
 */
export class NightReengageScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly TICK_MS = 10 * 60 * 1000;

  constructor(private deps: ReengageDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error('[NightReengageScheduler] tick error:', e?.message ?? e));
    }, this.TICK_MS);
    console.log('⏰ [NightReengageScheduler] activo (retoma a la mañana lo cortado de noche)');
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = (this.deps.now ?? (() => new Date()))();
      const accounts = await this.deps.listEnabledAccounts();
      for (const acc of accounts) {
        if (!this.deps.isConnected(acc.id)) continue;
        const texto = (acc.reengage_text && acc.reengage_text.trim()) || DEFAULT_REENGAGE_TEXT;
        const convos = await this.deps.listConversations(acc.id);
        for (const c of convos) {
          if (!c.last_message_at) continue;
          const lastInbound = await this.deps.lastInboundAt(acc.id, c.phone);
          const ok = shouldReengage({
            lastMessageAt: new Date(c.last_message_at),
            reengagedFor: c.reengaged_for ? new Date(c.reengaged_for) : null,
            lastInboundAt: lastInbound,
            status: c.status,
            now,
          });
          if (!ok) continue;
          try {
            await this.deps.sendMessage(acc.id, c.phone, texto);
            await this.deps.markReengaged(c.id, c.last_message_at);
            console.log(`[NightReengageScheduler] re-enganche enviado a ${c.phone}`);
          } catch (err: any) {
            console.error(`[NightReengageScheduler] error con ${c.phone}:`, err?.message ?? err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd server && npx vitest run src/services/__tests__/NightReengageScheduler.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check + commit**

Run: `cd server && npx tsc --noEmit` (clean).

```bash
git add src/services/NightReengageScheduler.ts src/services/__tests__/NightReengageScheduler.test.ts
git commit -m "feat(reenganche): NightReengageScheduler (tick idempotente, ventana 24h)"
```

---

## Task 4: Wiring real (Supabase + AccountManager) + arranque

**Files:**
- Modify: `server/src/services/NightReengageScheduler.ts` (factory con deps reales)
- Modify: `server/src/index.ts` (instanciar + `start()` junto a los otros schedulers ~líneas 57-60)

- [ ] **Step 1: Agregar una factory con deps reales al final de `NightReengageScheduler.ts`**

```ts
import { supabase } from '../config/supabase';
import { messageStore } from './MessageStore';
import type { AccountManager } from '../core/accounts/AccountManager';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/** Construye el scheduler con las fuentes reales (Supabase + AccountManager). */
export function createNightReengageScheduler(manager: AccountManager): NightReengageScheduler {
  return new NightReengageScheduler({
    listEnabledAccounts: async () => {
      const { data } = await supabase.from('accounts').select('id, reengage_text').eq('reengage_enabled', true);
      return ((data ?? []) as any[]).map((a) => ({ id: a.id, reengage_text: a.reengage_text ?? null }));
    },
    listConversations: async (accountId) => {
      // Solo las que tuvieron actividad en las últimas ~24h (descarta lo viejísimo).
      const since = new Date(Date.now() - WINDOW_24H_MS).toISOString();
      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('id, account_id, phone, status, last_message_at, reengaged_for')
        .eq('account_id', accountId)
        .eq('status', 'BOT')
        .gt('last_message_at', since)
        .limit(200);
      return (data ?? []) as any[];
    },
    lastInboundAt: (accountId, phone) => messageStore.getLastInboundAt(accountId, phone),
    isConnected: (accountId) => {
      const s = manager.getStatus(accountId);
      return s === 'WORKING' || s === 'connected';
    },
    sendMessage: (accountId, phone, text) => manager.sendMessage(accountId, phone, text).then(() => undefined),
    markReengaged: async (conversationId, lastMessageAt) => {
      await supabase.from('whatsapp_conversations').update({ reengaged_for: lastMessageAt }).eq('id', conversationId);
    },
  });
}
```

NOTA: `manager.getStatus(accountId)` y `manager.sendMessage(accountId, phone, text)` ya los usa
`NudgeScheduler.ts` — copiar esos mismos llamados si la firma difiere.

- [ ] **Step 2: Arrancar en `index.ts`**

En `server/src/index.ts`, junto a donde se crean `reminders`/`nudges` (líneas ~57-60), después de
`const nudges = new NudgeScheduler(manager);` agregar:

```ts
import { createNightReengageScheduler } from './services/NightReengageScheduler';
// ...
  const reengage = createNightReengageScheduler(manager);
```
Y donde se llaman los `.start()` de los schedulers (buscar `reminders.start()` / `nudges.start()`), agregar:
```ts
  reengage.start();
```
Si en el shutdown se hace `nudges.stop()`, agregar también `reengage.stop();`.

- [ ] **Step 3: Type-check**

Run: `cd server && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verificación manual (opcional, requiere server + DB)**

Activar una cuenta: `UPDATE accounts SET reengage_enabled = true WHERE id = '<acc>';`. Confirmar en logs el
arranque `⏰ [NightReengageScheduler] activo`. (El disparo real depende de horario/datos; no se fuerza acá.)

- [ ] **Step 5: Commit**

```bash
git add src/services/NightReengageScheduler.ts src/index.ts
git commit -m "feat(reenganche): wiring real (Supabase + AccountManager) + arranque"
```

---

## Task 5: Verificación

- [ ] **Step 1: Suite de la feature**

Run: `cd server && npx vitest run src/services/reengage src/services/__tests__/NightReengageScheduler.test.ts && npx tsc --noEmit`
Expected: todos verdes, tsc limpio.

- [ ] **Step 2: Suite completa**

Run: `cd server && npx vitest run`
Expected: solo fallan los 6 pre-existentes (AppointmentProposalsExecutor / AppointmentAvailabilityExecutor); el resto verde.

---

## Notas para el ejecutor
- TDD estricto en `shouldReengage` y `NightReengageScheduler.tick` (rojo→verde).
- `index.ts` es glue: verificar por tsc + arranque, sin test.
- No tocar `NudgeScheduler`/`ReminderScheduler`: son features separadas.
- Los 6 tests que ya fallaban (AppointmentProposalsExecutor/AppointmentAvailabilityExecutor) son pre-existentes y ajenos.
