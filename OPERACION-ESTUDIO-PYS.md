# Operación del Estudio Prats & Simon (PYS) — Mapa del sistema actual

> Documento de referencia. Describe **cómo opera hoy** el estudio previsional (sistema n8n)
> y cómo se mapea a este panel. Base para seguir trabajando en los flujos y, más adelante,
> en la herramienta de gestión de casos para las abogadas.
>
> Fuente: análisis de ~50 workflows n8n exportados en `import_clean/` + `PLANILLA RECEPCION 2026.pdf`
> (ver `Analisis_Estructura_PLANILLA_RECEPCION_2026.md`). Relevado 2026-06-18.

---

## 1. Stack actual (todo orquestado en n8n)

| Componente | Rol |
|---|---|
| **Evolution API** | Canal WhatsApp (envío/recepción, presencia "escribiendo") |
| **Chatwoot** | Canal Instagram / Facebook (detección de canal, labels) |
| **Kommo (CRM)** | **Fuente de verdad** de leads/contactos. Pipelines, statuses, custom fields, salesbots |
| **PostgreSQL** | Schema `alien_ai` + schemas por canal (`whatsapp`, `instagram`, `messenger`). Contactos, mensajes, memoria de chat, formularios por rama |
| **Redis** | Buffer de mensajes (agrupa ráfagas del usuario ~30s) |
| **Google Calendar** | 5 calendarios (1 por abogada). Disponibilidad y eventos de cita |
| **Google Sheets** | "Citas Agendadas - PYS" (registro paralelo de citas) |
| **IA** | Google Gemini 2.5 Flash (principal) + OpenAI (fallback) |

---

## 2. Pipeline operativo (punta a punta)

```
Ingreso (WPP/IG/FB)
  → Buffer Redis (agrupa ráfagas ~30s)
  → Transcribe audio/imagen (IA)
  → Clasifica MOTIVO (keywords + LLM fallback, umbral confianza 75%)
  → Sub-flujo por tema legal
  → Califica viabilidad (reglas por tema)
  → Selecciona oficina
  → Ofrece 3 horarios (Google Calendar)
  → Confirma → crea evento GCal
  → Reminder (pre-cita)
  → Seguimiento (cambio / nada / escala a humano)
```

### Buffer Redis
Agrupa mensajes que llegan en ráfaga para no disparar el bot por cada uno. Espera ~30s
desde el último mensaje antes de procesar el lote. Soporta texto + media (audio/imagen).

### Transcripción
Audio y imagen se transcriben/describen con IA y se concatenan al texto antes de clasificar.

---

## 3. Clasificación de MOTIVO

Lógica **híbrida**: primero detector por keywords (normaliza: minúsculas, sin tildes; mapea
números "1","2"… a categoría); si no detecta o confianza ≤ 75%, **fallback LLM**.

Categorías:
- **JUBILACION** (ANSES, retiro, aportes, moratoria)
- **PENSION** (únicamente por viudez)
- **ART / DESPIDO** (despido, trabajo en negro, liquidación, accidente laboral, enfermedad profesional)
- **ACCIDENTE DE TRÁNSITO** (choque, siniestro, seguro, terceros)
- **OTRA CONSULTA** (divorcio, familia, alimentos, herencias, Veraz, multas)
- **YA SOY CLIENTE** (menciona abogado/expediente/causa)
- **CONSULTA INDETERMINADA** (saludo genérico / sin info)

Salida LLM esperada: `{ opcion_del_usuario, confianza (0-100), motivo }`.
Prioridades: si menciona "despido" → ART/DESPIDO; si "choque" → TRÁNSITO.

---

## 4. Sub-flujos por tema + reglas de viabilidad (reales)

| Tema | Datos que pide | Regla de viabilidad |
|---|---|---|
| **Jubilación** | edad, años de aportes, moratoria, hijos computables, situación laboral | Evaluación previsional |
| **Pensión** | (viudez) | — |
| **Despido / ART** | nacionalidad, edad, oficio | ≥63 años = **viable**; <63 = necesita **oficio insalubre** (construcción, chofer camión/colectivo, taxi, recolección, minería, radiología, fundición). Si no califica → ofrece **consulta previsional $29.000** |
| **Accidente tránsito / Multas** | fecha del accidente, aseguradora del tercero, lesiones | Prescripción **< 2 años**; **rechaza** aseguradoras: PARANA, AGROSALTA, LIBRA, ESCUDO, ANTARTIDA |
| **Veraz** | intención, comprobante de pago (imagen) | Ofrece manual **"Derecho al Olvido" $4.900** (90% off de $49.000) |
| **Otras** | clasifica intención y rutea | — |

Tono de las respuestas: formal, profesional, amigable, argentino; sin jerga folklórica;
respuestas cortas (≤200-250 chars).

---

## 5. Agendamiento (Google Calendar)

### Oficinas / abogadas / calendarios
| Oficina | Abogada | Calendario |
|---|---|---|
| CABA | Daiana | `7b848557…@group.calendar.google.com` |
| Quilmes | Serena | `45ac43f4…@group.calendar.google.com` |
| Haedo | Maura | `93c706e2…@group.calendar.google.com` |
| Videollamada | Lara | `ee770997…@group.calendar.google.com` |
| Videollamada | Lourdes | `964eb314…@group.calendar.google.com` |

Selección de oficina: del campo OFICINA del lead; si INDETERMINADO → IA clasifica por
geografía; si confianza baja → pide ubicación al cliente.

### Disponibilidad
- Slots **20 min** (histórico 15).
- **Lun-Vie**, horario hábil (mañana / mediodía / tarde), saltea sábados/domingos y **feriados AR** (+ hardcode 08/12, 23–25/12, 31/12, 01/01).
- Buffer mínimo **2h** desde "ahora"; si ≥18:00 arranca al día siguiente 9:00.
- Evita solapamientos cruzando eventos de los 5 calendarios.
- Prioridad de asignación: **Lara → Lourdes → Daiana → Maura → Serena**.
- Ofrece **3 opciones** (una por bloque mañana/mediodía/tarde), busca hasta 10 días hábiles.

### Reserva
Ofrece 3 → usuario elige (A/B/C o texto libre) → IA interpreta (ELIGIO / PIDIO otro /
NULO / CONTACTAR) → si ELIGIO y slot sigue libre → **crea evento GCal**:
`summary: "{OFICINA} CON {cliente}. {tipo_consulta} | {tel} | {fecha} | LEAD ID: {id}"`.
Zona horaria America/Argentina/Buenos_Aires (UTC-3).

### Reprogramación / Reminder / Seguimiento
- **Reminder**: schedule cada 15 min, solo 8-22h. Pide **clave de ANSES / sábana de aportes** antes de la cita (3 mensajes separados con waits).
- **Seguimiento** (IA): `intencion ∈ {CAMBIO, NADA, ATENCION}`. CAMBIO → re-ofrece (borra evento viejo); NADA → confirma; ATENCION (cancela / fecha pasada / duda compleja) → **escala a humano**.

---

## 6. CRM (Kommo) + handoff

- **Contactos**: tel custom field `718602`, email `718604`. Normaliza teléfono por país (AR `+54 9`, MX sin "1").
- **Leads**: por pipeline/status; ~20 custom fields para agendamiento (horarios/fechas/agentes opción A/B/C, ID calendario, ID evento, fecha legible, flags de reintento).
- **Salesbots** disparados por `bot_id` según motivo/etapa.
- **Persistencia espejo** en Postgres (`alien_ai.contacts`, `messages`, memoria LangChain `alien_ai_chat_history`) y Data Table n8n.
- **Handoff a humano**: label `human_needed` (Chatwoot) + flag `human_in_the_loop` (DB). "Saca Human Needed" lo revierte y sincroniza con Google Sheets de citas.

---

## 7. CRM manual paralelo — PLANILLA RECEPCIÓN 2026

Las abogadas llevan a mano una planilla (1 fila = 1 caso):
`FECHA · NOMBRE · MOTIVO · DNI · CONTACTO · FALTANTE · DESCRIPCIÓN · CÓMO NOS CONOCIÓ · ABOGADA A CARGO · SEGUIMIENTO`.

- **MOTIVO** (enum): JUBILACION, PUAM, PENSION V, REAJUSTE, RTI, OTRO, ASESORAMIENTO.
- **DESCRIPCIÓN** = texto libre con datos previsionales (FN, edad, nacionalidad, FI país, años aportes, hijos computables, moratorias; casos especiales: taxi, construcción/IERIC, transporte, IPS, monotributo). Etiquetas repetidas (`FN:`, `FI:`, `Aportes:`, `Hijos:`, `Clave de anses:`) → extraíbles por regex.
- **CÓMO NOS CONOCIÓ** (canal): Facebook, Instagram, TikTok, Web, Recomendado.
- **SEGUIMIENTO** (estados mezclados con notas): SI, NO, PENSAR, TRAER DOCUMENTACIÓN, PRESENCIAL, HABLAR +1 año, NO VA INICIAR, YA LO INICIÓ, LLAMAR MÁS ADELANTE.

Modelo relacional propuesto (en el análisis): `Clientes` · `Consultas` · `EvaluacionPrevisional` · `Seguimiento`.
Contiene **datos sensibles** (DNI, teléfonos) → control de acceso.

---

## 8. Mapeo a este panel

| Capacidad (n8n actual) | Estado en el panel |
|---|---|
| Canal WhatsApp | ✅ (Baileys + API oficial Meta) |
| Canal IG/FB | ✅ backend omnichannel (parcial) |
| Buffer de mensajes | ✅ `bufferMemoryNode` / Redis |
| Transcripción audio | ✅ `audioToTextNode` (Groq Whisper) |
| Clasificación de motivo | ✅ Agente IA + `intentResolverNode` + soporte global |
| Ruteo a sub-flujo | ✅ flujos por tema + ruteo IA pre-menú |
| Reglas de viabilidad por tema | ⚠️ parcial (se arma flujo por flujo) |
| Agendamiento multi-oficina/calendario | ⚠️ hay `appointment*Node` + Agenda; falta multi-calendario/prioridad de abogadas estilo PYS |
| Reminders pre-cita | ✅ `ReminderScheduler` (20 min / configurable) |
| Seguimiento (cambio/cancela/escala) | ⚠️ parcial |
| Handoff a humano | ✅ `handoverNode` + estado HANDOVER + Atención |
| **CRM / gestión de casos para abogadas** | ❌ **falta** (hoy = PLANILLA + Kommo) |
| Sincronización con Kommo | ❌ no integrado |

### Gap principal
La **herramienta de trabajo para las abogadas** = la capa de **CRM / gestión de casos**:
vista de leads con motivo, datos de calificación extraídos de la conversación, cita asignada,
abogada a cargo y estado de seguimiento — reemplazando/centralizando la PLANILLA + Kommo.

> Decisiones abiertas (pendientes de definir con el cliente): (a) CRM dentro del panel vs.
> seguir con Kommo como fuente de verdad; (b) si el panel lee/escribe a Kommo o migra a Supabase;
> (c) alcance del módulo de gestión de casos.

---

## 9. Próximos pasos

Seguir trabajando en los **flujos** (intake, clasificación, sub-flujos por tema con sus reglas
de viabilidad, agendamiento). La capa CRM/gestión de casos se aborda después, con alcance definido.
