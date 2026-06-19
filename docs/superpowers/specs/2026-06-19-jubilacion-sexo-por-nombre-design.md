# Jubilación: inferir sexo por el nombre — diseño

Fecha: 2026-06-19
Estado: aprobado (pendiente review de spec)

## Objetivo

En el embudo de jubilaciones, en vez de preguntar explícitamente el género, pedir el **nombre** del consultante y **inferir el sexo con IA** para rutear automáticamente al sub-flujo correcto (Jubilación Mujer / Jubilación Hombre), que difieren en edad jubilatoria (mujer 60 / hombre 65) y reglas.

Decisiones tomadas:
- Inferencia por **IA** (nodo `intentResolverNode`), reusando la API key de la cuenta.
- **Confiar** en la inferencia cuando la IA está segura (sin paso de confirmación). Solo cuando el nombre es ambiguo se cae a un poll explícito de respaldo.
- El camino genérico ("Agendamiento Jubilaciones", trigger `jubilacion` / "Router Consultas") **NO cambia**.

## Contexto (estado actual)

- El flujo afectado es **"Router de Entrada (detecta motivo)"** (id `88604794-895c-4047-80fb-27aa7dbd6f52`).
- Hoy: `menu(option-0)` (jubilación) → nodo poll `genero` ("¿es para un hombre o una mujer?") → `option-0`→`link_jubh` (Jubilación Hombre `bf5a2ebb…`), `option-1`→`link_jubm` (Jubilación Mujer `d5abf056…`).
- Los sub-flujos Jubilación Mujer/Hombre piden nacionalidad/edad/etc. por su cuenta; no usan el nombre.
- Nodo disponible: `intentResolverNode` (`IntentResolverExecutor`): hace una pregunta, clasifica la respuesta del usuario en `possible_intents` vía LLM (temp 0.2, maxTokens 10), guarda el resultado en `output_variable`, resuelve la API key del nodo o de la config IA de la cuenta, y maneja reintentos/fallback. El texto tipeado queda en `raw_user_message`.
- `switchNode` (`SwitchExecutor`): ramifica por valor exacto (lowercased/trim) de una variable; `cases: [{value, handle}]` + `default_handle`.

## Cambios en el flujo (solo data del flow `88604794`)

Se modifican `nodes` y `edges` del flujo. No hay cambios de código.

### Nodos
1. **Nuevo `intentResolverNode` id `q_nombre_sexo`**:
   - `question`: "Perfecto 👍 ¿A nombre de quién hacemos la consulta? (nombre y apellido)"
   - `possible_intents`: "mujer,hombre"
   - `output_variable`: "sexo"
   - `system_prompt`: "Sos un clasificador. Te dan el NOMBRE de una persona (Argentina). Devolvé SOLO 'mujer' u 'hombre' según el sexo más probable del nombre de pila. Si el nombre es unisex, ilegible o no es un nombre, devolvé 'no_entendido'. Sin texto extra."
   - `user_prompt`: 'Nombre: "{{input}}". Devolvé solo: mujer, hombre o no_entendido.'
   - `max_retries`: 1
2. **Nuevo `switchNode` id `sw_sexo`**:
   - `variable`: "sexo"
   - `cases`: `[{ "value": "mujer", "handle": "h_mujer" }, { "value": "hombre", "handle": "h_hombre" }]`
   - `default_handle`: "h_amb"
3. **Se conserva** el nodo poll `genero` como **fallback** (ambiguo), con sus links existentes.

### Edges
- Quitar: `menu(option-0) -> genero` (se reemplaza el destino).
- Agregar:
  - `menu(option-0) -> q_nombre_sexo`
  - `q_nombre_sexo -> sw_sexo`
  - `sw_sexo(h_mujer) -> link_jubm`
  - `sw_sexo(h_hombre) -> link_jubh`
  - `sw_sexo(h_amb) -> genero`  (poll de respaldo)
- Se conservan: `genero(option-0) -> link_jubh`, `genero(option-1) -> link_jubm`, y todo el resto del router (pension/laboral/art/transito/derivar) sin cambios.

## Comportamiento esperado

- Usuario elige "jubilación" → se le pide el nombre.
- Nombre claro (ej. "María", "Juan") → IA setea `sexo` → switch rutea directo al sub-flujo (sin preguntar el género). ✔ cumple "ya sabemos".
- Nombre ambiguo / ilegible (ej. "Cruz", typo, solo apellido) → IA devuelve `no_entendido` → tras `max_retries` el resolver avanza con un valor no matcheable → switch `default` → poll `genero` explícito → ruteo manual. ✔ sin misgender.
- El nombre tipeado queda en `raw_user_message` (disponible aguas abajo; el agendamiento pide el nombre como hoy, sin regresión).

## Riesgos / mitigaciones

- **Misgender (~2%)**: mitigado por el fallback a poll en ambiguos; el sub-flujo igual valida edad/nacionalidad, no decide solo por sexo.
- **IA sin saldo/*error***: el resolver, ante error, setea la variable a 'error' → switch `default` → poll explícito (degradación elegante).
- **Costo/latencia**: 1 llamada LLM corta (maxTokens 10) solo en el camino jubilación.

## Testing / verificación

- No hay tests unitarios de flows (son data). Verificación manual end-to-end:
  - Nombre claramente femenino → entra a Jubilación Mujer sin preguntar género.
  - Nombre claramente masculino → Jubilación Hombre.
  - Nombre ambiguo → aparece el poll de género.
- Smoke del backend: `intentResolverNode` ya está registrado en `NodeExecutorFactory`; no cambia código.

## Out of scope

- El embudo genérico "Agendamiento Jubilaciones" (sin split por sexo) queda igual.
- Guardar el nombre como variable `nombre` formal (hoy queda en `raw_user_message`; el agendamiento lo recolecta por su cuenta).

## Cómo se aplica

Es un cambio de **datos del flow** (no código). Se aplica actualizando `nodes`/`edges` del flow `88604794` en Supabase (vía un script con service key o el endpoint `PUT /api/flows/:id`). Reversible: re-guardar el flow anterior.
