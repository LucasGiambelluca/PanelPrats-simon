# Refinamiento "Pendientes de llamar"

**Fecha:** 2026-07-03
**Branch:** feat-omnichannel
**Estado:** aprobado, listo para plan de implementación

## Problema

El apartado `/pendientes-llamar` (planilla de contactos truncos con teléfono) tiene tres carencias:

1. No hay forma de saltar a la conversación desde una fila.
2. Datos sucios: en filas de Facebook/Instagram, la columna **Nombre** muestra el PSID (id de conversación de FB) en vez del nombre real. Si la persona dejó su teléfono en el chat, casi siempre dejó también su nombre — hay que resolverlo.
3. No existe estado "llamado / no llamado". El equipo no puede marcar a quién ya contactó, así que reescriben o pierden el hilo.

## Contexto del código actual

- **Endpoint:** `GET /api/pendientes-llamar` — `server/src/api/routes/pendientes.routes.ts:50`, montado en `app.ts:87` con `authContext`.
- **Núcleo puro:** `server/src/core/callsheet/PendienteEvaluator.ts` — decide inclusión y arma `FilaPendiente`.
- **Regla de inclusión:** sin `opt_out`, con teléfono LLAMABLE, sin cita coordinada. FB/IG sólo entran si hay teléfono real en `contact_memory` (`resolveCallablePhone`, `PendienteEvaluator.ts:69-82`). ⇒ **la columna teléfono ya es siempre real y limpia.**
- **Fuga del id de FB:** `nombre = strOrNull(conversation.contact_name) ?? slots.nombre` (`PendienteEvaluator.ts:109`). Para FB/IG, `contact_name` guarda el PSID.
- **Dedup:** por teléfono real normalizado (`pendientes.routes.ts:38`), gana la conversación más reciente.
- **Frontend:** página `client/src/pages/PendientesLlamar.tsx`, wrapper `client/src/lib/api.ts:468-492` (`pendientesApi`, `FilaPendiente`, `PendientesResponse`).
- **Inbox:** ruta `/inbox` (`client/src/App.tsx:65`), deep-link actual por `account+phone` (`WhatsAppInbox.tsx:181-204`). Matchea contra `whatsapp_conversations.phone`, que para FB/IG es el PSID ⇒ el deep-link por teléfono NO sirve para FB/IG.
- **Última migración:** `0034_appointment_intake_fields.sql`.

## Diseño

### A. Estado "llamado" (persistencia nueva)

**Migración `0035_contactos_llamados.sql`:**

```sql
CREATE TABLE IF NOT EXISTS contactos_llamados (
  account_id  text        NOT NULL,
  telefono    text        NOT NULL,          -- teléfono real normalizado (misma clave que el dedup)
  llamado_at  timestamptz NOT NULL DEFAULT now(),
  llamado_por text,                          -- usuario del authContext que marcó
  PRIMARY KEY (account_id, telefono)
);
```

Decisión clave: el estado se guarda **por (account_id, teléfono)**, no por `conversation_id`. Razón: el objetivo es "no volver a escribirle a esta persona"; una persona puede tener varias conversaciones/canales con el mismo número. Clavar por teléfono hace que el marcado cruce conversaciones y sobreviva a cambios de dedup. La presencia de fila = llamado; su ausencia = no llamado (no hace falta columna booleana).

**Endpoint `POST /api/pendientes-llamar/marcar`:**
- Body: `{ account_id: string, telefono: string, llamado: boolean }`.
- `llamado === true` → `INSERT ... ON CONFLICT (account_id, telefono) DO UPDATE SET llamado_at = now(), llamado_por = <user>`.
- `llamado === false` → `DELETE WHERE account_id = $1 AND telefono = $2` (deshace, reversible).
- `llamado_por` sale del `authContext` (mismo mecanismo que el resto de rutas).
- Valida `account_id` y `telefono` presentes; 400 si faltan.

**List endpoint (`pendientes.routes.ts`):**
- Traer `contactos_llamados` del/los `account_id` (misma paginación `fetchAll`) a un `Map` por `account_id|telefono`.
- Al armar cada `FilaPendiente`, adjuntar `llamado: boolean` + `llamado_at: string | null` + `llamado_por: string | null`.
- Esto se hace en la capa de ruta (I/O), no en el núcleo puro `PendienteEvaluator` — el evaluador sigue sin DB.

### B. Datos limpios (todos los canales)

En `PendienteEvaluator.ts`, mejorar la resolución de nombre:

- Nueva función `nombreLimpio(conversation, contact)`:
  - Cascada: `contact_name` → `dialogue_state.slots.nombre.valor` → `calificacion[*].datos.nombre` → `current_thread.datos_parciales.nombre`.
  - **Filtro anti-PSID:** descarta cualquier candidato que sea puramente numérico y largo (heurística: `/^\d{11,}$/`, ya que un nombre real nunca es sólo dígitos). Así el PSID de FB nunca pasa como nombre.
  - Devuelve `null` si ningún candidato es un nombre real.
- `FilaPendiente.nombre` usa `nombreLimpio`.
- UI: cuando `nombre` es `null`, mostrar "Sin nombre" en gris (no el teléfono, no el id).

Teléfono no cambia (ya es siempre real).

### C. "Ir al chat"

- Botón por fila → navega a `/inbox?conv=<conversation_id>`.
- Se usa `conversation_id` (uuid), no el teléfono, porque para FB/IG el `phone` guardado es el PSID y el match por teléfono fallaría.
- `WhatsAppInbox.tsx`: extender el deep-link para aceptar `?conv=<id>` y seleccionar la conversación cuyo `c.id === conv`. Mantener el fallback actual `account+phone` intacto para los deep-links de la Agenda.

### D. UI Pendientes (`PendientesLlamar.tsx`)

- **Columna nueva "Acciones"** al final de cada fila:
  - `[Ir al chat]` → link a `/inbox?conv=<conversation_id>`.
  - Toggle llamado: `[☎ Marcar llamado]` cuando `!llamado`; `[✓ Llamado]` cuando `llamado`. Al clickear llama a `pendientesApi.marcar(...)` y actualiza el estado local (optimista; revertir si falla).
- **Filtro "Ocultar llamados"** (checkbox, default ON): oculta las filas con `llamado === true`. Al desactivarlo, las filas llamadas se muestran atenuadas + badge ✓ con tooltip de `llamado_at` / `llamado_por`.
- **CSV export:** agregar columna "Llamado" (`sí (fecha)` / `no`).
- Cliente (`api.ts`): agregar campos `llamado`, `llamado_at`, `llamado_por` a `FilaPendiente`; agregar `pendientesApi.marcar({ accountId, telefono, llamado })`.

## Fuera de alcance

- RBAC / acceso por rol: sin cambios (el usuario pidió "todos los canales", no roles). El acceso queda como está (`authContext`).
- No se toca la regla de inclusión ni el dedup.

## Testing

- **`PendienteEvaluator` (puro, unit):**
  - `nombreLimpio` rechaza PSID numérico largo.
  - Cascada de fallback de nombre (contact_name → slots → calificacion → thread).
  - Devuelve `null` cuando no hay nombre real.
- **Endpoint `marcar`:** upsert marca, `llamado:false` borra, faltan campos → 400.
- **List endpoint:** filas traen `llamado` correcto según la tabla.
- **Migración 0035** aplicada en Supabase antes de considerar hecho.

## Criterio de "hecho"

1. Migración 0035 aplicada.
2. Filas FB/IG muestran nombre real o "Sin nombre" — nunca PSID.
3. "Ir al chat" abre la conversación correcta también en FB/IG.
4. Marcar/desmarcar llamado persiste y el filtro "Ocultar llamados" funciona.
5. Tests verdes.
