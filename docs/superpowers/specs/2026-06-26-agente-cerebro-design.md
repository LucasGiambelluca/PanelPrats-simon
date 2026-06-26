# Apartado "Agente" — Cerebro editable + config-agent conversacional

**Fecha:** 2026-06-26
**Estado:** Diseño aprobado, listo para plan de implementación
**Alcance:** Página admin-only para leer/editar el "cerebro" del agente de atención y modificarlo
conversacionalmente. NO incluye features de runtime (retomar-de-noche, validar-teléfono → specs aparte).

---

## 1. Problema y objetivo

Hoy el contexto de atención del agente (tono, datos del estudio, FAQs, zonas) se edita a mano,
disperso, y los "flujos" son nodos rígidos en el bot-builder. El admin quiere un solo lugar donde:

1. **Ver y editar** todo el "cerebro" del agente en lenguaje claro.
2. **Chatear** con un config-agent que ejecuta órdenes agénticamente ("sé más cálido con los mayores",
   "agregá que la consulta sale $29.000", "Lanús atiende en Quilmes") proponiendo el cambio antes de aplicarlo.
3. Que los **flujos pasen a ser instrucciones** en lenguaje natural (un campo "procedimientos") en vez de
   nodos rígidos: el runtime IA-primero las sigue, apoyándose en la memoria/continuidad ya construida.

**Objetivo:** atención más natural y de menor fricción, configurable por el admin sin tocar código ni nodos.

---

## 2. Decisiones tomadas (brainstorming)

- **Qué edita el cerebro:** tono + datos + procedimientos + FAQs + zonas. NO agenda/oficinas/horarios.
- **Cómo aplica:** propone el cambio (diff) → el admin confirma (`Aplicar` / `Descartar`). Nada toca la
  config viva hasta confirmar.
- **Alcance de aplicación:** **todas las líneas del estudio a la vez** (fan-out a todas las cuentas) → un
  empleado consistente en WhatsApp/FB/IG.
- **Motor:** config-agent con tools (mismo patrón que el agente de WhatsApp: las tools generan "cambios
  propuestos", no escriben).
- **Visible + editable a mano:** la página no es solo chat; muestra el cerebro completo en cards editables.
- **Decomposición:** retomar-de-noche y validar-teléfono son specs/builds aparte.

---

## 3. El "cerebro": modelo de datos

Cinco partes. Tres viven en columnas de `accounts` (una nueva), dos en tablas existentes.

| Parte | Almacenamiento | Estado |
|-------|----------------|--------|
| **Tono** | `accounts.agent_persona` | existe |
| **Datos del estudio** | `accounts.business_context` | existe |
| **Procedimientos** (flujos→instrucciones) | `accounts.agent_procedures` | **NUEVO — migración** |
| **FAQs** | `account_faqs (pregunta, respuesta, tags)` | existe |
| **Zonas** | `zone_gazetteer (alias, alias_norm, oficina)` | existe |

### Migración `0027_agent_procedures.sql` (idempotente)
```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_procedures text;
```

### Consistencia "todas las líneas"
Como persona/business_context/procedures/FAQs/zonas son **por cuenta**, "todas las líneas" se implementa
como **fan-out**: cada cambio se escribe en TODAS las cuentas del estudio. El runtime NO cambia (sigue
leyendo por cuenta; ahora todas tienen lo mismo). El `GET /state` lee de una cuenta de referencia (la
primera del estudio) asumiendo que el fan-out las mantiene idénticas.

---

## 4. Cambio en el runtime (flujos → instrucciones)

`agent_procedures` se inyecta en el system prompt del agente IA-primero, como guía de cómo proceder.

- `createAgentRuntime.loadAccount()` → agrega `agent_procedures` al select y al objeto de cuenta.
- `AgentPersona.buildPersona()` → si hay `agentProcedures`, agrega un bloque:
  `PROCEDIMIENTOS (seguí estas instrucciones del estudio):\n{procedimientos}`.
- La memoria/continuidad (Cap 1, ya construida) hace que no repita ni reinicie: el contacto que vuelve se
  retoma, el hilo abierto sigue.

Este es el único toque al runtime. El resto del spec es la página + el config-agent.

---

## 5. Backend: router `/api/agente` (admin-only)

Montado detrás de `requireRole('admin')` en `app.ts` (mismo patrón que team/analytics).

### `GET /api/agente/state`
Devuelve el snapshot del cerebro para mostrar y diffear:
```ts
{
  tono: string | null;
  datos: string | null;
  procedimientos: string | null;
  faqs: Array<{ id: string; pregunta: string; respuesta: string; tags: string[] }>;
  zonas: Array<{ id: string; alias: string; oficina: string }>;
  lineas: number; // cuántas cuentas del estudio (para "Aplicar a las N líneas")
}
```
Lee de la cuenta de referencia del estudio (las cuentas se resuelven por el `user_id` del admin, igual
que `accountsApi.list`).

### `POST /api/agente/chat`
```ts
// body: { messages: Array<{ role:'user'|'assistant'; content:string }> }
// resp: { reply: string; pendingChanges: Change[] }
```
Corre el `ConfigAgent` (gpt-4o + `ConfigToolRegistry`) con el state actual inyectado en el system prompt
(para que pueda referenciar/editar FAQs y zonas por su contenido). Las tools NO escriben: devuelven
`Change[]`. El backend NO aplica nada acá.

### `POST /api/agente/apply`
```ts
// body: { changes: Change[] }
// resp: { applied: number; results: Array<{ change: Change; ok: boolean; error?: string }> }
```
Aplica cada cambio **fan-out a todas las cuentas del estudio**, validando e idempotente. Sirve tanto para
los cambios confirmados del chat como para la edición manual de las cards (el front arma los `Change`).

### Tipo `Change`
```ts
type Change =
  | { type: 'set_tono';          texto: string }
  | { type: 'set_datos';         texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'set_procedimientos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'add_faq';           pregunta: string; respuesta: string; tags?: string[] }
  | { type: 'edit_faq';          pregunta: string; nueva_respuesta?: string; nueva_pregunta?: string; tags?: string[] }
  | { type: 'remove_faq';        pregunta: string }
  | { type: 'add_zona';          localidad: string; oficina: 'CABA' | 'Quilmes' | 'Haedo' }
  | { type: 'remove_zona';       localidad: string };
```

### Semántica de `apply` (por tipo, fan-out a cada cuenta `acc`)
- `set_tono` → `accounts.agent_persona = texto` en cada `acc`.
- `set_datos` / `set_procedimientos` → setea (reemplazar) o concatena (agregar) la columna en cada `acc`.
- `add_faq` → upsert en `account_faqs` de cada `acc` matcheando por `pregunta` (no duplica).
- `edit_faq` → matchea por `pregunta` en cada `acc` y actualiza respuesta/pregunta/tags.
- `remove_faq` → borra por `pregunta` en cada `acc`.
- `add_zona` → upsert en `zone_gazetteer` de cada `acc` por `(account_id, alias_norm)` (normaliza la
  localidad con la misma `norm()` del proyecto).
- `remove_zona` → borra por `alias_norm` en cada `acc`.

Todo idempotente y scoped a las cuentas del estudio (nunca toca cuentas de otros usuarios).

---

## 6. Config-agent (motor)

- **LLM:** `AIService.completeWithTools` con `model: 'gpt-4o'` (calidad de comprensión de órdenes).
- **`ConfigToolRegistry`** (espejo del `ToolRegistry` del booking): cada tool valida los args y devuelve un
  `Change` (no escribe). Tools: `set_tono`, `set_datos`, `set_procedimientos`, `add_faq`, `edit_faq`,
  `remove_faq`, `add_zona`, `remove_zona`.
- **System prompt del config-agent:** rol ("sos el asistente de configuración del estudio"), el state
  actual del cerebro (tono/datos/procedimientos/FAQs con texto/zonas), y la regla: "para cada pedido,
  llamá la/las tools correspondientes con el cambio propuesto; NO confirmes vos, el admin confirma".
- **Sin escritura en `/chat`:** el agente solo propone. La escritura ocurre en `/apply` tras confirmar.
- **Multi-turno:** el front manda el historial completo en cada `/chat` (stateless en backend).

---

## 7. Frontend: página `/agente`

- Ruta admin-only en `App.tsx` (dentro del bloque `<RoleRoute role="admin">`), lazy-loaded, + ítem en el
  nav de `Layout`.
- **`agenteApi`** en `lib/api.ts`: `state()`, `chat(messages)`, `apply(changes)`.
- **Layout dos columnas:**
  - **Izquierda — "Cerebro":** cards de Tono, Datos, Procedimientos (textarea), FAQs (lista con editar/
    borrar/agregar), Zonas (lista con agregar/borrar). Editar a mano arma `Change[]` y llama `apply`.
  - **Derecha — Chat:** historial de mensajes, input, y la **animación del bot (mp4)** en el estado idle
    ("Listo para mejorar la atención"); **imagen** como avatar/hero. Al responder con `pendingChanges`,
    muestra la **tarjeta de cambios**: lista numerada con diff (antes → después) + `[Aplicar a las N
    líneas]` / `[Descartar]`. Aplicar llama `apply` y refresca el cerebro.
- **Recursos:** mover `recursos/vien_crea_un_video_corto_donde.mp4` y
  `recursos/Gemini_Generated_Image_*.png` a `client/public/agente/` (renombrados, ej `bot-ok.mp4`,
  `bot-avatar.png`).
- Estilo: paleta de marca existente (navy/dorado), consistente con el resto del panel.

---

## 8. Seguridad

- Admin-only **server-side** (`requireRole('admin')`), no solo en el front.
- Tools whitelisteadas: el config-agent no puede ejecutar nada fuera de los `Change` tipados (sin SQL
  arbitrario). `apply` valida `type` y rechaza lo desconocido.
- `add_zona.oficina` validado contra `{CABA, Quilmes, Haedo}`. `edit/remove_faq` y `remove_zona` operan
  solo por match exacto del contenido (no borran de más).
- Fan-out scoped a las cuentas del estudio del admin (por `user_id`), nunca cross-tenant.
- Usa `OPENAI_API_KEY` del server.

---

## 9. Testing

DI + stubs, mismo estilo que el resto del proyecto.

- **`ConfigToolRegistry`**: cada orden/tool → genera el `Change` correcto; valida args (oficina inválida,
  faq sin respuesta, etc.).
- **`applyChanges`** (con supabase stub): fan-out a N cuentas; idempotencia (add_faq/add_zona no duplican);
  set vs agregar en datos/procedimientos; validación de tipo desconocido; scope por estudio.
- **`AgentPersona`**: inyecta el bloque de procedimientos cuando hay `agentProcedures`.
- **Diff**: cómputo antes→después por tipo de cambio (para la tarjeta).
- Smoke conversacional opcional (con key) como en el booking, NO en la suite.

---

## 10. Componentes y límites (para el plan)

| Unidad | Qué hace | Depende de |
|--------|----------|-----------|
| `migrations/0027_agent_procedures.sql` | agrega la columna | — |
| `AgentPersona` (edit) | inyecta procedimientos al prompt | account.agentProcedures |
| `createAgentRuntime.loadAccount` (edit) | selecciona agent_procedures | supabase |
| `core/agent/config/ConfigToolRegistry.ts` | orden → Change[] | tipos Change |
| `core/agent/config/applyChanges.ts` | aplica Change[] fan-out | supabase, norm() |
| `core/agent/config/ConfigAgent.ts` | LLM + tools + state en prompt | AIService, ConfigToolRegistry |
| `api/routes/agente.routes.ts` | GET state / POST chat / POST apply | requireRole, lo de arriba |
| `client/src/pages/Agente.tsx` | página cerebro + chat | agenteApi |
| `client/src/lib/api.ts` (`agenteApi`) | state/chat/apply | api() |
| `client/public/agente/*` | media (mp4, png) | — |

---

## 11. Fuera de alcance (specs de seguimiento)

1. **Retomar-de-noche:** detectar que el contacto dejó de responder de noche (asumir descanso) y reintentar
   al día siguiente. Extiende `NudgeScheduler`. Ventana horaria + idempotencia de re-engagement.
2. **Validar-teléfono por código de área:** discernir si un número es válido por su conformación (código de
   área AR válido). Utilidad usada al capturar teléfono (booking/notify).

Cada uno con su propio spec → plan → build.
