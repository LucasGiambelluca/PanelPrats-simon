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
export async function validateMetaToken(p: { externalId?: string | null; accessToken?: string | null; channel?: string | null }): Promise<MetaTokenCheck> {
  if (!p.accessToken) return { ok: false, reason: 'Falta el Access Token' };
  if (!p.externalId) return { ok: false, reason: 'Falta el ID (Page ID / phone_number_id)' };

  // WhatsApp Cloud API: el envío va a POST /{phone_number_id}/messages con el token
  // del WABA/System User. Ese token NO está scopeado al phone_number_id: su propio id
  // (profile_id/user_id que devuelve debug_token) es OTRO, así que el check de
  // "el token es del ID configurado" daba un FALSO NEGATIVO ("El token es de OTRO ID").
  // Validación correcta para WhatsApp: pedir GET /{phone_number_id} con el token.
  // 200 => el token puede operar ese número (justo lo que necesita el envío).
  if (p.channel === 'whatsapp') {
    try {
      const r = await axios.get(`${GRAPH_BASE}/${p.externalId}`, {
        params: { fields: 'id,display_phone_number,verified_name,quality_rating', access_token: p.accessToken },
        timeout: 10_000,
      });
      return {
        ok: true,
        info: {
          type: 'WHATSAPP_CLOUD',
          phone: r.data?.display_phone_number,
          name: r.data?.verified_name,
          quality: r.data?.quality_rating,
        },
      };
    } catch (err: any) {
      const e = err?.response?.data?.error;
      if (e?.code === 190) return { ok: false, reason: 'Token vencido o inválido — regeneralo en Meta (WhatsApp → API setup) (code 190)' };
      if (e?.code === 200 || e?.code === 100) {
        return { ok: false, reason: `El token no tiene acceso al teléfono ${p.externalId} (${e.message}). Usá el token del WABA dueño de ese número.` };
      }
      return { ok: false, reason: e ? `${e.message} (code ${e.code})` : (err?.message ?? 'Error contactando a Meta') };
    }
  }

  // Token de "Instagram Login API" (IGAA…): va contra graph.instagram.com, no
  // graph.facebook.com. Se valida con GET /me y se chequea que el user_id coincida
  // con el external_id configurado. El sistema lo soporta (MetaClient enruta a IG).
  if (/^IG/i.test(p.accessToken.trim())) {
    try {
      const r = await axios.get(`https://graph.instagram.com/${GRAPH_VERSION}/me`, {
        params: { fields: 'user_id,username,name', access_token: p.accessToken },
        timeout: 10_000,
      });
      const uid = String(r.data?.user_id ?? '');
      if (uid && String(p.externalId) && uid !== String(p.externalId)) {
        return { ok: false, reason: `El token IG es de otra cuenta (user_id ${uid}). Configuraste ${p.externalId}. Poné ${uid} como External ID.` };
      }
      return { ok: true, info: { type: 'INSTAGRAM_LOGIN', username: r.data?.username, name: r.data?.name } };
    } catch (err: any) {
      const e = err?.response?.data?.error;
      if (e?.code === 190) return { ok: false, reason: 'Token de Instagram inválido o vencido — regeneralo en Meta (Instagram → API setup).' };
      return { ok: false, reason: e ? `${e.message} (code ${e.code})` : (err?.message ?? 'Error contactando a Instagram') };
    }
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
