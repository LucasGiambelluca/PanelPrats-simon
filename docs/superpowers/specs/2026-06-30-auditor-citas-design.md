# Agente auditor de citas — diseño

> Panel WhatsApp multi-cuenta (Node/Express/TS + Supabase + Redis). Estudio previsional Prats y Simón.
> Fecha: 2026-06-30. Enfoque aprobado: **A (LLM-juez + grounding determinístico)**.

## 1. Problema

Las citas de la agenda se cargan desde dos caminos: el agente IA (agendado determinístico + ficha gpt-4o) y carga manual de la empleada. Algunos datos pueden quedar mal respecto de lo que el cliente realmente dijo en el chat:

- En **Facebook/Instagram** el `phone` del contacto es el id de la red (PSID/IGSID), no un teléfono; aunque ya se pide el número en el agendado, una cita vieja o cargada a mano puede tener el id en vez del teléfono.
- El **nombre** puede estar incompleto o tomado de una muletilla.
- El **motivo/área** y la **calificación** pueden no reflejar lo conversado.
- La **fecha/hora/modalidad/oficina** pueden no coincidir con lo acordado.

Hace falta un auditor que, on-demand, compare cada cita contra su conversación y marque discrepancias para que una persona las corrija con un clic.

## 2. Objetivo y alcance

**Objetivo:** dado un conjunto de citas (las visibles en la Agenda: rango + cuenta), por cada una leer el chat asociado y verificar que estos campos coincidan con lo conversado, marcando discrepancias con una corrección sugerida que la empleada aplica con un botón.

**Campos auditados:**
1. **Teléfono de contacto** (`telefono`).
2. **Nombre** (`nombre`).
3. **Motivo/área + calificación** (`motivo` + calificación en `contact_memory.calificacion`).
4. **Fecha/hora + modalidad/oficina** (`start_time`/`end_time`, `oficina`).

**Fuera de alcance (YAGNI):** auto-corrección sin humano; ejecución programada (cron) o automática post-agendado; auditoría de campos no derivables del chat (DNI, carpeta, seguimiento, atendido_por); notificaciones. Se puede agregar después; el diseño no lo impide.

**Decisiones tomadas (brainstorming):**
- Acción ante discrepancia: **sugerir corrección, aplicar en 1 clic** (humano en el loop).
- Trigger: **botón "Auditar" on-demand en la Agenda**, sobre las citas visibles.
- Persistencia: **flag en la cita** (`audit_json` jsonb) + badge "⚠ revisar".

## 3. Arquitectura

Unidades con una sola responsabilidad, comunicadas por interfaces claras y testeables por separado.

### 3.1 `AppointmentAuditor` (núcleo puro)
`server/src/core/agent/context/AppointmentAuditor.ts`

Compara una cita contra su transcript. **No toca DB ni red**: recibe datos, devuelve el veredicto. Deps inyectadas (`ai.complete`, y los helpers determinísticos `validarTelefonoAR`, `detectArea`).

```ts
interface AuditInput {
  appointment: {
    nombre: string | null; telefono: string | null;
    start_time: string | null; end_time: string | null;
    oficina: string | null; motivo: string | null;
  };
  transcript: string;                 // conversación completa "Cliente: ... / Asistente: ..."
  channel: string;                    // whatsapp | facebook | instagram
  contactPhone: string;               // phone del contacto (id de canal en FB/IG)
  calificacionPrevia?: Record<string, any> | null; // contact_memory.calificacion
}

interface AuditField {
  campo: 'telefono' | 'nombre' | 'motivo' | 'fecha' | 'oficina';
  valor_cita: string | null;
  valor_chat: string | null;          // lo que surge del chat (null si el chat no lo dice)
  coincide: boolean;
  confianza: number;                  // 0..1
  sugerencia: string | null;          // valor propuesto para el campo (null si no se sugiere cambio)
  nota?: string;                      // explicación breve para la empleada
}

interface AuditResult {
  revisar: boolean;                   // true si hay ≥1 campo con coincide=false y confianza ≥ umbral
  campos: AuditField[];
  sin_chat: boolean;                  // true si no había conversación que auditar
  error?: string;                     // si falló la IA
}

class AppointmentAuditor {
  constructor(deps: { complete: (o: AICompletionOptions) => Promise<string> });
  async audit(input: AuditInput): Promise<AuditResult>;
}
```

**Lógica:**
1. Si `transcript` vacío → `{ sin_chat: true, revisar: false, campos: [] }`.
2. **Grounding determinístico** (antes del LLM, para anclar):
   - *Teléfono:* extrae números del transcript, normaliza con `validarTelefonoAR`. Si hay un número válido en el chat distinto de `appointment.telefono` (normalizado) → candidato a discrepancia. En FB/IG, si `appointment.telefono === contactPhone` (el id de canal) → discrepancia segura (sugerencia = el número del chat).
   - *Área:* `detectArea(transcript)` vs `appointment.motivo` (mapeo área→motivo). Mismatch fuerte → candidato.
3. **LLM-juez** (gpt-4o, `temperature: 0`, JSON mode, `maxTokens ~600`): prompt con la cita + transcript + los candidatos del grounding; devuelve el array `campos` con veredicto + confianza + sugerencia por campo. El prompt instruye: NUNCA inventar; si el chat no menciona un campo → `valor_chat: null, coincide: true` (no se puede contradecir lo que no se dijo); sugerir SOLO con evidencia explícita en el chat.
4. Cruza LLM + grounding: para teléfono y área, si el determinístico es seguro, prevalece su sugerencia (el LLM no puede bajar la confianza de un id-de-red mal puesto).
5. `revisar = campos.some(c => !c.coincide && c.confianza >= UMBRAL)` (umbral inicial 0.6).

### 3.2 Chat loader
`server/src/services/MessageStore.ts` (método nuevo) o helper en el route.

`getTranscript(accountId, phone): Promise<string>` — trae TODOS los `whatsapp_messages` de `(account_id, phone)` ordenados por `timestamp`, mapea `direction` → `Cliente`/`Asistente`, concatena. (El historial de runtime usa solo 12; la auditoría necesita la conversación completa.)

### 3.3 API
`server/src/api/routes/appointments.routes.ts` (extiende el router existente).

- `POST /api/appointments/audit` — body `{ account_id?, from?, to?, ids?: string[] }`. Resuelve las citas (mismo criterio que la lista de la Agenda; `ids` opcional para un subconjunto). Por cada una: carga transcript → corre `AppointmentAuditor` → persiste `audit_json` + `audit_at`. Devuelve `{ audited: n, flagged: m, results: [{id, revisar, campos}] }`. Acota a un máximo por corrida (p.ej. 50) y lo informa si trunca (no auditar miles en silencio).
- `POST /api/appointments/:id/audit/apply` — body `{ campo }`. Toma `audit_json.campos[campo].sugerencia`, valida (teléfono con `validarTelefonoAR`), aplica al campo real vía la lógica de update existente, y marca ese campo como resuelto en `audit_json`. Devuelve la cita actualizada.

Ambos `requireRole` acorde a la Agenda (admin/empleada con permiso de citas).

### 3.4 Migración
`supabase/migrations/0032_appointment_audit.sql` (idempotente):
```sql
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS audit_json jsonb,
  ADD COLUMN IF NOT EXISTS audit_at timestamptz;
```
El estado "revisar" se deriva de `audit_json.revisar` (no se agrega columna booleana aparte).

### 3.5 Frontend (Agenda)
`client/src/pages/Agenda.tsx` + `client/src/lib/api.ts`.

- Botón **"Auditar"** en la barra de la Agenda → `POST /audit` con el rango/cuenta activos → toast con resumen (`m de n para revisar`).
- Badge **"⚠ revisar"** en las citas con `audit_json?.revisar`.
- En el modal de la cita: sección **"Auditoría"** que lista los campos en conflicto: `valor en cita` vs `valor en chat` + confianza + nota, cada uno con botón **"Aplicar sugerencia"** → `POST /:id/audit/apply` → re-render.

## 4. Flujo de datos

```
[Empleada] → "Auditar" (rango+cuenta)
  → POST /api/appointments/audit
     por cada cita (máx 50):
       getTranscript(account_id, phone)        ── whatsapp_messages completos
       grounding: validarTelefonoAR + detectArea
       AppointmentAuditor.audit(...)           ── gpt-4o JSON
       persistir audit_json + audit_at         ── appointments
  ← { audited, flagged, results }
  → badge "⚠ revisar" en la grilla

[Empleada] abre cita flageada → ve discrepancias
  → "Aplicar sugerencia" (campo)
  → POST /api/appointments/:id/audit/apply { campo }
     valida + escribe el campo + marca resuelto en audit_json
  ← cita actualizada
```

## 5. Manejo de errores

- **Sin chat** para la cita → `sin_chat: true`, no flag, nota "no hay conversación para auditar".
- **IA falla** (sin saldo/timeout) → `error` en el resultado de esa cita, no flag; el resumen informa cuántas no se pudieron auditar.
- **Aplicar sugerencia inválida** (p.ej. teléfono que no pasa `validarTelefonoAR`) → 400 con motivo; no escribe.
- **Corrida grande** → tope (50) + aviso de truncado (no silenciar cobertura parcial).

## 6. Testing

- `AppointmentAuditor` con `ai.complete` mockeado:
  - cita correcta (todo coincide) → `revisar: false`.
  - FB/IG con `telefono === contactPhone` (id de red) y número real en el chat → discrepancia teléfono, sugerencia = número del chat.
  - motivo de la cita distinto al área detectada en el chat → discrepancia motivo.
  - chat no menciona un campo → `coincide: true` (no se contradice lo no dicho).
  - sin transcript → `sin_chat: true`.
- Grounding determinístico (teléfono/área) con casos reales (números AR, "me chocaron", "jubilación").
- Route: persiste `audit_json`; apply valida y escribe; apply de teléfono inválido → 400.

## 7. Archivos afectados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/0032_appointment_audit.sql` | nuevo: `audit_json`, `audit_at` |
| `server/src/core/agent/context/AppointmentAuditor.ts` | nuevo: núcleo puro |
| `server/src/core/agent/context/__tests__/AppointmentAuditor.test.ts` | nuevo: tests |
| `server/src/services/MessageStore.ts` | `getTranscript()` |
| `server/src/api/routes/appointments.routes.ts` | `POST /audit`, `POST /:id/audit/apply` |
| `server/src/services/AppointmentService.ts` | helpers si hace falta (persistir audit_json, marcar resuelto) |
| `client/src/lib/api.ts` | `auditAppointments`, `applyAuditFix` |
| `client/src/pages/Agenda.tsx` | botón Auditar + badge + sección de auditoría en el modal |

## 8. Riesgos / notas

- **Costo LLM:** una llamada gpt-4o por cita auditada. Mitigado por on-demand + tope por corrida.
- **Fecha/hora poco confiable desde el chat** ("el martes a las 10" es ambiguo): el auditor solo flaggea fecha con discrepancia fuerte y alta confianza; default a no-flag ante duda.
- **Re-auditar** una cita pisa su `audit_json` (último resultado gana); las correcciones ya aplicadas quedan reflejadas porque el campo real ya cambió.
- Migración 0032 sigue la convención idempotente del repo (`IF NOT EXISTS`).
