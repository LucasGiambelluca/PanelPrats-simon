# Plan — Ficha de recepción en la cita + analíticas admin

Integrar los campos de la planilla de recepción a cada **cita** (`appointments`), para que
las empleadas los completen mientras atienden, y el admin tenga analíticas de conversión.

Branch base: `feat-omnichannel`. Próxima migración: `0023`.

---

## 1. Decisiones tomadas

1. **Empleada y abogada separadas**: nuevo `atendido_por` (empleada/recepcionista) +
   `assigned_profile_id` existente (abogada/profesional). Permite conversión por empleada y por abogada.
2. **`resultado` separado** del ciclo de la cita (`status`). Son dos ejes distintos:
   - `status` = ciclo de la reunión: `pendiente/confirmada/cancelada/asistio/no_asistio/cerrado` (ya existe).
   - `resultado` = disposición del lead: `SI/NO/PENSAR/TRAER_DOC` (nuevo).
3. **Se llena en el detalle de la cita** (modal de `client/src/pages/Agenda.tsx`).
4. **Canal autodetectado** con override manual (ver §3 por los límites reales).

---

## 2. Modelo de datos — migración `0023_appointment_intake.sql`

Campos nuevos en `appointments` (todos nullable / con default, idempotente con `IF NOT EXISTS`):

| Columna | Tipo | Notas |
|---|---|---|
| `motivo` | text | enum CHECK |
| `dni` | text | sin formato, libre |
| `faltante` | text | qué documentación falta (clave ANSES, IERIC, etc.) |
| `canal_origen` | text | enum CHECK; auto + override |
| `canal_auto` | boolean default true | `true` = detectado por sistema, `false` = corregido a mano |
| `carpeta` | boolean default false | checkbox "carpeta armada" |
| `seguimiento` | text | notas de seguimiento (la columna más larga de la planilla) |
| `resultado` | text | enum CHECK; disposición del lead |
| `atendido_por` | uuid → `profiles(id)` ON DELETE SET NULL | empleada que atendió |

Enums (CHECK constraints, permitir `NULL`):

```sql
motivo IN ('jubilacion','puam','pension_v','reajuste','rti','laboral',
           'pension_discapacidad','asesoramiento_pago','otro')

canal_origen IN ('whatsapp','facebook','instagram','tiktok','google',
                 'recomendada','pagina_web','otro')

resultado IN ('si','no','pensar','traer_doc')   -- SI / NO / PENSAR / TRAER DOCUMENTACIÓN
```

Índices para analíticas:
```sql
CREATE INDEX IF NOT EXISTS idx_appt_intake_analytics
  ON appointments (account_id, created_at, resultado, canal_origen, motivo);
CREATE INDEX IF NOT EXISTS idx_appt_atendido ON appointments (atendido_por);
```

> RLS: `appointments` ya tiene policy por dueño de cuenta, pero el backend usa el **service key**
> (bypassa RLS) y la autorización real la hace `authContext()` en la app. No cambia con esta migración.

Actualizar la interfaz `Appointment` en `server/src/services/AppointmentService.ts` (líneas 4-19)
y los `insert`/`update` (líneas ~168-180 y ~225-237) para incluir los campos nuevos.
`deserializeAppointment` ya hace passthrough con `...app`, sólo agregar defaults explícitos.

---

## 3. "Cómo nos conoció" automático — alcance real

`accounts.channel` ya distingue `whatsapp / facebook / instagram` (migración `0003`). De ahí sale el auto.

**Autodetectable:**
- DM de **Facebook** → `facebook`
- DM de **Instagram** → `instagram`
- **WhatsApp** normal → `whatsapp` (genérico: el mensaje no dice el origen de marketing)
- **WhatsApp Click-to-WhatsApp ad** → el webhook de Meta trae `messages[].referral`
  (`source_type='ad'`, `source_id`, `source_url`). Mapeable a `facebook`/`instagram`.
  Capturarlo en el ingreso del mensaje y guardarlo en la conversación.

**NO autodetectable** (requieren override manual): `tiktok`, `google`, `recomendada`, `pagina_web`.

### Wiring
1. **Captura del referral de WhatsApp** (opcional, fase 2):
   `server/src/infrastructure/meta/WhatsAppOfficialClient.ts` (~líneas 105-143) — leer
   `value.messages[].referral`; persistir en `whatsapp_conversations` una columna nueva
   `referral_source text` (migración `0024`, separada).
2. **Default al crear cita desde el flujo**:
   `server/src/core/executors/AppointmentExecutor.ts` (~línea 90) — antes de `create()`,
   resolver `canal_origen` desde `account.channel` (ya tiene `context.accountId`), y `referral`
   de la conversación si existe. `canal_auto = true`.
3. **Default al crear cita a mano en Agenda**: si la cita se abre desde una conversación,
   precargar `canal_origen` con `accounts.channel` de esa cuenta. Empleada puede cambiarlo
   (`canal_auto = false` al editar el campo).

---

## 4. API

### 4.1 Rutas de citas — `server/src/api/routes/appointments.routes.ts`
- Agregar a `createAppointmentSchema` y `updateAppointmentSchema` (zod, líneas 6-28):
  `motivo, dni, faltante, canal_origen, canal_auto, carpeta, seguimiento, resultado, atendido_por`.
- Montar el router detrás de `authContext()` (middleware ya existe en
  `server/src/api/middleware/auth.ts`). En el POST, si `atendido_por` no viene, default
  `req.user.id`. Validar enums con zod (`z.enum([...])`).

### 4.2 Nuevo endpoint analíticas — `server/src/api/routes/analytics.routes.ts`
`GET /api/analytics/intake?from=&to=&account_id=` — **solo admin** (`req.user.role === 'admin'`).

Devuelve agregaciones (calculadas en SQL con `group by`, o en memoria sobre `AppointmentService.list`
si el volumen es chico):

```jsonc
{
  "total": 480,
  "conversion": 0.27,                    // resultado='si' / total
  "porResultado":  { "si": 130, "no": 210, "pensar": 90, "traer_doc": 50 },
  "porCanal":      { "facebook": 300, "instagram": 90, "whatsapp": 60, "tiktok": 20, ... },
  "porMotivo":     { "jubilacion": 380, "puam": 40, "pension_v": 20, ... },
  "porEmpleada":   [ { "id": "...", "name": "Daiana", "total": 200, "conversion": 0.28 }, ... ],
  "porAbogada":    [ { "id": "...", "name": "...", "total": 120 }, ... ],
  "porMes":        [ { "mes": "2026-01", "total": 133, "conversion": 0.28 }, ... ]
}
```

---

## 5. UI — `client/src/pages/Agenda.tsx`

Extender el modal de crear/editar cita (form actual líneas 82-91) con una sección "Ficha de recepción":

- `motivo` — `<select>` con las 9 opciones.
- `dni` — input texto.
- `faltante` — input texto (placeholder: "clave ANSES, IERIC, certificación…").
- `canal_origen` — `<select>`; precargado si se abrió desde conversación; badge "auto" si `canal_auto`.
- `atendido_por` — auto = usuario actual; el admin puede reasignar (select de empleadas).
- `assigned_profile_id` (abogada) — ya existe en el flujo de profesionales.
- `resultado` — `<select>`: SI / NO / PENSAR / TRAER DOCUMENTACIÓN (con colores como la planilla:
  verde / rojo / amarillo / celeste).
- `carpeta` — checkbox.
- `seguimiento` — `<textarea>`.

Agregar los campos a `appointmentsApi.create/update` en `client/src/lib/api.ts` (~líneas 201-310)
y a los tipos del cliente.

---

## 6. Analíticas admin — UI

Opción recomendada: **nueva página `client/src/pages/Analiticas.tsx`** (solo admin), consumiendo
`/api/analytics/intake`. Reusar el estilo de cards/charts de `Dashboard.tsx` (líneas 56-87).

Tarjetas/visualizaciones (lo que ya calcula la planilla a mano):
- Conversión total + por mes (línea/barras).
- Reuniones por mes.
- Embudo por `resultado` (SI/NO/PENSAR/TRAER DOC).
- Ranking de empleadas por reuniones y conversión.
- Distribución por canal (de dónde vienen los leads) y por motivo.
- Filtro por rango de fechas y por cuenta/línea.

Gate: link visible solo si `role === 'admin'` (patrón RBAC ya usado en el panel).

---

## 7. Datos históricos (planilla 2026) — opcional, NO bloquea

El PDF tiene ~2000 filas con datos sucios (errores de tipeo, celdas corridas, OCR). Recomendación:
**arrancar de cero** con el sistema nuevo y NO importar automáticamente. Si se quiere histórico,
fase aparte: parsear a CSV, limpieza manual, import con `motivo/canal/resultado` normalizados.
Riesgo alto de basura en las analíticas si se importa crudo.

---

## 8. Orden de implementación (fases)

1. **Migración `0023`** + tipos/Service backend (campos nuevos, sin UI). ← base.
2. **API**: schemas zod + `atendido_por` desde `req.user` + router tras `authContext`.
3. **UI Agenda**: sección "Ficha de recepción" en el modal de cita.
4. **Auto-canal**: default en `AppointmentExecutor` + precarga en Agenda desde conversación.
5. **Endpoint `/api/analytics/intake`** (admin).
6. **Página Analíticas** (admin).
7. *(Opcional)* `0024` referral Click-to-WhatsApp + captura en `WhatsAppOfficialClient`.
8. *(Opcional)* import histórico de la planilla.

Fases 1-3 = MVP usable (empleadas cargan, datos quedan). 5-6 = valor para el admin.

---

## 9. Decisiones abiertas / riesgos

- **`canal_origen` para WhatsApp genérico**: sin Click-to-WA ads, todo cae en `whatsapp`. Si el
  estudio mide marketing por FB/IG/TikTok/Google, las empleadas van a tener que setearlo a mano
  igual que en la planilla. El auto sólo ahorra trabajo en DMs nativos de FB/IG.
- **Multi-cuenta vs canal**: una cuenta WhatsApp puede recibir leads de muchas fuentes. El auto
  refleja el *canal de mensajería*, no la *fuente de marketing*. Son cosas distintas; el override
  manual cubre la diferencia.
- **`atendido_por` en citas creadas por el bot**: las citas que arma el flujo no tienen empleada
  humana → `atendido_por = NULL` hasta que alguien las toma. Las analíticas por empleada deben
  excluir `NULL` o mostrarlas como "Bot/sin asignar".
