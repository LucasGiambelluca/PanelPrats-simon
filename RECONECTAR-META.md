# Reconectar Facebook (Messenger) e Instagram

Runbook para reconectar las líneas de **Facebook Messenger** e **Instagram** en el panel
cuando dejan de andar (token vencido, "no responde", error de token, etc.).

> Síntoma típico: el bot deja de responder en FB/IG. Casi siempre es el **Access Token**
> vencido o inválido (Meta los vence). La solución es regenerarlo y volver a pegarlo.

---

## 0) Datos fijos (sirven para todas las líneas Meta)

| Campo | Valor |
|---|---|
| **Callback URL** (igual para FB, IG y WhatsApp) | `https://pys-panel.ynewvd.easypanel.host/api/webhooks/meta` |
| **Verify Token** | el que pusiste al crear la línea (ej. `pratsfb2026`). Lo inventás vos; tiene que coincidir en el panel y en Meta. |

El **ruteo lo hace el `external_id`** (Page ID en FB, IG-ID en Instagram), NO la URL ni el
verify token. Cada línea tiene que tener su `external_id` correcto.

---

## 1) Reconectar FACEBOOK (Messenger)

### A) Generar el Page token correcto
1. https://developers.facebook.com → tu App → **Messenger → Settings** (Configuración de Messenger).
2. Sección **Access Tokens** → seleccioná la **página correcta** (la del estudio) → **Generate Token**.
   - Ese token (contexto Messenger) trae el permiso `pages_messaging`.
   - Si lo generás por **Graph API Explorer**, pedí los permisos: `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`.
3. Copiá el token **completo** (sin espacios, sin cortar).

### B) Suscribir la página al webhook (solo si no llegan mensajes)
En la misma pantalla **Messenger → Settings → Webhooks**:
- Callback URL: `https://pys-panel.ynewvd.easypanel.host/api/webhooks/meta`
- Verify Token: el de la línea (ej. `pratsfb2026`)
- En tu Página → **Add Subscriptions** → tildá **`messages`** y **`messaging_postbacks`**.

### C) Cargar en el panel
Panel → **Mis Números** → línea de Facebook → **⚙ Configurar**:
- **Access Token**: pegá el token nuevo.
- **Phone/Page ID** (`external_id`): el **ID de la página** que usás (ej. `112282081713922`).
- **App Secret**: el secreto de la app Meta (32 caracteres). El mismo para todas las páginas de la misma app.
- **Verify Token**: ej. `pratsfb2026`.
- Guardar.

### D) Probar
- Tocá **"Probar conexión"** en la línea → tiene que dar **verde**.
- Mandale "hola" a la página por Messenger → el bot responde.

---

## 2) Reconectar INSTAGRAM

Instagram DM se maneja con el **Page token de la página de Facebook vinculada a la cuenta de Instagram**.

### A) Requisitos
- La cuenta de Instagram tiene que ser **Profesional/Empresa** y estar **vinculada a una página de Facebook**.

### B) Generar el token
- Graph API Explorer (o Meta App → Instagram → API setup) → **Get Page Access Token** de la página vinculada.
- Permisos: `instagram_basic`, `instagram_manage_messages`, `pages_messaging`, `pages_show_list`.
- Copiá el token **completo**.

### C) Suscribir
- Meta App → **Webhooks** → producto **Instagram** → suscribí la cuenta al campo **`messages`**.

### D) Cargar en el panel
Panel → **Mis Números** → línea **INSTAGRAM** → **⚙ Configurar**:
- **Access Token**: el token nuevo.
- **Instagram Account ID** (`external_id`): el **IG-ID que manda Meta en los webhooks** (empieza con `1784...`, ej. `17841450149054653`). **OJO:** NO es el ID de la cuenta de IG común; es el de mensajería. Si los webhooks llegan con otro número, ese es el correcto.
- **App Secret**: el de la app Meta.
- **Verify Token**: el de la línea.
- Guardar.

### E) Probar
- **"Probar conexión"** → verde.
- Mandá un DM a la cuenta de IG → el bot responde.

---

## 3) El botón "Probar conexión"

En cada línea Meta/oficial hay un botón **"Probar conexión"** (verde). Valida el token contra
Meta en vivo y deja la línea **conectada** o **desconectada** con el motivo. Usalo siempre
después de pegar un token.

---

## 4) Errores comunes

| Error / síntoma | Causa | Solución |
|---|---|---|
| `code 190` / "Cannot parse access token" / "Session expired" | Token **vencido o inválido** (o pegado incompleto) | Regenerá el token (paso A) y pegalo entero |
| `code 100` "nonexisting field" / "missing permissions" | Token **sin permisos** (`pages_messaging` / `pages_manage_metadata` / `instagram_manage_messages`) | Regenerá el token pidiendo esos permisos |
| Llega el mensaje pero el bot NO responde | Token sin permiso de envío, o línea desconectada | Token correcto + "Probar conexión" verde |
| NO llega ningún mensaje (inbox vacío) | La página/cuenta **no está suscrita** al webhook `messages` | Paso B (FB) / C (IG): suscribir `messages` |
| "sin app_secret … rechazo" en logs | La línea **no existe** en el panel o le falta `app_secret` | Crear/configurar la línea con el `external_id` y `app_secret` correctos |
| Le escribís y no responde, pero a otra página sí | Estás escribiendo a **otra página** distinta de la conectada | Confirmá que el `external_id` del panel = la página a la que escribís |
| App en **Development** y no responde a otros | En modo dev Meta solo entrega webhooks a cuentas con **rol** en la app | Agregá la cuenta como Tester/Admin (App Roles), o sacá App Review para público |

---

## 5) Notas

- **El token es lo único que vence.** El `external_id`, `app_secret` y `verify_token` no cambian.
- Conviene un **token permanente de System User** (no caduca) en vez de los temporales del Explorer.
- Un mismo **App Secret** sirve para todas las páginas/IG de la **misma app Meta**.
- Las **agendas son compartidas** entre canales (org-wide): un turno tomado por WhatsApp también
  bloquea a la misma profesional en FB/IG.
