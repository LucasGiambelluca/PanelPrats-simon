# Re-enganche nocturno — retomar al día siguiente

**Fecha:** 2026-06-26
**Estado:** Diseño aprobado, listo para plan
**Alcance:** Detectar conversaciones que se cortaron de noche (el contacto "se fue a descansar") y
mandar UN mensaje a la mañana siguiente para retomar, respetando la ventana de 24h de WhatsApp.

---

## 1. Problema y objetivo

Si una conversación queda abierta de noche (el bot preguntó y el contacto no respondió, o el contacto
escribió tarde y nadie le contestó), hoy no pasa nada: el lead se enfría. Objetivo: como haría un
empleado, **retomar el contacto a la mañana siguiente** con un mensaje breve, una sola vez, sin molestar
de madrugada y sin violar la política de mensajería de WhatsApp.

Funciona a nivel **contacto/conversación** (no de flujo), así sirve igual para `ai_first` y `flows`.

---

## 2. Decisiones (brainstorming)

- **A qué contactos:** conversaciones con actividad reciente que se cortó de noche (local 22:00–08:00 AR)
  sin cerrarse y sin que el contacto volviera a escribir. Cubre ambos sentidos (bot esperando / contacto
  colgado).
- **Texto:** configurable por cuenta (`reengage_text`) con default; opt-in (`reengage_enabled`).
- **Ventana 24h:** solo si todavía se puede mandar mensaje libre (hay un inbound del contacto < 24h). Si
  se pasó la ventana → NO se re-engancha (no usamos plantillas/HSM en este alcance).

---

## 3. Modelo de datos

### Migración `0028_reengage.sql` (idempotente)
```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS reengage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reengage_text    text;

-- Marca de idempotencia: el last_message_at por el que YA re-enganchamos.
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS reengaged_for timestamptz;
```

`whatsapp_conversations` ya tiene `last_message_at`, `status`, `account_id`, `phone` (usados por el inbox).

---

## 4. Lógica de decisión (pura, testeable)

Helper sin efectos, decidible con relojes fijos:

```ts
interface ReengageInput {
  lastMessageAt: Date;          // whatsapp_conversations.last_message_at
  reengagedFor: Date | null;    // whatsapp_conversations.reengaged_for
  lastInboundAt: Date | null;   // messageStore.getLastInboundAt
  status: string;               // 'BOT' | 'HANDOVER' | ...
  now: Date;
}
function shouldReengage(input: ReengageInput): boolean;
```

Reglas (todas deben cumplirse), zona `America/Argentina/Buenos_Aires`:
1. `status === 'BOT'` (si está en HANDOVER lo maneja un humano → no tocar).
2. La hora local de `lastMessageAt` cae en la **noche**: `hora ∈ [22, 24) ∪ [0, 8)`.
3. La hora local de `now` es de **mañana**: `hora ≥ 9` (y `< 22`, para no disparar de madrugada/noche).
4. No hubo actividad desde entonces: lo garantiza usar `last_message_at` como ancla (si el contacto
   escribió, `last_message_at` avanzó y deja de matchear la noche anterior).
5. **Idempotencia:** `reengagedFor == null || reengagedFor.getTime() !== lastMessageAt.getTime()`.
6. **Ventana 24h:** `lastInboundAt != null && (now - lastInboundAt) <= 24h`.

Helpers auxiliares también puros y testeados:
- `horaLocal(date, tz): number` (0–23) — vía `Intl.DateTimeFormat` (mismo enfoque que `AvailabilityService`).
- `esNoche(hora)`, `esMañana(hora)`.

---

## 5. Servicio `NightReengageScheduler`

Mismo patrón que `NudgeScheduler` (`server/src/services/NudgeScheduler.ts`): clase con `start()/stop()`,
`setInterval`, guard `running`, inyección del `AccountManager`.

- **TICK:** cada 10 min (`TICK_MS = 10 * 60 * 1000`). El re-enganche no es urgente.
- **tick():**
  1. Levanta cuentas con `reengage_enabled = true` (`reengage_text` o el default constante).
  2. Para esas cuentas, busca `whatsapp_conversations` con `status='BOT'` y `last_message_at` en las últimas
     ~24h (descarta lo viejísimo): `select id, account_id, phone, status, last_message_at, reengaged_for`.
  3. Por cada una: `lastInbound = messageStore.getLastInboundAt(account_id, phone)`; arma `ReengageInput` y
     evalúa `shouldReengage`.
  4. Si sí y la cuenta está conectada (`manager.getStatus` ∈ WORKING/connected):
     `manager.sendMessage(account_id, phone, textoCuenta)` y `update whatsapp_conversations set
     reengaged_for = last_message_at where id = ...`. Best-effort, try/catch por contacto.
- **Texto:** `reengage_text` de la cuenta, o el default `'¡Buen día! ¿Seguimos con tu consulta de ayer? 🙂'`.
- **Bootstrap:** se instancia y `start()` donde hoy arranca `NudgeScheduler` (buscar `new NudgeScheduler` /
  `.start()` en el arranque del server).

---

## 6. Seguridad / cuidado

- Idempotente por `reengaged_for` → nunca spamea (máx 1 por episodio nocturno).
- Respeta 24h de WhatsApp (no manda fuera de ventana).
- Solo `status='BOT'` (no interfiere con conversaciones tomadas por humano).
- Opt-in por cuenta (`reengage_enabled`), default OFF.
- Best-effort: un error en un contacto no corta el tick; el tick no se solapa (`running`).

---

## 7. Componentes y límites

| Unidad | Qué hace | Depende de |
|--------|----------|-----------|
| `migrations/0028_reengage.sql` | columnas opt-in + idempotencia | — |
| `services/reengage/shouldReengage.ts` | decisión pura + helpers de hora | Intl |
| `services/NightReengageScheduler.ts` | tick: busca, evalúa, manda, marca | supabase, messageStore, AccountManager |
| bootstrap del server (edit) | `start()` del scheduler | NightReengageScheduler |

---

## 8. Testing

- **`shouldReengage`** (TDD, relojes fijos): noche→mañana dispara; madrugada NO; ya re-enganchado NO;
  fuera de 24h NO; HANDOVER NO; contacto que volvió a escribir (last_message_at de hoy) NO.
- **`horaLocal/esNoche/esMañana`**: bordes 21/22/08/09 en TZ AR.
- **`NightReengageScheduler.tick`** (supabase/messageStore/manager stub): manda y marca `reengaged_for`;
  no manda si desconectada; no repite.

---

## 9. Fuera de alcance

- Plantillas/HSM para reenganchar fuera de las 24h (requiere aprobación Meta).
- Re-enganche multi-día (insistir varios días). Solo 1 mensaje, a la mañana siguiente.
- Texto generado por IA (se eligió texto fijo configurable).
