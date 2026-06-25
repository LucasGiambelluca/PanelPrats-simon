import axios from 'axios';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaTokenCheck {
  ok: boolean;
  reason?: string;   // motivo legible si falla (token vencido, sin permiso, etc.)
  info?: any;        // datos del token si OK (tipo, scopes, id, expiración)
}

/**
 * Valida un access token de Meta usando `debug_token` (introspección del token).
 *
 * Por qué debug_token y NO `GET /{page}`: un Page token de Messenger suele tener
 * solo `pages_messaging` (alcanza para que el bot ENVÍE), pero `GET /{page}` exige
 * `pages_read_engagement` → daba un falso "code 100" con un token que en realidad
 * funciona. debug_token sirve con cualquier token y devuelve: validez, expiración,
 * tipo (PAGE/USER), el id del objeto (profile_id) y los scopes otorgados.
 *
 * Chequea: token válido + no vencido + que sea del ID configurado + que tenga el
 * permiso de mensajería del canal (pages_messaging / instagram_manage_messages).
 *
 * Reutilizado por el endpoint "Probar conexión" y por el health-check.
 */
export async function validateMetaToken(p: { externalId?: string | null; accessToken?: string | null }): Promise<MetaTokenCheck> {
  if (!p.accessToken) return { ok: false, reason: 'Falta el Access Token' };
  if (!p.externalId) return { ok: false, reason: 'Falta el ID (Page ID / phone_number_id)' };

  // Token de "Instagram Login API" (graph.instagram.com): no lo soporta la Graph API
  // de Facebook que usa el sistema. Hay que usar el Page token (EAA) de la página
  // vinculada. Detectarlo da un mensaje claro en vez del 190 "cannot parse" genérico.
  if (/^IG"?AA/i.test(p.accessToken.trim()) || p.accessToken.trim().startsWith('IGAA')) {
    return { ok: false, reason: 'Ese token es de "Instagram Login" (IGAA…), no compatible. Usá el Page Access Token (EAA…) de la página de Facebook vinculada, con instagram_manage_messages + pages_messaging.' };
  }

  let data: any;
  try {
    const r = await axios.get(`${GRAPH_BASE}/debug_token`, {
      params: { input_token: p.accessToken, access_token: p.accessToken },
      timeout: 10_000,
    });
    data = r.data?.data;
  } catch (err: any) {
    // El token está tan roto que ni autentica la introspección.
    const e = err?.response?.data?.error;
    if (e?.code === 190) return { ok: false, reason: `Token vencido o inválido — regeneralo en Meta (code 190)` };
    return { ok: false, reason: e ? `${e.message} (code ${e.code})` : (err?.message ?? 'Error de red al contactar a Meta') };
  }

  if (!data) return { ok: false, reason: 'No se pudo inspeccionar el token (respuesta vacía de Meta)' };
  if (!data.is_valid) {
    return { ok: false, reason: `Token inválido o vencido${data.error?.message ? ` — ${data.error.message}` : ' — regeneralo en Meta'}` };
  }

  // El token tiene que ser del ID configurado (Page ID / IG ID).
  const tokenId = String(data.profile_id ?? data.user_id ?? '');
  if (tokenId && String(p.externalId) && tokenId !== String(p.externalId)) {
    return { ok: false, reason: `El token es de OTRO ID (${tokenId}). Configuraste ${p.externalId}. Usá el token de esa página/cuenta, o corregí el ID.` };
  }

  // Tiene que poder mensajear (FB: pages_messaging | IG: instagram_manage_messages).
  const scopes: string[] = Array.isArray(data.scopes) ? data.scopes : [];
  const puedeMensajear = scopes.includes('pages_messaging') || scopes.includes('instagram_manage_messages');
  if (scopes.length && !puedeMensajear) {
    return { ok: false, reason: `Al token le falta el permiso de mensajería (pages_messaging / instagram_manage_messages). Regeneralo con ese scope.` };
  }

  return {
    ok: true,
    info: {
      type: data.type,
      scopes,
      expira: data.expires_at ? new Date(data.expires_at * 1000).toISOString() : 'nunca',
    },
  };
}
