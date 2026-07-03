# Refinamiento "Pendientes de llamar" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a `/pendientes-llamar`: botón "Ir al chat", nombres limpios en todos los canales (nunca el PSID de Facebook), y estado persistente "llamado / no llamado" con filtro.

**Architecture:** El núcleo puro `PendienteEvaluator` gana una resolución de nombre anti-PSID. Una tabla nueva `contactos_llamados` (clave `account_id`+`telefono` real) persiste el estado; su presencia = "llamado". El endpoint list adjunta ese estado a cada fila; un endpoint nuevo `POST /marcar` lo togglea. La UI agrega columna Acciones (ir al chat + toggle) y filtro "Ocultar llamados". El inbox acepta deep-link por `conversation_id` para funcionar en FB/IG.

**Tech Stack:** TypeScript, Express, Supabase (Postgres), React, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-pendientes-llamar-refinamiento-design.md`

---

## File Structure

- **Create** `supabase/migrations/0035_contactos_llamados.sql` — tabla de estado llamado.
- **Modify** `server/src/core/callsheet/PendienteEvaluator.ts` — `nombreLimpio()` anti-PSID; campos `llamado*` en `FilaPendiente` con defaults.
- **Modify** `server/src/core/callsheet/__tests__/PendienteEvaluator.test.ts` — tests de nombre limpio.
- **Modify** `server/src/api/routes/pendientes.routes.ts` — `armarPendientes` acepta mapa de llamados; fetch de `contactos_llamados`; endpoint `POST /marcar`.
- **Modify** `server/src/api/routes/__tests__/pendientes.routes.test.ts` — test de merge de estado llamado.
- **Modify** `client/src/lib/api.ts` — campos `llamado*` en `FilaPendiente`; `pendientesApi.marcar()`.
- **Modify** `client/src/pages/PendientesLlamar.tsx` — columna Acciones (ir al chat + toggle), filtro "Ocultar llamados", CSV con columna Llamado.
- **Modify** `client/src/pages/WhatsAppInbox.tsx` — deep-link por `?conv=<conversation_id>`.

---

### Task 1: Migración `0035_contactos_llamados`

**Files:**
- Create: `supabase/migrations/0035_contactos_llamados.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0035: estado "llamado" de la planilla Pendientes de llamar. Idempotente.
-- Clave (account_id, telefono) = teléfono real normalizado (misma clave que el dedup
-- de PendienteEvaluator). La PRESENCIA de la fila significa "ya lo llamamos"; su
-- ausencia = "no llamado". No hace falta columna booleana.
CREATE TABLE IF NOT EXISTS contactos_llamados (
  account_id  text        NOT NULL,
  telefono    text        NOT NULL,
  llamado_at  timestamptz NOT NULL DEFAULT now(),
  llamado_por text,
  PRIMARY KEY (account_id, telefono)
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0035_contactos_llamados.sql
git commit -m "feat(callsheet): migración 0035 tabla contactos_llamados (estado llamado)"
```

> NOTA: aplicar en Supabase se hace en la Task 8 (verificación final), no acá.

---

### Task 2: `nombreLimpio()` anti-PSID en el núcleo puro

**Files:**
- Modify: `server/src/core/callsheet/PendienteEvaluator.ts`
- Test: `server/src/core/callsheet/__tests__/PendienteEvaluator.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `PendienteEvaluator.test.ts` (importar `nombreLimpio` en la línea 2 del archivo: cambiar el import a
`import { evaluarPendiente, resolveCallablePhone, claveCita, nombreLimpio, type ConversationRow, type ContactMemoryRow } from '../PendienteEvaluator';`):

```typescript
describe('nombreLimpio', () => {
  it('usa contact_name cuando es un nombre real', () => {
    expect(nombreLimpio(baseConv({ contact_name: 'Juan Perez' }), null)).toBe('Juan Perez');
  });
  it('descarta un contact_name tipo-PSID (numérico largo) y cae al slot nombre', () => {
    const conv = baseConv({ channel: 'facebook', contact_name: '24678901234567890' });
    const contact: ContactMemoryRow = { dialogue_state: { slots: { nombre: { valor: 'María López' } } } } as any;
    expect(nombreLimpio(conv, contact)).toBe('María López');
  });
  it('cae a calificacion.datos.nombre si no hay contact_name ni slot', () => {
    const conv = baseConv({ channel: 'facebook', contact_name: null });
    const contact: ContactMemoryRow = { calificacion: { jubilacion: { datos: { nombre: 'Pedro Gómez' } } } } as any;
    expect(nombreLimpio(conv, contact)).toBe('Pedro Gómez');
  });
  it('cae a current_thread.datos_parciales.nombre como último recurso', () => {
    const conv = baseConv({ channel: 'instagram', contact_name: null });
    const contact: ContactMemoryRow = { current_thread: { datos_parciales: { nombre: 'Ana Ruiz' } } } as any;
    expect(nombreLimpio(conv, contact)).toBe('Ana Ruiz');
  });
  it('devuelve null cuando no hay ningún nombre real (sólo PSID)', () => {
    const conv = baseConv({ channel: 'facebook', contact_name: '24678901234567890' });
    expect(nombreLimpio(conv, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd server && npx vitest run src/core/callsheet/__tests__/PendienteEvaluator.test.ts`
Expected: FAIL — `nombreLimpio is not a function` / no exportada.

- [ ] **Step 3: Implementar `nombreLimpio` y usarla en `evaluarPendiente`**

En `PendienteEvaluator.ts`, agregar el tipo `nombre` a `calificacion` y `datos_parciales` en `ContactMemoryRow` (ya son `Record`/`any`, no requieren cambio). Agregar esta función después de `telefonoDesdeMemoria` (después de la línea 66):

```typescript
/** ¿El valor parece un PSID de FB/IG (todo dígitos y largo)? No sirve como nombre. */
function esPsid(v: string): boolean {
  return /^\d{11,}$/.test(v);
}

/** Nombre real del contacto en cualquier canal, nunca el PSID de FB. null si no hay. */
export function nombreLimpio(conversation: ConversationRow, contact: ContactMemoryRow | null): string | null {
  const candidatos: Array<string | null> = [
    strOrNull(conversation.contact_name),
    strOrNull(contact?.dialogue_state?.slots?.nombre?.valor),
  ];
  if (contact?.calificacion) {
    for (const entry of Object.values(contact.calificacion)) {
      candidatos.push(strOrNull((entry as any)?.datos?.nombre));
    }
  }
  candidatos.push(strOrNull(contact?.current_thread?.datos_parciales?.nombre as unknown));
  for (const c of candidatos) {
    if (c && !esPsid(c)) return c;
  }
  return null;
}
```

Reemplazar la línea 109 (`const nombre = strOrNull(conversation.contact_name) ?? ...`) por:

```typescript
  const nombre = nombreLimpio(conversation, contact);
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd server && npx vitest run src/core/callsheet/__tests__/PendienteEvaluator.test.ts`
Expected: PASS (todos, incluidos los previos).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/callsheet/PendienteEvaluator.ts server/src/core/callsheet/__tests__/PendienteEvaluator.test.ts
git commit -m "feat(callsheet): nombre limpio anti-PSID en todos los canales"
```

---

### Task 3: Campos `llamado*` en `FilaPendiente` + merge en `armarPendientes`

**Files:**
- Modify: `server/src/core/callsheet/PendienteEvaluator.ts`
- Modify: `server/src/api/routes/pendientes.routes.ts`
- Test: `server/src/api/routes/__tests__/pendientes.routes.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `pendientes.routes.test.ts` dentro del `describe('armarPendientes', ...)`:

```typescript
  it('marca llamado=true cuando el teléfono está en el mapa de llamados', () => {
    const conversations: ConversationRow[] = [
      conv({ id: 'c1', phone: '5492215093499' }),
      conv({ id: 'c2', phone: '5491155667788' }),
    ];
    const llamados = new Map<string, { llamado_at: string; llamado_por: string | null }>([
      ['a1|542215093499', { llamado_at: '2026-07-03T10:00:00Z', llamado_por: 'Estela' }],
    ]);
    const filas = armarPendientes(conversations, new Map(), [], llamados);
    const c1 = filas.find((f) => f.telefono === '542215093499')!;
    const c2 = filas.find((f) => f.telefono === '541155667788')!;
    expect(c1.llamado).toBe(true);
    expect(c1.llamado_por).toBe('Estela');
    expect(c2.llamado).toBe(false);
    expect(c2.llamado_at).toBeNull();
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd server && npx vitest run src/api/routes/__tests__/pendientes.routes.test.ts`
Expected: FAIL — `armarPendientes` espera 3 args / `llamado` no existe en `FilaPendiente`.

- [ ] **Step 3: Extender `FilaPendiente` y `evaluarPendiente` con defaults**

En `PendienteEvaluator.ts`, agregar a la interfaz `FilaPendiente` (después de `account_id: string;`):

```typescript
  llamado: boolean;                 // true si ya lo llamamos (presencia en contactos_llamados)
  llamado_at: string | null;
  llamado_por: string | null;
```

En el objeto que retorna `evaluarPendiente` (después de `account_id: conversation.account_id,`), agregar los defaults:

```typescript
    llamado: false,
    llamado_at: null,
    llamado_por: null,
```

- [ ] **Step 4: Extender `armarPendientes` con el mapa de llamados**

En `pendientes.routes.ts`, cambiar la firma y el cuerpo de `armarPendientes`:

```typescript
export function armarPendientes(
  conversations: ConversationRow[],
  contactsByConvId: Map<string, ContactMemoryRow>,
  appointments: Array<{ phone: string | null; telefono: string | null }>,
  llamados: Map<string, { llamado_at: string; llamado_por: string | null }> = new Map(),
): FilaPendiente[] {
  const phonesConCita = new Set<string>();
  for (const a of appointments) {
    const k1 = claveCita(a.phone); if (k1) phonesConCita.add(k1);
    const k2 = claveCita(a.telefono); if (k2) phonesConCita.add(k2);
  }
  const vistos = new Set<string>();
  const filas: FilaPendiente[] = [];
  for (const c of conversations) {
    const fila = evaluarPendiente({ conversation: c, contact: contactsByConvId.get(c.id) ?? null, phonesConCita });
    if (!fila) continue;
    if (vistos.has(fila.telefono)) continue;
    vistos.add(fila.telefono);
    const hit = llamados.get(`${fila.account_id}|${fila.telefono}`);
    if (hit) { fila.llamado = true; fila.llamado_at = hit.llamado_at; fila.llamado_por = hit.llamado_por; }
    filas.push(fila);
  }
  return filas;
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `cd server && npx vitest run src/api/routes/__tests__/pendientes.routes.test.ts`
Expected: PASS (nuevo test + el existente de dedup).

- [ ] **Step 6: Commit**

```bash
git add server/src/core/callsheet/PendienteEvaluator.ts server/src/api/routes/pendientes.routes.ts server/src/api/routes/__tests__/pendientes.routes.test.ts
git commit -m "feat(callsheet): FilaPendiente lleva estado llamado; armarPendientes lo mergea"
```

---

### Task 4: Endpoint list trae `contactos_llamados`

**Files:**
- Modify: `server/src/api/routes/pendientes.routes.ts`

- [ ] **Step 1: Fetch de `contactos_llamados` y pasarlo a `armarPendientes`**

En `pendientesRouter()`, dentro del handler `r.get('/', ...)`, después del bloque `// 3) appointments ...` (línea ~93) y antes de `let filas = armarPendientes(...)`, agregar:

```typescript
      // 3.5) Estado "llamado" (todas las filas, paginadas) → mapa por (account_id|telefono).
      const llamadosRows = await fetchAll<{ account_id: string; telefono: string; llamado_at: string; llamado_por: string | null }>((from, to) => {
        let q = supabase.from('contactos_llamados').select('account_id, telefono, llamado_at, llamado_por')
          .order('account_id', { ascending: true })
          .order('telefono', { ascending: true })
          .range(from, to);
        if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);
        return q;
      });
      const llamadosByKey = new Map<string, { llamado_at: string; llamado_por: string | null }>();
      for (const l of llamadosRows) llamadosByKey.set(`${l.account_id}|${l.telefono}`, { llamado_at: l.llamado_at, llamado_por: l.llamado_por });
```

Cambiar la línea `let filas = armarPendientes(conversations, contactsByConvId, appointments);` por:

```typescript
      let filas = armarPendientes(conversations, contactsByConvId, appointments, llamadosByKey);
```

- [ ] **Step 2: Verificar que compila y que los tests siguen verdes**

Run: `cd server && npx vitest run src/api/routes/__tests__/pendientes.routes.test.ts && npx tsc --noEmit`
Expected: PASS + sin errores de tipo.

- [ ] **Step 3: Commit**

```bash
git add server/src/api/routes/pendientes.routes.ts
git commit -m "feat(callsheet): list de pendientes adjunta estado llamado"
```

---

### Task 5: Endpoint `POST /api/pendientes-llamar/marcar`

**Files:**
- Modify: `server/src/api/routes/pendientes.routes.ts`

- [ ] **Step 1: Agregar el handler `POST /marcar`**

En `pendientesRouter()`, después del cierre del handler `r.get('/', ...)` (después de su `});`) y antes de `return r;`, agregar:

```typescript
  // Togglea el estado "llamado" de un contacto (por account_id + teléfono real).
  r.post('/marcar', async (req, res) => {
    try {
      const { account_id, telefono, llamado } = req.body ?? {};
      if (!account_id || !telefono) return res.status(400).json({ error: 'account_id y telefono son obligatorios' });

      if (llamado === false) {
        const { error } = await supabase.from('contactos_llamados')
          .delete().eq('account_id', account_id).eq('telefono', telefono);
        if (error) throw new Error(error.message);
        return res.json({ ok: true, llamado: false });
      }

      const llamado_por = req.user?.name ?? req.user?.id ?? null;
      const { error } = await supabase.from('contactos_llamados')
        .upsert({ account_id, telefono, llamado_at: new Date().toISOString(), llamado_por }, { onConflict: 'account_id,telefono' });
      if (error) throw new Error(error.message);
      res.json({ ok: true, llamado: true, llamado_por });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? 'error' });
    }
  });
```

- [ ] **Step 2: Verificar que compila**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add server/src/api/routes/pendientes.routes.ts
git commit -m "feat(callsheet): POST /pendientes-llamar/marcar (togglea llamado)"
```

> Verificación funcional del endpoint contra la DB real va en la Task 8.

---

### Task 6: Cliente API — tipos + `marcar()`

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Extender `FilaPendiente` y `pendientesApi`**

En `client/src/lib/api.ts`, agregar a la interfaz `FilaPendiente` (después de `account_id: string;`):

```typescript
  llamado: boolean;
  llamado_at: string | null;
  llamado_por: string | null;
```

Agregar el método `marcar` dentro de `pendientesApi` (después del método `list`):

```typescript
  marcar: (params: { accountId: string; telefono: string; llamado: boolean }) =>
    api<{ ok: boolean; llamado: boolean; llamado_por?: string | null }>(
      '/api/pendientes-llamar/marcar',
      { method: 'POST', body: JSON.stringify({ account_id: params.accountId, telefono: params.telefono, llamado: params.llamado }) }),
```

- [ ] **Step 2: Verificar que compila**

Run: `cd client && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(callsheet): cliente api con estado llamado + marcar()"
```

---

### Task 7: UI — columna Acciones, filtro "Ocultar llamados", inbox deep-link

**Files:**
- Modify: `client/src/pages/PendientesLlamar.tsx`
- Modify: `client/src/pages/WhatsAppInbox.tsx`

- [ ] **Step 1: Inbox acepta `?conv=<conversation_id>`**

En `client/src/pages/WhatsAppInbox.tsx`, en el `useEffect` de deep-link (línea 188-204), reemplazar el cuerpo para soportar primero `conv` (por id) y mantener el fallback `phone`:

```typescript
  useEffect(() => {
    const convId = searchParams.get('conv');
    const ph = searchParams.get('phone');
    if ((!convId && !ph) || deepLinkedRef.current || conversations.length === 0) return;
    deepLinkedRef.current = true;
    let match = convId ? conversations.find(c => c.id === convId) : undefined;
    if (!match && ph) {
      const acc = searchParams.get('account');
      const target = normPhone(ph);
      match =
        conversations.find(c => normPhone(c.phone) === target && (!acc || c.account_id === acc)) ||
        conversations.find(c => normPhone(c.phone) === target);
    }
    if (match) {
      setActiveConvo(match);
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      toast.error('No hay conversación con este contacto');
    }
    setSearchParams({}, { replace: true });
  }, [conversations, searchParams, setSearchParams]);
```

También, en el `useEffect` de "forzar bandeja unificada" (línea 183-187), cambiar la condición para que también dispare con `conv`:

```typescript
  useEffect(() => {
    if (searchParams.get('phone') || searchParams.get('conv')) setAllLines(true);
    // sólo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 2: Añadir estado local de filtro y handler de marcar en `PendientesLlamar.tsx`**

En `PendientesLlamar.tsx`, añadir el import de `Link`:

```typescript
import { Link } from 'react-router-dom';
```

Añadir estado y handler dentro del componente (después de `const [calif, setCalif] = useState('all');`, línea 51):

```typescript
  const [ocultarLlamados, setOcultarLlamados] = useState(true);

  const toggleLlamado = async (f: FilaPendiente) => {
    const nuevo = !f.llamado;
    // Optimista: actualizo la fila en memoria; si falla, revierto.
    setFilas((prev) => prev.map((x) => x.conversation_id === f.conversation_id
      ? { ...x, llamado: nuevo, llamado_at: nuevo ? new Date().toISOString() : null } : x));
    try {
      await pendientesApi.marcar({ accountId: f.account_id, telefono: f.telefono, llamado: nuevo });
    } catch {
      setFilas((prev) => prev.map((x) => x.conversation_id === f.conversation_id ? { ...x, llamado: f.llamado, llamado_at: f.llamado_at } : x));
    }
  };
```

Actualizar el `useMemo` de `visibles` para aplicar el filtro de llamados:

```typescript
  const visibles = useMemo(() => filas.filter((f) =>
    (canal === 'all' || f.canal === canal) &&
    (calif === 'all' || f.calificacion === calif) &&
    (!ocultarLlamados || !f.llamado)
  ), [filas, canal, calif, ocultarLlamados]);
```

- [ ] **Step 3: Añadir el checkbox del filtro en la barra de filtros**

Dentro del `<div className="flex flex-wrap gap-2 mb-4 text-sm">` (después del `<select>` de calificación, antes de cerrar el div, línea ~90), agregar:

```tsx
        <label className="flex items-center gap-2 px-2 py-1 select-none">
          <input type="checkbox" checked={ocultarLlamados} onChange={(e) => setOcultarLlamados(e.target.checked)} />
          Ocultar llamados
        </label>
```

- [ ] **Step 4: Añadir la columna "Acciones" al header y a cada fila**

En el header (línea 100), cambiar el array por:

```tsx
                {['Teléfono', 'Nombre', 'Canal', 'Área', 'Calificación', 'Estado', 'Tema', 'Fecha', 'Acciones'].map((h) => (
```

Cambiar la clase de la fila para atenuar los llamados (línea 107):

```tsx
                <tr key={f.conversation_id} className={`border-t hover:bg-brand-panel/50 ${f.llamado ? 'opacity-50' : ''}`}>
```

Cambiar la celda de Nombre (línea 111) para mostrar "Sin nombre" en gris:

```tsx
                  <td className="px-3 py-2 whitespace-nowrap">{f.nombre ?? <span className="text-brand-inkmuted italic">Sin nombre</span>}</td>
```

Agregar la celda de Acciones al final de la fila, después de la celda de Fecha (después de la línea 117):

```tsx
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Link to={`/inbox?conv=${f.conversation_id}`} className="text-brand-primary hover:underline">Ir al chat</Link>
                      <button
                        onClick={() => toggleLlamado(f)}
                        title={f.llamado && f.llamado_por ? `Llamado por ${f.llamado_por}` : ''}
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${f.llamado ? 'bg-green-100 text-green-800' : 'bg-brand-gold text-brand-ink'}`}
                      >{f.llamado ? '✓ Llamado' : '☎ Marcar llamado'}</button>
                    </div>
                  </td>
```

Cambiar el `colSpan={8}` del estado vacío (línea 121) a `colSpan={9}`.

- [ ] **Step 5: Añadir la columna "Llamado" al CSV**

En `toCSV` (líneas 22-33), cambiar el `head` y las `rows`:

```typescript
  const head = ['Telefono', 'Nombre', 'Canal', 'Area', 'Calificacion', 'Estado', 'Ultimo tema', 'Ultimo mensaje', 'Fecha', 'Llamado'];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = filas.map((f) => [
    `\t${f.telefono}`,
    f.nombre ?? '', CANAL_LABELS[f.canal] ?? f.canal, f.area ? (AREA_LABELS[f.area] ?? f.area) : '',
    f.calificacion ? (CALIF_LABELS[f.calificacion] ?? f.calificacion) : '',
    f.estado, f.tema ?? '', (f.ultimo_mensaje ?? '').replace(/\s+/g, ' ').slice(0, 200), fmtFecha(f.fecha),
    f.llamado ? `sí (${fmtFecha(f.llamado_at)})` : 'no',
  ].map((c) => esc(String(c))).join(','));
```

- [ ] **Step 6: Verificar que compila y correr los tests del cliente**

Run: `cd client && npx tsc --noEmit && npm run build`
Expected: build OK, sin errores de tipo.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/PendientesLlamar.tsx client/src/pages/WhatsAppInbox.tsx
git commit -m "feat(callsheet): UI ir al chat + toggle llamado + filtro ocultar llamados"
```

---

### Task 8: Verificación end-to-end + aplicar migración

**Files:** (ninguno — verificación)

- [ ] **Step 1: Aplicar la migración 0035 en Supabase**

Aplicar `supabase/migrations/0035_contactos_llamados.sql` en la base (mismo procedimiento que las migraciones previas del proyecto). Confirmar que la tabla `contactos_llamados` existe.

- [ ] **Step 2: Correr toda la suite del server**

Run: `cd server && npx vitest run`
Expected: PASS, sin regresiones (los tests previos + los nuevos de nombre limpio y estado llamado).

- [ ] **Step 3: Verificar el endpoint `marcar` contra la DB**

Con el server corriendo y un token válido, marcar y desmarcar un contacto de prueba:

```bash
# Marcar (reemplazar <TOKEN>, <ACCOUNT_ID>, <TELEFONO>)
curl -s -X POST http://localhost:3001/api/pendientes-llamar/marcar \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"account_id":"<ACCOUNT_ID>","telefono":"<TELEFONO>","llamado":true}'
# Esperado: {"ok":true,"llamado":true,"llamado_por":"..."}

# Desmarcar
curl -s -X POST http://localhost:3001/api/pendientes-llamar/marcar \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"account_id":"<ACCOUNT_ID>","telefono":"<TELEFONO>","llamado":false}'
# Esperado: {"ok":true,"llamado":false}
```

- [ ] **Step 4: Verificación manual en el panel**

1. Abrir `/pendientes-llamar`. Confirmar: filas de Facebook/Instagram muestran nombre real o "Sin nombre" — **nunca** un número largo/PSID en la columna Nombre.
2. "Ir al chat" en una fila de WhatsApp y en una de FB/IG → abre la conversación correcta en el inbox.
3. "☎ Marcar llamado" → la fila queda atenuada y con "✓ Llamado"; al recargar sigue marcada.
4. Con "Ocultar llamados" tildado (default), la fila marcada desaparece; al destildar, reaparece atenuada.
5. Exportar CSV → incluye la columna "Llamado" con sí/no + fecha.

- [ ] **Step 5: Commit final (si hubo ajustes de verificación)**

```bash
git add -A
git commit -m "chore(callsheet): verificación end-to-end refinamiento pendientes"
```

---

## Notas de implementación

- **Clave del estado = teléfono real normalizado**, no `conversation_id`. Es intencional: "no volver a escribirle a esta persona" es por número, cruza conversaciones/canales y sobrevive a cambios de dedup.
- **`llamado_por`** sale de `req.user` (`name` o `id`). El endpoint ya está detrás de `authContext`.
- **Fuera de alcance:** RBAC por rol (sin cambios), regla de inclusión y dedup (sin cambios).
