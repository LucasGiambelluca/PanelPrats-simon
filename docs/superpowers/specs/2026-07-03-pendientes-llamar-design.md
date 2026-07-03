# Apartado "Pendientes de llamar" — Diseño

**Fecha:** 2026-07-03
**Estado:** aprobado (diseño) — pendiente review del spec por el usuario.

## Objetivo

Dar al estudio una **planilla de llamados**: todos los contactos cuya conversación quedó **trunca** (nunca llegaron a coordinar la reunión) y de los que **tenemos un teléfono llamable**, con sus datos, para hacer el llamado telefónico de recupero. Debe cargarse con **TODAS** las conversaciones truncas del histórico que cumplan la regla — sin muestreo, sin tope artificial, computado en vivo sobre la base.

## Regla de elegibilidad (un contacto entra si TODAS se cumplen)

1. **No tiene cita coordinada.** No existe fila en `appointments` cuyo `phone` o `telefono` resuelva al teléfono del contacto. (Nunca coordinó reunión = conversación trunca.)
2. **No pidió no ser contactado.** `contact_memory.opt_out = false`.
3. **Tiene teléfono llamable:**
   - **WhatsApp** (`whatsapp_conversations.channel = 'whatsapp'`): el `phone` de la conversación ya es un teléfono real → llamable.
   - **Facebook / Instagram** (`channel in ('facebook','instagram')`): el `phone` es el PSID (no llamable). Entra **solo si** el cliente pasó un teléfono real en el chat, capturado en `contact_memory.dialogue_state.slots.telefono.valor` o `contact_memory.calificacion.<area>.datos.telefono` o `current_thread.datos_parciales.telefono`, y ese número **valida como teléfono AR** (`PhoneUtils` / `validarTelefonoAR`). Sin teléfono real → NO entra.

Nota: "trunca" NO exige que la conversación esté abierta. Un contacto que cerró con despedida cordial pero nunca agendó igual entra (no coordinó reunión). Los `opt_out` son la única exclusión por intención del cliente.

## Columnas de la planilla / tabla

| Columna | Origen |
|---|---|
| Teléfono (llamable, normalizado AR) | phone (WA) o slot telefono (FB/IG), vía `PhoneUtils` |
| Nombre | `whatsapp_conversations.contact_name` ?? slot `nombre` |
| Canal | `channel` (WhatsApp / Facebook / Instagram) |
| Área | `dialogue_state.area` (AreaKey legible) |
| Calificación | `calificacion.<area>.resultado` (gratis / pago / a_confirmar) ?? — |
| Último mensaje | `last_message` |
| Fecha último contacto | `last_message_at` ?? `last_interaction_at` |
| Estado conversación | abierta (BOT/HANDOVER) o cerrada + `close_reason` |
| Último tema / resumen | `last_topic` ?? `current_thread.tema` |
| Link al chat | id de la conversación → ruta del inbox |

## Arquitectura

### Núcleo testeable (puro, sin DB) — TDD
`server/src/core/callsheet/PendienteEvaluator.ts`
```
evaluarPendiente(input: {
  conversation: ConversationRow;         // whatsapp_conversations
  contact: ContactMemoryRow | null;      // contact_memory (dialogue_state, calificacion, current_thread, opt_out, ...)
  phonesConCita: Set<string>;            // teléfonos normalizados que YA tienen appointment
}): FilaPendiente | null
```
- Devuelve `null` si el contacto NO es elegible (tiene cita, opt_out, o sin teléfono llamable).
- Devuelve la `FilaPendiente` (todas las columnas de arriba) si entra.
- Resuelve el teléfono llamable por canal + normaliza AR + lo usa para el chequeo de `phonesConCita`.
- Es la unidad con toda la lógica de negocio → cubierta por tests unitarios sin tocar la base.

### Backend — endpoint
`server/src/api/routes/pendientes.routes.ts` → `GET /api/pendientes-llamar?account_id=all|<id>&range=all|7d|30d|90d`
1. Trae **todas** las conversaciones del/los account(s) — paginado si supera el límite de Supabase (traer en bloques hasta agotar; NO cortar en 500 como el inbox).
2. Trae `appointments` (phone + telefono) → arma `Set` de teléfonos normalizados con cita.
3. Trae `contact_memory` de esas conversaciones (por account+phone).
4. Aplica `evaluarPendiente` a cada una; junta las `FilaPendiente` no-nulas.
5. **Dedup** por teléfono llamable resuelto (arrastra el fix @lid conocido: dos convos que resuelven al mismo número → una fila).
6. Filtro `range` opcional sobre fecha de último contacto.
7. Devuelve `{ total, filas }` JSON.

Montado en `app.ts` junto al resto de routers, con el mismo middleware de auth/RBAC (admin + empleadas, que son quienes llaman).

### Frontend — página
`client/src/pages/PendientesLlamar.tsx` + ruta en `App.tsx` + link en `Layout.tsx` (sidebar).
- Tabla con las columnas de arriba, ordenada por fecha de último contacto desc.
- Filtros: rango temporal (default: todo), canal, calificación.
- Botón **Exportar CSV**: arma el CSV en el cliente desde las filas ya traídas (nombres de columna en español, teléfono como texto para no perder el 0/15). Abre en Excel/Google Sheets.
- RBAC: visible para admin y empleadas.
- Estilo: reusar el patrón de tabla/tema de `Agenda.tsx`.

## Fuera de scope v1 (posible fase 2)

- **"Marcar como llamado" / gestión** (estado por contacto, quién llamó, resultado). Por ahora la empleada anota sobre el CSV exportado.
- **Excel .xlsx nativo** (CSV alcanza; evita dependencia SheetJS — YAGNI).
- **Paginación server-side de la UI** (prod ~500-1000 convos; entran en memoria y en la tabla con scroll).

## Testing

- Unitarios de `evaluarPendiente`: WhatsApp con/ sin cita; FB/IG con teléfono real → entra; FB/IG sin teléfono real → null; opt_out → null; con cita (match por phone y por telefono) → null; normalización AR; armado de todas las columnas.
- Backend: smoke del endpoint (mock supabase) — paginado agota todas las páginas, dedup por teléfono.
- Frontend: `tsc --noEmit` limpio; export CSV genera el formato esperado.

## Decisiones tomadas

1. Formato: **página en el panel + Exportar CSV**.
2. Criterio: **sin cita, excluyendo opt-out** (incluye cerradas por despedida).
3. FB/IG: **solo con teléfono real capturado** (PSID no es llamable).
4. Ventana: **filtro configurable en la UI**, default **todo el histórico**.
5. Carga: **todas** las conversaciones truncas que cumplan, en vivo (sin tope de 500 como el inbox).
