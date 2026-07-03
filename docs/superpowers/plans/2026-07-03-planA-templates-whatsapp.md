# Plan A — Capa de templates de WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir enviar mensajes proactivos de WhatsApp fuera de la ventana de 24hs usando templates aprobados por Meta (HSM).

**Architecture:** Un registro de templates (clave lógica → nombre Meta + idioma + builder de `components`/preview), un método `sendTemplate` en el cliente Cloud API que postea `type:'template'` a la Graph API, y ruteo en `AccountManager.sendTemplate`. Sin UI ni DB: los templates son constantes en código; el usuario los da de alta en Meta con los mismos nombres.

**Tech Stack:** TypeScript, Express, axios, WhatsApp Cloud API (Graph v21.0), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-recordatorios-seguimiento-docs-design.md`

---

## File Structure

- **Create** `server/src/services/whatsappTemplates.ts` — registro puro de templates + builders de `components`/preview.
- **Create** `server/src/services/__tests__/whatsappTemplates.test.ts` — tests de los builders.
- **Modify** `server/src/infrastructure/meta/WhatsAppOfficialClient.ts` — método `sendTemplate`.
- **Modify** `server/src/infrastructure/meta/__tests__/WhatsAppOfficialClient.test.ts` — test del payload de template.
- **Modify** `server/src/core/accounts/AccountManager.ts` — método `sendTemplate` (ruteo).

---

### Task 1: Registro de templates (puro)

**Files:**
- Create: `server/src/services/whatsappTemplates.ts`
- Test: `server/src/services/__tests__/whatsappTemplates.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `server/src/services/__tests__/whatsappTemplates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTemplate, TEMPLATES } from '../whatsappTemplates';

describe('whatsappTemplates', () => {
  it('reminder_24h arma components y preview con los 4 params en orden', () => {
    const r = buildTemplate('reminder_24h', ['María', 'martes 8/7', '15:30', 'Sede Centro']);
    expect(r.name).toBe(TEMPLATES.reminder_24h.metaName);
    expect(r.lang).toBe(TEMPLATES.reminder_24h.lang);
    expect(r.components).toEqual([
      { type: 'body', parameters: [
        { type: 'text', text: 'María' },
        { type: 'text', text: 'martes 8/7' },
        { type: 'text', text: '15:30' },
        { type: 'text', text: 'Sede Centro' },
      ] },
    ]);
    expect(r.preview).toContain('María');
    expect(r.preview).toContain('15:30');
  });

  it('seguimiento usa 1 param', () => {
    const r = buildTemplate('seguimiento', ['Juan']);
    expect(r.components[0].parameters).toEqual([{ type: 'text', text: 'Juan' }]);
    expect(r.preview).toContain('Juan');
  });

  it('docs_pendientes mete la lista de docs como 2do param', () => {
    const r = buildTemplate('docs_pendientes', ['Ana', 'DNI, recibos']);
    expect(r.components[0].parameters[1]).toEqual({ type: 'text', text: 'DNI, recibos' });
  });

  it('rechaza cantidad de params incorrecta', () => {
    expect(() => buildTemplate('reminder_24h', ['solo uno'])).toThrow();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd server && npx vitest run src/services/__tests__/whatsappTemplates.test.ts`
Expected: FAIL — `Cannot find module '../whatsappTemplates'`.

- [ ] **Step 3: Implementar el registro**

Crear `server/src/services/whatsappTemplates.ts`:

```typescript
// Registro de templates de WhatsApp (HSM). Las claves lógicas las usa el scheduler;
// `metaName`/`lang` DEBEN coincidir con lo aprobado en Meta Business. Sin DB ni UI.
export interface TemplateComponent {
  type: 'body';
  parameters: Array<{ type: 'text'; text: string }>;
}
export interface BuiltTemplate {
  name: string;        // nombre aprobado en Meta
  lang: string;        // código de idioma (ej 'es_AR')
  components: TemplateComponent[];
  preview: string;     // texto renderizado, para guardar en el historial del inbox
}
interface TemplateDef {
  metaName: string;
  lang: string;
  paramCount: number;
  render: (p: string[]) => string; // preview legible
}

const LANG = 'es_AR'; // ⚠️ ajustar si Meta aprobó con otro código (ej 'es')

export const TEMPLATES = {
  reminder_24h: {
    metaName: 'recordatorio_cita_24h', lang: LANG, paramCount: 4,
    render: (p) => `Hola ${p[0]}, te recordamos tu cita en el estudio para el ${p[1]} a las ${p[2]} hs (${p[3]}). Si necesitás reprogramar, respondé este mensaje.`,
  },
  seguimiento: {
    metaName: 'seguimiento_post_cita', lang: LANG, paramCount: 1,
    render: (p) => `Hola ${p[0]}, gracias por tu visita. Quedamos a disposición por cualquier consulta sobre tu trámite. Si querés avanzar, respondé este mensaje.`,
  },
  reagendar: {
    metaName: 'reagendar_no_asistio', lang: LANG, paramCount: 2,
    render: (p) => `Hola ${p[0]}, no pudimos verte en tu cita del ${p[1]}. ¿Reprogramamos? Respondé este mensaje y coordinamos un nuevo turno.`,
  },
  docs_pendientes: {
    metaName: 'documentacion_pendiente', lang: LANG, paramCount: 2,
    render: (p) => `Hola ${p[0]}, para avanzar con tu trámite necesitamos: ${p[1]}. Podés acercarla al estudio o enviarla por este chat.`,
  },
} satisfies Record<string, TemplateDef>;

export type TemplateKey = keyof typeof TEMPLATES;

export function buildTemplate(key: TemplateKey, params: string[]): BuiltTemplate {
  const def = TEMPLATES[key];
  if (params.length !== def.paramCount) {
    throw new Error(`template ${key} espera ${def.paramCount} params, recibió ${params.length}`);
  }
  return {
    name: def.metaName,
    lang: def.lang,
    components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
    preview: def.render(params),
  };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd server && npx vitest run src/services/__tests__/whatsappTemplates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/whatsappTemplates.ts server/src/services/__tests__/whatsappTemplates.test.ts
git commit -m "feat(templates): registro de templates WhatsApp + builders"
```

---

### Task 2: `sendTemplate` en el cliente Cloud API

**Files:**
- Modify: `server/src/infrastructure/meta/WhatsAppOfficialClient.ts`
- Test: `server/src/infrastructure/meta/__tests__/WhatsAppOfficialClient.test.ts`

- [ ] **Step 1: Leer el patrón existente**

Leé `WhatsAppOfficialClient.ts:41-90` (`sendMessage`) y `WhatsAppOfficialClient.test.ts` completo para copiar EXACTAMENTE cómo se mockea axios y cómo se llama al store. `sendTemplate` sigue el mismo patrón: `withRetry(() => axios.post(...))` + `store.record({ direction:'OUTBOUND', ... })`.

- [ ] **Step 2: Escribir el test que falla**

Agregar a `WhatsAppOfficialClient.test.ts` un test (adaptando el mock de axios del archivo existente). El test verifica que `sendTemplate('549…', 'recordatorio_cita_24h', 'es_AR', components, 'preview…')` hace `axios.post` a `.../<phone_number_id>/messages` con body `type:'template'` y `template:{name, language:{code}, components}`:

```typescript
it('sendTemplate postea type:template a la Graph API', async () => {
  // (usar el mismo setup de mock de axios que los otros tests de este archivo)
  const components = [{ type: 'body', parameters: [{ type: 'text', text: 'María' }] }];
  await client.sendTemplate('5492215093499', 'recordatorio_cita_24h', 'es_AR', components as any, 'Hola María…');
  const [, body] = (mockedAxios.post as any).mock.calls.at(-1);
  expect(body.type).toBe('template');
  expect(body.template).toEqual({
    name: 'recordatorio_cita_24h',
    language: { code: 'es_AR' },
    components,
  });
  expect(body.to).toBe('5492215093499');
});
```
(Ajustar `client`, `mockedAxios` a como estén nombrados en el archivo real.)

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `cd server && npx vitest run src/infrastructure/meta/__tests__/WhatsAppOfficialClient.test.ts`
Expected: FAIL — `client.sendTemplate is not a function`.

- [ ] **Step 4: Implementar `sendTemplate`**

En `WhatsAppOfficialClient.ts`, agregar el método después de `sendMessage` (usa las mismas constantes `GRAPH_BASE`, `this.config`, `withRetry`, `this.store` que `sendMessage`):

```typescript
  async sendTemplate(
    to: string,
    name: string,
    lang: string,
    components: unknown[],
    preview?: string,
  ): Promise<void> {
    if (!this.config.accessToken || !this.config.phone_number_id) {
      logger.warn(`[WhatsAppOfficialClient:${this.accountId}] Falta accessToken o phone_number_id, no se puede enviar template.`);
      return;
    }
    const cleanPhone = to.replace('@s.whatsapp.net', '');
    await withRetry(
      () => axios.post(
        `${GRAPH_BASE}/${this.config.phone_number_id}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'template',
          template: { name, language: { code: lang }, components },
        },
        { headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' } },
      ),
      { label: `WhatsAppOfficialClient:${this.accountId} sendTemplate` },
    );
    // Registrar en el historial para que el template se vea en el inbox.
    await this.store.record({
      accountId: this.accountId,
      phone: cleanPhone,
      direction: 'OUTBOUND',
      content: preview ?? `[template: ${name}]`,
      channel: 'whatsapp',
    } as any).catch(() => {});
  }
```
NOTA: ajustar los campos de `store.record({...})` para que coincidan EXACTAMENTE con la llamada de `sendMessage` en el mismo archivo (líneas ~72-80) — copiar esa forma, solo cambiando `content` por el `preview`.

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `cd server && npx vitest run src/infrastructure/meta/__tests__/WhatsAppOfficialClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/infrastructure/meta/WhatsAppOfficialClient.ts server/src/infrastructure/meta/__tests__/WhatsAppOfficialClient.test.ts
git commit -m "feat(templates): sendTemplate en WhatsAppOfficialClient (Cloud API)"
```

---

### Task 3: Ruteo `AccountManager.sendTemplate`

**Files:**
- Modify: `server/src/core/accounts/AccountManager.ts`

- [ ] **Step 1: Implementar el método**

En `AccountManager.ts`, después de `sendMessage` (termina ~línea 142), agregar:

```typescript
  /**
   * Envía un template (HSM) por Cloud API. Solo aplica a WhatsApp oficial
   * (`WhatsAppOfficialClient`); los templates son específicos de esa API.
   */
  async sendTemplate(
    accountId: string,
    to: string,
    name: string,
    lang: string,
    components: unknown[],
    preview?: string,
  ): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) throw new Error(`Cuenta ${accountId} no conectada`);
    if (client instanceof WhatsAppOfficialClient) {
      await client.sendTemplate(to, name, lang, components, preview);
      return;
    }
    throw new Error(`Cuenta ${accountId} no es WhatsApp oficial: no soporta templates`);
  }
```
`WhatsAppOfficialClient` ya está importado en el archivo (se usa en `sendMessage`). No hace falta import nuevo.

- [ ] **Step 2: Verificar que compila y que no rompe tests**

Run: `cd server && npx tsc --noEmit && npx vitest run src/infrastructure/meta src/services/__tests__/whatsappTemplates.test.ts`
Expected: sin errores de tipo; tests verdes.

- [ ] **Step 3: Commit**

```bash
git add server/src/core/accounts/AccountManager.ts
git commit -m "feat(templates): AccountManager.sendTemplate rutea a WhatsApp oficial"
```

---

## Notas

- El `MetaClient` (Facebook Messenger) NO recibe `sendTemplate`: los templates HSM son de WhatsApp. Las citas del estudio son todas WhatsApp, así que el ruteo a `WhatsAppOfficialClient` cubre el caso real.
- `LANG` en `whatsappTemplates.ts` es `es_AR`; si Meta aprueba con otro código, cambiar esa constante (y los `metaName` si el usuario usó otros nombres).
