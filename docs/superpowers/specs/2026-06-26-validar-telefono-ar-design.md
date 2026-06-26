# Validar teléfono AR por código de área

**Fecha:** 2026-06-26
**Estado:** Diseño aprobado, listo para plan
**Alcance:** Utilidad pura para validar un número de teléfono argentino que el contacto **escribe**
(ej "llamame al 11-2345-6789"), chequeando que el código de área sea real. NO valida el número de WhatsApp
del remitente (ese ya es válido por definición).

---

## 1. Problema y objetivo

Cuando un contacto da un número como texto para que lo llamen, hoy se guarda tal cual. Un número con un
código de área inexistente o mal tipeado es inútil para la operadora. Objetivo: discernir si un número AR
es válido por su **conformación** (código de área real + largo correcto) y dejar que el caller decida qué
hacer (volver a pedirlo). La utilidad NO bloquea ni escribe nada por su cuenta.

---

## 2. Decisiones (brainstorming)

- **Forma:** utilidad **pura** `validarTelefonoAR(texto) → { valido, normalizado, motivo? }`. El caller
  (agente/flujo) decide la acción.
- **Acción al fallar:** la define el caller. Integración inicial: en `AppointmentExecutor`, si el teléfono
  tipeado es inválido, se cae al número de WhatsApp del contacto (`context.phone`) — comportamiento que ya
  existe parcialmente (hoy solo chequea largo).

---

## 3. La utilidad

`server/src/utils/phone-ar.ts`:

```ts
export interface TelefonoARResult {
  valido: boolean;
  normalizado: string | null;   // '54' + 10 dígitos (sin 0, sin 15, sin 9), o null si inválido
  motivo?: string;              // 'area_desconocida' | 'largo_invalido' | 'vacio'
}

export function validarTelefonoAR(texto: string): TelefonoARResult;
```

### Normalización (antes de validar)
1. Quitar todo lo no-dígito.
2. Sacar prefijo internacional: si empieza con `54`, quitarlo (queda el número nacional).
3. Sacar `0` nacional inicial (ej `011...`) y `15` de móvil viejo donde aplique tras el área.
4. Sacar el `9` de móvil (consistente con `PhoneUtils.normalize`, que produce `54 + 10 dígitos`).
5. Resultado significativo esperado: **10 dígitos** = código de área (2–4) + abonado (6–8).

### Validación
- Largo significativo distinto de 10 → `{ valido:false, motivo:'largo_invalido' }`.
- Texto sin dígitos → `{ valido:false, motivo:'vacio' }`.
- Tomar el **código de área** como el prefijo más largo (4, luego 3, luego 2 dígitos) que pertenezca al set
  curado `AREA_CODES_AR`. Si ninguno matchea → `{ valido:false, motivo:'area_desconocida' }`.
- Si matchea → `{ valido:true, normalizado:'54'+diezDigitos }`.

### `AREA_CODES_AR` (set curado, editable)
Códigos de área AR. Mínimo viable (AMBA + capitales/principales), pensado para crecer:
- 2 dígitos: `11` (CABA + GBA).
- 3 dígitos (ejemplos): `220, 221, 223, 230, 236, 237, 261, 263, 264, 266, 280, 291, 297, 299, 341, 342,
  343, 351, 358, 362, 364, 370, 376, 379, 381, 383, 385, 387, 388`.
- 4 dígitos (ejemplos): `2202, 2227, 2241, 2245, 2257, 2266, 2271, 2274, 2281, 2284, 2286, 2291, 2292,
  2296, 2297, 2317, 2320, 2323, 2324, 2325, 2326, 2331, 2336, 2337, 2342, 2344, 2345, 2346, 2353, 2354,
  2355, 2356, 2358, 2362, 2364, 2365, 2371, 2392, 2393, 2394, 2395`.

(La lista es un punto de partida razonable; se amplía agregando entradas al set. No pretende ser exhaustiva
de las ~1000 áreas del país, pero cubre AMBA + Buenos Aires + principales.)

> **Nota de desambiguación:** un número que empieza con `11` (área de 2 díg) NO debe interpretarse como un
> área de 3/4 dígitos `11x`. La regla "prefijo más largo que esté en el set" resuelve esto siempre que el
> set no tenga colisiones falsas; el `11` se valida como CABA y los 8 dígitos restantes son el abonado.

---

## 4. Integración inicial

`server/src/core/executors/AppointmentExecutor.ts` ya hace:
```ts
if (String(telefono).replace(/\D/g, '').length < 8) { telefono = context.phone || telefono; }
```
Reemplazar/reforzar con la validación real: si `validarTelefonoAR(telefono).valido === false`, usar
`context.phone` (el número de WhatsApp, que siempre es válido). Si es válido, usar su `normalizado`.

Esto NO cambia el contrato del executor; solo mejora la decisión de qué teléfono guardar. Otros callers
futuros (captura de "número de callback" en el booking) pueden usar la misma utilidad.

---

## 5. Componentes y límites

| Unidad | Qué hace | Depende de |
|--------|----------|-----------|
| `utils/phone-ar.ts` | `validarTelefonoAR` + `AREA_CODES_AR` | — (pura) |
| `executors/AppointmentExecutor.ts` (edit) | usa la utilidad para elegir el teléfono | phone-ar |

---

## 6. Testing (TDD)

- `1123456789` (CABA, 10 díg) → válido, `normalizado='541123456789'`.
- Con prefijos: `+54 11 2345-6789`, `011 2345 6789`, `11 15 2345 6789`, `5491123456789` → todos válidos y
  normalizan al mismo `541123456789`.
- Área de 3 díg válida (ej `2214567890` → área `221` La Plata) → válido.
- Área inexistente (ej `9991234567`) → `{ valido:false, motivo:'area_desconocida' }`.
- Largo inválido (`12345`) → `{ valido:false, motivo:'largo_invalido' }`.
- Texto sin dígitos (`"no tengo"`) → `{ valido:false, motivo:'vacio' }`.
- Integración `AppointmentExecutor`: teléfono tipeado inválido → cae a `context.phone`.

---

## 7. Fuera de alcance

- Validación de números internacionales (no-AR). El estudio es AR; un no-AR se trata como inválido o se
  deja pasar el de WhatsApp.
- Verificar que el número exista de verdad (HLR lookup / llamada). Solo se valida la **conformación**.
- Lista exhaustiva de las ~1000 áreas del país (se entrega un set amplio pero ampliable).
