# Anti-loop de calificación + menos fricción — Diseño

> Reduce la fricción del agente y elimina el loop donde el bot repite el mismo dato de calificación N veces cuando el cliente divaga o no entiende. Approach A: guard determinístico que cuenta "tema preguntado" y enjaula al LLM con una directiva de escalación, manteniendo su capacidad de leer mensajes desordenados.

**Fecha:** 2026-07-03
**Estado:** aprobado (brainstorming), listo para plan.

---

## Problema (evidencia de simulación, 2026-07-03)

Replay de conversaciones reales que no agendaron, a través del agente nuevo (post fixes 1-5). Con el rate-limit corregido (FALLBACK 2%), el patrón claro:

- El bot **repite el mismo dato de calificación** con fraseo variado cuando el cliente contesta otra cosa. Ej real (Laferrere, zona de cobertura):
  ```
  B: ¿cuántos años de aportes tiene?     U: La Ferrere
  B: necesito saber cuántos años de aportes   U: Zona ESTE
  B: cuántos años de aportes...          U: 14'40
  ... (×6)
  ```
  El cliente de cobertura **nunca llegó al paso de zona → nunca vio la oferta presencial** porque murió en la calificación.
- El **anti-echo (LoopGuard) no lo caza** porque el LLM varía el fraseo (no son strings idénticos).
- Fricción secundaria: el paso de elegir horario a veces no matchea `"Viernes 14 10"` / `"mañana 15 y 30"` y repite las opciones.

**Decisiones del estudio (confirmadas en brainstorming):**
1. Ante un dato de calificación que el cliente no da tras 2-3 intentos: **reformular y avanzar** (nunca repetir igual). Escalera: 1º normal → 2º reformula simple → 3º último intento muy simple → si no, avanzar.
2. Si el dato faltante es el que decide gratis/pago (aportes en mujer 60-63, insalubres en hombre <63): **un último intento muy simple**; si aún no lo da → **agendar "a confirmar"** y marcar la ficha para que el abogado lo verifique.

---

## Componentes

### 1. `AskLoopGuard` — `server/src/core/agent/context/AskLoopGuard.ts` (nuevo, puro, sin IO)

Funciones puras, testeables sin IA/red/reloj.

```ts
export type AskTopic =
  | 'nombre' | 'edad' | 'aportes' | 'insalubres' | 'nacionalidad'
  | 'anio_ingreso' | 'hijos' | 'zona' | 'telefono' | 'horario';

export interface AskStreak { topic: AskTopic; count: number }

/** Qué dato pidió el bot en su último mensaje (por keyword). null si no pregunta un dato. */
export function detectAskedTopic(botText: string): AskTopic | null;

/** ¿El mensaje del cliente responde ese tema? Heurística por tipo de dato. */
export function clientAnswered(topic: AskTopic, clientText: string): boolean;

/** Nuevo streak: mismo tema no respondido → count++; tema nuevo/respondido → reset a 1/null. */
export function nextStreak(prev: AskStreak | null, asked: AskTopic | null, answered: boolean): AskStreak | null;

/** Directiva de escalación para inyectar al system prompt. null si count < 2. */
export function escalationDirective(topic: AskTopic, count: number): string | null;
```

Detección de tema (regex sobre `norm(botText)`), mapa mínimo:
- `aportes`: `/aportes?|anios? de aporte|cuanto aporto/`
- `insalubres`: `/insalubre|tareas? pesadas?|trabajo (pesado|insalubre)/`
- `nacionalidad`: `/argentino o extranjero|nacionalidad|es extranjero/`
- `anio_ingreso`: `/ano.*ingreso|ingreso al pais|figura en el dni/`
- `edad`: `/cuantos anos tiene|su edad|que edad/`
- `nombre`: `/su nombre|como se llama|a nombre de quien|me dice su nombre/`
- `hijos`: `/cuantos hijos|tiene hijos/`
- `zona`: `/que zona|localidad|donde vive|de donde es/`
- `telefono`: `/telefono|celular|numero.*contact|whatsapp/`
- `horario`: `/que horario|cual le queda|dia le queda|le ofrezco/`
(el primero que matchea gana; orden: los específicos antes que los genéricos.)

`clientAnswered(topic, text)`:
- `aportes|edad|anio_ingreso|hijos|telefono` → contiene un número (`/\d/`, con largo mínimo para telefono).
- `insalubres` → `/\b(si|sip|no|nop|tengo|tuve|nunca|jamas)\b/` o menciona un oficio insalubre (construccion/albañil/minería/...).
- `nacionalidad` → `/argentin|extranjer|boliviano|paraguayo|peruano|chileno|uruguayo/`.
- `nombre` → texto con ≥1 palabra alfabética de ≥3 letras que no sea muletilla.
- `zona` → cualquier texto no vacío con una localidad/palabra (heurística laxa).
- `horario` → lo resuelve OptionResolver aparte; acá `answered = true` si hay número/día.

`escalationDirective(topic, count)`:
- `count === 2` → `"El cliente todavía no respondió sobre {tema}. Reformulá la pregunta de forma MÁS SIMPLE y corta, una sola vez. No repitas la frase anterior."`
- `count === 3` → `"Es tu ÚLTIMO intento por {tema}: preguntalo de la forma más simple posible (ej. un ejemplo concreto). Si el cliente ya intentó responder, no insistas más."`
- `count >= 4` → `"NO vuelvas a preguntar {tema}. Registrá la calificación con lo que ya tenés: si {tema} es necesario para decidir gratis/pago, llamá set_qualification con a_confirmar:['{tema}'] y resultado 'gratis'; si no es decisivo, seguí al paso siguiente (agendar). Nunca dejes al cliente esperando por {tema}."`

### 2. Wiring en `ConversationController` → `AgentRuntime` (el controller ya tiene el estado + el classifier)

El loop de calificación ocurre en el tool-loop del LLM, pero el `DialogueState` y el resultado del `IntentClassifier` (que dice con más precisión si el cliente aportó el dato, vía `slots_detectados`) los tiene el `ConversationController`. Computamos el streak ahí y lo pasamos al runtime.

- `DialogueState`: agregar `ask_streak?: AskStreak | null`.
- `ConversationController.handleTurn`, cuando va a devolver `advance` (delega al tool-loop):
  1. `askedPrev = detectAskedTopic(<último mensaje assistant del history que ya carga el controller>)`.
  2. `answered = askedPrev ? (askedPrev in intent.slots_detectados || clientAnswered(askedPrev, text)) : true` — prioriza la señal del classifier; la heurística es respaldo.
  3. `streak = nextStreak(state.ask_streak, askedPrev, answered)`; guardar en el state que ya persiste (`saveState`).
  4. `directive = streak && streak.count >= 2 ? escalationDirective(streak.topic, streak.count) : null`.
  5. El `ControllerOutcome` de tipo `advance` suma un campo opcional `directive?: string`.
- `AgentRuntime.handle`: cuando el `conversation.handleTurn` devuelve `{kind:'advance', directive}`, si `directive` está presente lo concatena al `systemPrompt` de ESE turno como bloque `\n\nDIRECTIVA DEL SISTEMA (obligatoria): {directive}`. (El `RuntimeDeps.conversation.handleTurn` ya devuelve un union; se extiende el caso `advance`.)

Nota: el guard NO decide por el LLM; le inyecta una directiva. El LLM sigue leyendo el mensaje completo (mantiene la fortaleza de extraer varios datos juntos). Es determinístico dónde/cuándo se inyecta, no qué redacta. Reusa el estado + classifier que el controller ya carga y guarda (sin cargas nuevas ni deps nuevas en AgentRuntime).

### 3. Salida "a confirmar" (sin migración — jsonb existente)

- `set_qualification` schema (ToolRegistry): agregar `a_confirmar?: string[]` (temas que faltan confirmar, ej `['aportes']`).
- `validateQualification(area, resultado, datos)`: si el dato decisor falta PERO está en `datos.a_confirmar` → **no rechazar** (aceptar el gratis "a confirmar"). Concretamente:
  - hombre <63 sin insalubres: si `a_confirmar` incluye `'insalubres'` → aceptar.
  - hombre extranjero sin/mal anio_ingreso: si incluye `'anio_ingreso'` → aceptar.
  - hombre sin nacionalidad: si incluye `'nacionalidad'` → aceptar.
  - mujer 60-63 sin aportes: si incluye `'aportes'` → aceptar.
  - (edad sigue siendo dura: sin edad no hay calificación — la edad casi siempre se obtiene.)
- `book_appointment`: copiar `entry.datos.a_confirmar` (si existe) a `perfil_json.a_confirmar` (jsonb, sin migración). `pickVigenteCalificacion` ya devuelve la entry con datos.
- El `tipo_consulta` queda `'gratis'`; el flag `a_confirmar` avisa que el abogado debe verificar.

### 4. `OptionResolver` — matcheo de horarios (fricción secundaria)

Extender el parseo de hora para cubrir las formas vistas en prod:
- `"14 y 40"` / `"2 y media"` → 14:40 / (con contexto tarde) 14:30. Ya hay `canonTimes`; agregar `\bN y (media|cuarto|MM)\b`.
- `"Viernes 14 10"` → día + hora sin separador → `requestedDay='vie'` + `requestedTime` sobre `canonTimes("14 10")`.
- `"mañana 15 y 30"` → día relativo (parseSlotRequest ya lo maneja) + hora; asegurar que el match de slot use ambos.
- Regla dura vigente (Fix 2): hora explícita sin match exacto → NONE (no adivinar).

### 5. Testing

- `AskLoopGuard.test.ts`: detectAskedTopic (cada tema + negativos); clientAnswered (número→aportes, "no"→insalubres, "La Ferrere"→zona sí / aportes no); nextStreak (mismo tema no respondido incrementa, respondido resetea, tema nuevo resetea); escalationDirective (2/3/4 con el texto esperado).
- `QualificationRules.test.ts`: validateQualification con `a_confirmar` → acepta gratis incompleto marcado; sin a_confirmar sigue rechazando.
- `OptionResolver.test.ts`: "14 y 40"→14:40, "Viernes 14 10"→slot de vie 14:10, "mañana 15 y 30"→slot mañana(día) 15:30; hora explícita sin match → null.
- `AgentRuntime.test.ts` (integración): script donde el bot preguntó aportes y el cliente responde otra cosa 3 turnos → el 3er/4to systemPrompt contiene la DIRECTIVA; verificar que el streak persiste y resetea al responder.
- `Agenda.tsx`: badge "FALTA CONFIRMAR" cuando `perfil_json.a_confirmar` no vacío (chequeo de build).

## Fuera de alcance (YAGNI)
- No mover la calificación entera al controller (Approach B descartado).
- No migración nueva (se usa jsonb `perfil_json`).
- No tocar el ReminderScheduler.
- No embeddings para detección de tema (keyword alcanza para los ~10 temas del libreto).

## Meta medible
Re-correr la simulación (throttled) sobre el mismo set de cobertura y comparar: loops de calificación (bajar a ~0), y de los clientes de cobertura que ENGANCHAN el flujo, cuántos llegan a la oferta presencial (subir).
