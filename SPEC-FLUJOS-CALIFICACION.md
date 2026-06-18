# Spec de flujos de calificación — Estudio PYS

> Árboles de decisión dictados por el cliente (transcripción `data para flujos.md`, 21/5/2026).
> Lógica de **calificación de viabilidad** por embudo. Autoritativo para construir los flujos.
> Complementa `OPERACION-ESTUDIO-PYS.md` (operación general).
>
> **Resultados posibles:** ✅ VIABLE (→ agendar cita gratuita) · 💰 NO VIABLE → consulta paga
> $29.000 (análisis previsional) · ❌ DESCARTAR · 🔥 POTABLE (agendar).

---

## 1. JUBILACIÓN — HOMBRE  *(implementado: flujo "Jubilación Hombre", trigger `jubhombre`)*

Datos: **edad**, **nacionalidad**, **aportes insalubres** (sí/no), [extranjero] **años de ingreso al país** (DNI).

- **Argentino, ≥63** → ✅ VIABLE
- **Argentino, <63 con aportes insalubres** (construcción, taxi, chofer, etc.) → ✅ VIABLE
- **Argentino, <63 sin insalubres** → 💰 $29.000
- **Extranjero, ≥63 y años de ingreso ≥17** → ✅ VIABLE
- **Extranjero, <63 con insalubres** → ✅ VIABLE
- **Extranjero, <63 sin insalubres** → 💰 $29.000 *(excepción viable: ingreso ≥30 años Y insalubres — redundante: insalubres ya = viable)*
- **Extranjero, ≥63 con años de ingreso <17** → *(no especificado por el cliente)* → asumido 💰 $29.000 **(CONFIRMAR)**

## 2. JUBILACIÓN — MUJER

Datos: **edad**, **nacionalidad**, **hijos**, [≥60 arg] **años de aportes desde 1993**.

- **Argentina 58-59** → ✅ VIABLE
- **Argentina <58** → 💰 $29.000
- **Argentina ≥60**: ¿>10 años de aportes (rel. dependencia o monotributo) desde 1993? **+1 año por cada hijo**. (aportes + hijos) ≥10 → ✅ VIABLE; si no → 💰 $29.000
- **Extranjera ≤59**: ingreso ≥2000 → ❌ NO VIABLE; ingreso <2000 → ✅ VIABLE
- **Extranjera 60-63**: ingreso >2006 (<20 años) → ❌ NO VIABLE
- **Extranjera ≥63**: ingreso <2008 (≥18 años) → ✅ VIABLE

---

## 3. LABORAL / DESPIDO  *(embudo de 7 preguntas en cadena)*

1. **Antigüedad** — ¿hace cuánto trabajás/trabajaste ahí? <9 meses → ❌ · >9 meses → P2
2. **Situación** — ¿seguís o ya no? Sigo → P4 · Ya no → P3
3. **Plazo** (si ya no) — ¿hace cuánto dejaste? >2 años → ❌ · <2 años → P3B
4. **P3B Motivo salida** — ¿cómo terminó? Despido sin causa → 🔥 AGENDAR · Otra (renuncia/acuerdo/causa) → P4
5. **P4 Abogado** — ¿ya iniciaste reclamo con otro abogado? Sí → ❌ · No → P5
6. **P5 Registración** — ¿registrado o en negro? En negro → 🔥 · Registrado → P6
7. **P6 Pagos en negro** — ¿cobrás parte en negro? Sí → 🔥 · No → P7
8. **P7 Fecha ingreso recibo** — ¿la fecha del recibo es real? Ingresé antes → 🔥 · Es real → ❌

---

## 4. ACCIDENTE DE TRÁNSITO

1. **Compañía del que chocó** — si ∈ {Escudo, Caledonia, Agrosalta, Orbis, Libra} → "No realizamos reclamos contra {compañía}" (❌). Otra → P2
2. **Datos del tercero** — ¿tenés datos del que te chocó (datos + seguro + patente)? Sin esto **no se avanza**.
3. → **Coordinar videollamada** (calendario "accidentes de tránsito").

---

## 5. ART (accidente de trabajo)

1. ¿El accidente fue hace **<2 años**?
   - **No** → mensaje empático + **derivar al embudo laboral** (ver si es viable como reclamo laboral).
   - **Sí** → "estás dentro del plazo" → P2
2. ¿Estás/estabas **en blanco** cuando ocurrió? *(respuesta clave)*
3. ¿Qué **tipo de accidente y lesión** tuviste? → sumar a los datos del agendamiento.
4. **Coordinar reunión**: videollamada (cal. "Agus videollamada") o presencial:
   - CABA → calendario "laboral" · Quilmes → "quilmes serena" · Haedo → "Haedo Maura"

---

## Discrepancias / decisiones pendientes (CONFIRMAR con cliente)

1. **Aseguradoras rechazadas (tránsito)**: este spec = Escudo/Caledonia/Agrosalta/Orbis/Libra. El n8n viejo listaba PARANA/AGROSALTA/LIBRA/ESCUDO/ANTARTIDA. → **se toma esta lista como autoritativa.**
2. **Despido**: n8n viejo usaba regla simple (≥63/insalubre); este spec define un embudo de 7 preguntas distinto. → **vale el de 7 preguntas.**
3. **Extranjero hombre ≥63 con ingreso <17 años**: sin regla explícita → asumido 💰 $29.000.
4. Calendarios ART presencial: "laboral" (CABA), "quilmes serena", "Haedo Maura" — distintos de las abogadas del agendamiento general.
5. Las reglas usan **edad**; el cliente menciona "fecha de nacimiento". El flujo pide edad directa (no hay nodo de cálculo de fecha). Si se requiere FN exacta, falta un nodo de cómputo.
