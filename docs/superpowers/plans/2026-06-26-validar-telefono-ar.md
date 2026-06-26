# Validar teléfono AR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Utilidad pura `validarTelefonoAR(texto)` que valida un número argentino que el contacto escribe (código de área real + largo correcto) y devuelve el normalizado; integrarla en `AppointmentExecutor` para no guardar números basura.

**Architecture:** Un módulo puro sin efectos (`phone-ar.ts`) con un set curado de códigos de área AR y la función de validación/normalización. La única integración cambia una línea de decisión en `AppointmentExecutor`.

**Tech Stack:** Node/TypeScript, vitest. Branch `feat-omnichannel`. Correr `npx vitest run <path>` desde `server/`.

---

## File Structure
- `server/src/utils/phone-ar.ts` — `validarTelefonoAR` + `AREA_CODES_AR`.
- `server/src/utils/__tests__/phone-ar.test.ts` — tests.
- `server/src/core/executors/AppointmentExecutor.ts` — usar la utilidad (edit puntual).

---

## Task 1: Utilidad `validarTelefonoAR`

**Files:**
- Create: `server/src/utils/phone-ar.ts`
- Test: `server/src/utils/__tests__/phone-ar.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
import { describe, it, expect } from 'vitest';
import { validarTelefonoAR } from '../phone-ar';

describe('validarTelefonoAR', () => {
  it('CABA 10 dígitos → válido y normaliza a 54 + 10', () => {
    const r = validarTelefonoAR('1123456789');
    expect(r.valido).toBe(true);
    expect(r.normalizado).toBe('541123456789');
  });

  it('tolera prefijos +54 / 0 / 15 / 9 y normaliza al mismo número', () => {
    for (const t of ['+54 11 2345-6789', '011 2345 6789', '11 15 2345 6789', '5491123456789', '+5491123456789']) {
      const r = validarTelefonoAR(t);
      expect(r.valido, t).toBe(true);
      expect(r.normalizado, t).toBe('541123456789');
    }
  });

  it('área de 3 dígitos válida (La Plata 221)', () => {
    const r = validarTelefonoAR('2214567890');
    expect(r.valido).toBe(true);
    expect(r.normalizado).toBe('542214567890');
  });

  it('código de área inexistente → inválido (area_desconocida)', () => {
    const r = validarTelefonoAR('9991234567');
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe('area_desconocida');
  });

  it('largo inválido → largo_invalido', () => {
    expect(validarTelefonoAR('12345').motivo).toBe('largo_invalido');
  });

  it('sin dígitos → vacio', () => {
    expect(validarTelefonoAR('no tengo').motivo).toBe('vacio');
    expect(validarTelefonoAR('').motivo).toBe('vacio');
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd server && npx vitest run src/utils/__tests__/phone-ar.test.ts`
Expected: FAIL — "Cannot find module '../phone-ar'".

- [ ] **Step 3: Implementar**

```ts
export interface TelefonoARResult {
  valido: boolean;
  normalizado: string | null;   // '54' + 10 dígitos, o null si inválido
  motivo?: 'area_desconocida' | 'largo_invalido' | 'vacio';
}

// Códigos de área AR (set curado, ampliable). 2 díg = CABA/GBA; 3 y 4 díg = resto.
export const AREA_CODES_AR: ReadonlySet<string> = new Set<string>([
  // 2 dígitos
  '11',
  // 3 dígitos (principales)
  '220', '221', '223', '230', '236', '237', '249', '261', '263', '264', '266', '280', '291', '297', '299',
  '336', '341', '342', '343', '345', '348', '351', '353', '358', '362', '364', '370', '376', '379',
  '381', '383', '385', '387', '388',
  // 4 dígitos (Buenos Aires y otras)
  '2202', '2221', '2223', '2224', '2225', '2226', '2227', '2229', '2241', '2242', '2243', '2244', '2245',
  '2246', '2252', '2254', '2255', '2257', '2261', '2262', '2264', '2265', '2266', '2267', '2271', '2272',
  '2273', '2274', '2281', '2283', '2284', '2285', '2286', '2291', '2292', '2296', '2297',
  '2314', '2316', '2317', '2320', '2323', '2324', '2325', '2326', '2331', '2333', '2335', '2336', '2337',
  '2338', '2342', '2343', '2344', '2345', '2346', '2352', '2353', '2354', '2355', '2356', '2357', '2358',
  '2361', '2362', '2363', '2364', '2365', '2392', '2393', '2394', '2395', '2396',
]);

/** Deja solo el "número nacional significativo": sin +54, sin 0, sin 9, sin 15. */
function nacionalSignificativo(digits: string): string {
  let d = digits;
  if (d.startsWith('54')) d = d.slice(2);   // país
  if (d.startsWith('0')) d = d.slice(1);    // 0 nacional
  if (d.startsWith('9')) d = d.slice(1);    // 9 móvil
  // 15 móvil viejo: aparece DESPUÉS del área. Lo resolvemos al separar área (abajo).
  return d;
}

/** Valida un teléfono AR por conformación (código de área real + largo). Pura. */
export function validarTelefonoAR(texto: string): TelefonoARResult {
  const digits = (texto || '').replace(/\D/g, '');
  if (!digits) return { valido: false, normalizado: null, motivo: 'vacio' };

  let d = nacionalSignificativo(digits);

  // Probar el código de área más largo primero (4 → 3 → 2).
  for (const len of [4, 3, 2]) {
    const area = d.slice(0, len);
    if (!AREA_CODES_AR.has(area)) continue;
    let resto = d.slice(len);
    if (resto.startsWith('15')) resto = resto.slice(2); // 15 móvil viejo tras el área
    const total = area + resto;
    // Número nacional AR (sin 0/9/15) = 10 dígitos: área + abonado.
    if (total.length === 10) return { valido: true, normalizado: '54' + total };
  }

  // Si llegó acá: o el largo no cierra, o ningún área matchea.
  if (d.replace(/^15/, '').length < 8 || d.length > 12) {
    return { valido: false, normalizado: null, motivo: 'largo_invalido' };
  }
  return { valido: false, normalizado: null, motivo: 'area_desconocida' };
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd server && npx vitest run src/utils/__tests__/phone-ar.test.ts`
Expected: PASS (6 tests). Si algún caso de prefijo falla, revisar el orden de pelado en
`nacionalSignificativo` (país→0→9) y el manejo del `15` tras el área; NO cambiar los tests.

- [ ] **Step 5: Type-check + commit**

Run: `cd server && npx tsc --noEmit` (clean).

```bash
git add src/utils/phone-ar.ts src/utils/__tests__/phone-ar.test.ts
git commit -m "feat(telefono): validarTelefonoAR (código de área + normalización)"
```

---

## Task 2: Integrar en `AppointmentExecutor`

**Files:**
- Modify: `server/src/core/executors/AppointmentExecutor.ts` (la resolución de `telefono`, ~líneas 47-53)

- [ ] **Step 1: Leer el bloque actual**

En `AppointmentExecutor.execute(...)` hay (cerca del inicio):
```ts
        const nombre = resolveVar(context, nodeData.nombreVar, 'nombre');
        let telefono = resolveVar(context, nodeData.telefonoVar, 'telefono') || context.phone || '';
        // "este", "el mismo", "del que te escribo", etc.: no es un número → usar el de
        // WhatsApp desde el que escribe (context.phone).
        if (String(telefono).replace(/\D/g, '').length < 8) {
            telefono = context.phone || telefono;
        }
```

- [ ] **Step 2: Importar la utilidad**

Al inicio del archivo, junto a los otros imports, agregar:
```ts
import { validarTelefonoAR } from '../../utils/phone-ar';
```

- [ ] **Step 3: Reemplazar el chequeo de largo por validación real**

Reemplazar el bloque `if (String(telefono).replace(/\D/g, '').length < 8) { ... }` por:
```ts
        // Validar por conformación (código de área AR). Si el cliente escribió un número
        // inválido o una referencia ("el mismo", "este"), usamos el de WhatsApp (context.phone).
        const tel = validarTelefonoAR(String(telefono));
        if (tel.valido && tel.normalizado) {
            telefono = tel.normalizado;
        } else {
            telefono = context.phone || telefono;
        }
```

- [ ] **Step 4: Type-check**

Run: `cd server && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Correr los tests del executor (no deben romperse)**

Run: `cd server && npx vitest run src/core/executors`
Expected: los tests existentes del executor siguen pasando (los 2 fallos pre-existentes de
AppointmentProposalsExecutor/AppointmentAvailabilityExecutor son ajenos a este cambio).

- [ ] **Step 6: Commit**

```bash
git add src/core/executors/AppointmentExecutor.ts
git commit -m "feat(telefono): AppointmentExecutor valida el teléfono tipeado (cae a WhatsApp si inválido)"
```

---

## Task 3: Verificación

- [ ] **Step 1: Suite de la feature + tsc**

Run: `cd server && npx vitest run src/utils/__tests__/phone-ar.test.ts && npx tsc --noEmit`
Expected: 6 verdes, tsc limpio.

- [ ] **Step 2: Suite completa**

Run: `cd server && npx vitest run`
Expected: solo fallan los 6 pre-existentes (AppointmentProposalsExecutor / AppointmentAvailabilityExecutor); el resto verde.

---

## Notas para el ejecutor
- TDD estricto en `phone-ar` (rojo→verde). NO modificar los tests para que pasen: si un caso de prefijo
  falla, ajustar la lógica de pelado/`15`.
- La integración en `AppointmentExecutor` es un cambio mínimo de una decisión; no refactorizar el resto.
- Los 6 tests que ya fallaban son pre-existentes y ajenos.
