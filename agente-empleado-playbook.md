# Agente → "Empleado": Playbook de implementación para Claude Code

> **Objetivo.** Transformar el agente actual (automatización que reinicia la
> conversación y se apega al libreto) en un **empleado** que: (1) recuerda y retoma
> el hilo, (2) extrae datos + arma resumen al agendar para que el profesional tenga
> contexto, (3) ubica geográficamente a la persona y sugiere la oficina más cercana,
> y (4) entiende respuestas libres ("el tercero", "el de video", "soy de provincia").
>
> **Stack.** Node.js / Express / PostgreSQL (Supabase) + Redis. Todo scoped por
> `account_id`. Mantener las convenciones del proyecto: idempotencia, transacciones
> atómicas (`SELECT ... FOR UPDATE`), validación de ownership (IDOR) por
> `account_id` + teléfono, y montos en centavos.

---

## 0. Principio rector: servicios compartidos, no parches por modo

Las 4 capacidades NO se implementan dentro de `flows` ni dentro de `ai_first`. Se
implementan como **servicios compartidos** que ambos motores consumen:

```
core/agent/context/    ← NUEVO
  ├─ ConversationContextLoader.ts   (Capacidad 1: continuidad)
  ├─ ReceptionFichaBuilder.ts       (Capacidad 2: extracción + resumen)
  ├─ ZoneResolver.ts                (Capacidad 3: geo-routing)
  └─ OptionResolver.ts              (Capacidad 4: comprensión flexible)
```

- En `ai_first` se exponen como **tools** en `ToolRegistry` y/o se llaman dentro de
  `AgentRuntime.handle()`.
- En `flows` se llaman desde `SupervisorService` / `SupportAgentService` / los
  `executors/*`.

**Recomendación para Prats & Simón:** poner la cuenta en `agent_mode='ai_first'` y
encodear la calificación previsional (edad + años de aporte) como **guardrails dentro
de los tools de agendamiento**, no como nodos. Así se elimina de raíz el bug de
funnel histórico (calificar y rechazar después) porque la regla vive en un solo lugar.

---

## Capacidad 1 — Continuidad conversacional ("memoria de empleado")

### Problema actual
- En `flows`, cuando el `flow_execution` termina o expira, el siguiente mensaje
  **arranca de cero** (menú frío).
- El historial corto en Redis (~12 msgs, TTL 30d) se carga, pero no hay un
  **puntero de hilo abierto** ni detección de "contacto que vuelve".
- El `long_term_summary` existe pero no se usa para *retomar*, solo para `business_context`.

### Solución: `ConversationContextLoader`
Un único loader que corre **siempre, antes de que cualquier motor actúe**, y arma un
objeto `ConversationContext` que se inyecta al prompt:

```ts
interface ConversationContext {
  contact: ContactProfile;            // de contact_memory.profile
  longTermSummary: string;            // contact_memory.long_term_summary
  openAppointment: Appointment | null;// cita pendiente/confirmada vigente
  currentThread: ThreadPointer | null;// tema en curso (ver migración)
  lastInteractionAt: Date | null;
  recentHistory: Message[];           // últimos ~12, con rol
  lastOfferedOptions: OfferedOption[];// para Capacidad 4
  isReturning: boolean;               // hubo interacción previa < N días
}
```

### Reglas de comportamiento
1. **Contacto que vuelve** (`isReturning && lastInteractionAt < 7 días`): NO mostrar
   menú frío. Saludar reconociendo el hilo:
   > "Hola de nuevo, Juan. ¿Seguimos con lo de tu jubilación o necesitás otra cosa?"
2. **Hilo abierto** (`currentThread != null`): el agente continúa donde quedó, no
   reinicia el flujo.
3. **Rehidratación**: si el historial corto de Redis expiró pero existe
   `long_term_summary` en Supabase, reconstruir contexto desde ahí. Nunca "olvidar"
   a un contacto conocido solo porque venció el TTL de Redis.
4. **No hard-reset al terminar un flujo**: al cerrar un `flow_execution`, persistir el
   resumen del hilo en `contact_memory` y dejar `currentThread` apuntando al tema (o
   `null` si se cerró explícitamente).

### Archivos a tocar
- **NUEVO** `core/agent/context/ConversationContextLoader.ts`
- `core/agent/runtime/AgentRuntime.ts` → reemplazar la carga manual de historial por
  el loader; inyectar `ConversationContext` al prompt.
- `core/agent/runtime/AgentPersona.ts` → agregar bloque de continuidad al system prompt
  ("Este contacto ya habló antes. Resumen: {longTermSummary}. Cita abierta: {…}. NO
  reinicies, retomá.").
- `core/engine/conversation.router.ts` → llamar al loader antes de decidir motor, y
  pasar `isReturning` para que `flows` salude distinto.
- `core/agent/runtime/MemoryUpdater.ts` → además de profile, mantener `currentThread` y
  `last_topic`.

### Migración (`00XX_contact_thread.sql`)
```sql
ALTER TABLE contact_memory
  ADD COLUMN last_topic        text,
  ADD COLUMN last_interaction_at timestamptz,
  ADD COLUMN current_thread    jsonb;   -- { tema, paso, datos_parciales }

CREATE INDEX idx_contact_memory_last_interaction
  ON contact_memory (account_id, last_interaction_at DESC);
```

### Criterios de aceptación
- Un contacto que escribió ayer y vuelve hoy recibe un saludo de continuidad, **no** el
  menú inicial.
- Si Redis se vacía (flush/TTL), el agente sigue reconociendo al contacto vía Supabase.
- Tras agendar y volver a escribir, el agente sabe que ya hay una cita ("Tu cita es el
  miércoles 14 hs, ¿querés cambiarla?").

---

## Capacidad 2 — Extracción de datos + resumen al agendar

### Problema actual
- `book_appointment` recibe un `resumen` que el modelo arma libremente.
- La ficha de recepción (migración 0023: `motivo`, `dni`, `canal_origen`, `carpeta`,
  `resultado`, `atendido_por`) no se completa automáticamente desde la conversación.
- El profesional, al abrir el caso en el panel, no tiene contexto rico.

### Solución: `ReceptionFichaBuilder`
Un **paso de enriquecimiento pre-booking**: antes de confirmar la cita, corre una
pasada de IA sobre la conversación completa y produce ficha estructurada + resumen
natural.

```ts
interface ReceptionFicha {
  // Estructurado (para columnas y filtros del panel)
  nombre: string | null;
  dni: string | null;
  edad: number | null;
  telefono: string;                 // ya conocido por el canal
  zona: string | null;              // de Capacidad 3
  modalidad: 'presencial' | 'video';
  motivo: string | null;            // jubilación / despido / ART / pensión...
  anios_aporte: number | null;
  situacion_previsional: string | null;
  // Libre (para que el profesional lea en 10 segundos)
  resumen_ia: string;               // 2-3 frases en lenguaje natural
}
```

Ejemplo de `resumen_ia`:
> "Juan, 62, trabajó 30 años en relación de dependencia. Quiere iniciar jubilación
> ordinaria. Vive en Quilmes, prefiere presencial. Ya tiene los aportes pero le falta
> certificar 2 años de un empleo viejo."

### Integración
- **`ai_first`**: dentro de `book_appointment`, antes del INSERT, invocar
  `ReceptionFichaBuilder.build(conversationContext)` y persistir la ficha en el mismo
  registro de cita (transacción atómica). El modelo NO arma el resumen a mano: lo arma
  el builder con un prompt dedicado de extracción.
- **`flows`**: llamar al builder desde `AppointmentExecutor` justo antes de crear la cita.
- Sincronizar campos relevantes a `contact_memory.profile` (merge incremental).

### Archivos a tocar
- **NUEVO** `core/agent/context/ReceptionFichaBuilder.ts`
- `core/agent/runtime/ToolRegistry.ts` → `book_appointment` llama al builder antes del INSERT.
- `core/engine/executors/AppointmentExecutor.ts` → idem para flows.
- `services/AppointmentService.ts` → aceptar y persistir el objeto `ReceptionFicha`.
- Vista del panel del profesional → renderizar `resumen_ia` arriba, ficha estructurada abajo.

### Migración (`00XX_appointment_ficha_ia.sql`)
```sql
ALTER TABLE appointments
  ADD COLUMN resumen_ia text,
  ADD COLUMN perfil_json jsonb;   -- snapshot estructurado al momento de agendar
```
*(reusar las columnas de la 0023 donde apliquen: `motivo`, `dni`, etc.)*

### Criterios de aceptación
- Al agendar, la cita queda con `resumen_ia` poblado y `perfil_json` con los campos que
  se pudieron extraer (los faltantes en `null`, nunca inventados).
- El profesional ve el resumen sin tener que leer toda la conversación.
- Los datos extraídos se reflejan en `contact_memory` para la próxima interacción.

---

## Capacidad 3 — Geo-routing (sugerir la oficina más cercana)

### Problema actual
- Zonas fijas: CABA / Quilmes / Haedo + videollamada.
- Si la persona dice "soy de provincia de Buenos Aires" o nombra un barrio/partido, el
  bot no infiere cuál oficina le queda más cerca.

### Solución: `ZoneResolver` (gazetteer-first + fallback IA)
**No usar geocoding online como primera opción** (latencia, costo, sandbox). El dominio
está acotado a AMBA, así que un **gazetteer curado** (partidos del conurbano + barrios
porteños → oficina más cercana) resuelve el 90% de los casos de forma determinística y
sin alucinar. La IA queda como fallback para texto ambiguo.

```ts
function resolveZone(input: { texto: string; account_id: string })
  : {
      oficina_sugerida: 'CABA' | 'Quilmes' | 'Haedo' | null;
      confianza: 'alta' | 'media' | 'baja';
      necesita_aclaracion: boolean;
      pregunta_aclaracion?: string;
      siempre_ofrecer_video: true;   // videollamada es fallback universal
    }
```

### Lógica
1. **Gazetteer determinístico** (tabla, ver abajo): normalizar (sin acentos, minúsculas),
   buscar partido/barrio → oficina. Confianza `alta`.
2. **Fallback IA**: si no matchea, pasarle al modelo la lista de oficinas con su zona de
   cobertura y que infiera la más cercana. Confianza `media`.
3. **Demasiado vago** ("soy de provincia", "del conurbano"): NO adivinar. Hacer **una**
   pregunta de aclaración como lo haría un empleado:
   > "¿De qué zona, más o menos? Sur (Quilmes/Lanús/Avellaneda), Oeste
   > (Morón/Haedo/Ramos), o algún partido en particular?"
4. **Fuera de cobertura** (interior, otra provincia): ofrecer **videollamada** directo.
5. **Videollamada siempre disponible** como opción, independientemente de la zona.

### Gazetteer sugerido (AMBA)
| Oficina | Cobertura (partidos / barrios) |
|---------|--------------------------------|
| **Quilmes** (zona sur) | Quilmes, Bernal, Don Bosco, Ezpeleta, Berazategui, Florencio Varela, Avellaneda, Lanús, Lomas de Zamora, Banfield, Temperley, Adrogué, Alte. Brown, Wilde, Sarandí |
| **Haedo** (zona oeste) | Haedo, Morón, Castelar, Ituzaingó, Ramos Mejía, San Justo / La Matanza, Ciudadela, Hurlingham, Merlo, Moreno, El Palomar, Villa Sarmiento |
| **CABA** (capital + norte) | Todos los barrios porteños (Caballito, Flores, Belgrano, Palermo, Once, Liniers…) + zona norte (Vicente López, Olivos, San Isidro, Martínez, Tigre) |
| **Videollamada** | La Plata, Berisso, Ensenada, interior de Bs. As., otras provincias, o cualquiera que la prefiera |

### Archivos a tocar
- **NUEVO** `core/agent/context/ZoneResolver.ts`
- **NUEVO** `scripts/seed-gazetteer.ts`
- `core/agent/runtime/ToolRegistry.ts` → nueva tool `suggest_office(location_text)`;
  `list_offices` / `check_availability` consumen el resultado.
- `services/AvailabilityService.ts` → recibir `oficina_sugerida` como filtro de zona.

### Migración (`00XX_offices_geo.sql`)
```sql
ALTER TABLE offices
  ADD COLUMN lat numeric,
  ADD COLUMN lng numeric;

CREATE TABLE zone_gazetteer (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL,
  alias       text NOT NULL,        -- "lanus", "ramos mejia", "caballito"
  alias_norm  text NOT NULL,        -- normalizado (sin acentos, lower)
  oficina     text NOT NULL,        -- 'CABA' | 'Quilmes' | 'Haedo'
  UNIQUE (account_id, alias_norm)
);
CREATE INDEX idx_gazetteer_lookup ON zone_gazetteer (account_id, alias_norm);
```
*(El gazetteer es **dato editable**, no código, para sumar localidades sin deploy.)*

### Criterios de aceptación
- "soy de Lanús" → sugiere **Quilmes** + menciona videollamada.
- "vivo en Ramos Mejía" → sugiere **Haedo**.
- "estoy en Caballito" → sugiere **CABA**.
- "soy de provincia de Buenos Aires" → **una** pregunta de aclaración (no adivina).
- "soy de Córdoba" → ofrece **videollamada**.

---

## Capacidad 4 — Comprensión flexible de opciones ("el tercero")

### Problema actual
- El Supervisor ya hace `fill` (mapea texto libre a opción), pero NO resuelve
  referencias **posicionales/ordinales** porque no recuerda *qué ofreció y en qué orden*.

### Solución: registrar lo ofrecido + `OptionResolver`
**Clave:** para entender "el tercero", el sistema tiene que saber qué presentó, en orden.
Hay que persistir las opciones ofrecidas en el estado de la sesión.

```ts
interface OfferedOption { index: number; label: string; value: string; }

function resolveOption(input: {
  userText: string;
  offered: OfferedOption[];
}): { matchedValue: string | null; confianza: number };
```

El resolver maneja:
- **Ordinales**: "el primero / segundo / tercero", "la última", "el de arriba/abajo".
- **Posicionales**: "opción 2", "el 3", número escrito o en letras.
- **Semánticos**: "el de videollamada" (cuando una opción es video), "el más cercano",
  "el de la mañana", "ese", "el de Quilmes".

### Registro automático de opciones ofrecidas
- En **`ai_first`**: cuando `check_availability` devuelve slots o `list_offices` devuelve
  oficinas, el `AgentRuntime` **captura ese resultado** y lo guarda como
  `lastOfferedOptions` en la sesión. No depende de que el modelo lo recuerde.
- En **`flows`**: el nodo `question`/`poll` ya conoce sus opciones; guardarlas en el
  estado de la sesión al presentarlas.

### Integración
- `SupervisorService.interpret` → antes de `escalate`, pasar por `OptionResolver` con
  `lastOfferedOptions`. Si resuelve con confianza alta, `fill` directo sin gastar IA.
- `AgentRuntime` → normalizar la entrada del usuario contra `lastOfferedOptions` antes de
  enviar al modelo (o como tool `pick_option`).

### Archivos a tocar
- **NUEVO** `core/agent/context/OptionResolver.ts`
- `services/SupervisorService.ts` → usar el resolver dentro de `fill`.
- `core/agent/runtime/AgentRuntime.ts` → capturar resultados de tools como opciones
  ofrecidas; resolver posicionales antes del modelo.
- `core/engine/executors/IntentResolverExecutor.ts` → soportar opciones ordenadas.

### Criterios de aceptación
- Se ofrecen 3 slots y el usuario dice "el tercero" → toma el slot #3.
- "el de videollamada" cuando una opción es video → la elige.
- "ese de la mañana" → filtra por turno y elige.
- "dale el primero" → toma el #1.
- Si es ambiguo ("cualquiera") → el agente elige uno y confirma, como un empleado.

---

## Resumen de migraciones

| Migración | Qué agrega |
|-----------|-----------|
| `00XX_contact_thread.sql` | `contact_memory.last_topic`, `last_interaction_at`, `current_thread` |
| `00XX_appointment_ficha_ia.sql` | `appointments.resumen_ia`, `perfil_json` |
| `00XX_offices_geo.sql` | `offices.lat/lng` + tabla `zone_gazetteer` |

*(La de opciones ofrecidas puede vivir en Redis/estado de sesión; no requiere migración
si ya hay un blob de sesión. Si no, agregar `flow_executions.last_offered jsonb`.)*

---

## Nuevas tools (`ai_first`)

| Tool | Firma | Qué hace |
|------|-------|----------|
| `suggest_office` | `(location_text)` → `{oficina, confianza, necesita_aclaracion, pregunta?}` | Gazetteer + IA fallback; videollamada universal |
| `build_reception_ficha` | `()` → `ReceptionFicha` | Extrae perfil + resumen de la conversación. Llamada interna desde `book_appointment` |
| `pick_option` | `(user_text)` → `{matched_value}` | Resuelve posicional/ordinal/semántico contra lo ofrecido |

> **Mantener la regla de oro**: `search_knowledge` con grounding estricto sigue siendo
> obligatorio para temas previsionales. Ninguna de estas tools habilita inventar datos
> legales; solo mejoran enrutamiento, memoria y UX.

---

## Orden de implementación sugerido (por dependencias)

1. **`ConversationContextLoader`** (Capacidad 1) — es la base; todo lo demás se inyecta
   en el contexto que arma.
2. **`OptionResolver`** (Capacidad 4) — bajo riesgo, alto impacto inmediato, depende solo
   de `lastOfferedOptions`.
3. **`ZoneResolver`** + gazetteer (Capacidad 3) — aislado, testeable solo.
4. **`ReceptionFichaBuilder`** (Capacidad 2) — último porque consume el contexto completo
   y se engancha en el booking, que conviene tocar al final.

---

## Checklist de seguridad (no romper lo que ya funciona)

- [ ] Todo scoped por `account_id` (gazetteer, ficha, memoria, opciones).
- [ ] `book_appointment` / `reschedule` / `cancel` mantienen validación de ownership
      (account + teléfono). El enriquecimiento NO debe saltear esa validación.
- [ ] Extracción de ficha es **idempotente**: re-agendar no duplica perfil.
- [ ] `ReceptionFichaBuilder` nunca inventa DNI/edad/aportes: faltante = `null`.
- [ ] El loader de contexto degrada con gracia: si Redis y Supabase fallan, cae al
      comportamiento actual (no rompe).
- [ ] `ZoneResolver` siempre deja videollamada como salida; nunca deja a alguien sin opción.
- [ ] Logging fino de cada decisión de `OptionResolver` y `ZoneResolver` (para auditar
      mapeos equivocados, igual que se hizo con los bugs de funnel).
