import axios from 'axios';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaTokenCheck {
  ok: boolean;
  reason?: string;   // motivo legible si falla (token vencido, sin acceso, etc.)
  info?: any;        // datos del objeto si OK (verified_name, display_phone_number, name)
}

/**
 * Valida un access token de Meta contra la Graph API, en vivo.
 *
 * Hace `GET /{external_id}` con el token: un 200 prueba que el token es válido
 * Y que tiene acceso al objeto configurado (Page ID / phone_number_id). Sin pedir
 * `fields` específicos (cada tipo de nodo tiene fields distintos; pedir uno
 * inexistente devolvería error #100 y haría ver un token bueno como malo).
 *
 * Distingue el caso que nos mordió: token temporal vencido → OAuthException
 * code 190 ("Session has expired").
 *
 * Reutilizado por el endpoint "Probar conexión" y por el health-check.
 */
export async function validateMetaToken(p: { externalId?: string | null; accessToken?: string | null }): Promise<MetaTokenCheck> {
  if (!p.accessToken) return { ok: false, reason: 'Falta el Access Token' };
  if (!p.externalId) return { ok: false, reason: 'Falta el ID (Page ID / phone_number_id)' };

  try {
    const r = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(p.externalId)}`, {
      headers: { Authorization: `Bearer ${p.accessToken}` },
      timeout: 10_000,
    });
    return { ok: true, info: r.data };
  } catch (err: any) {
    const e = err?.response?.data?.error;
    if (e) {
      const sub = e.error_subcode ? `/${e.error_subcode}` : '';
      // Mensajes claros para los casos más comunes.
      if (e.code === 190) return { ok: false, reason: `Token vencido o inválido — regeneralo en Meta (code 190${sub})` };
      if (e.code === 100) return { ok: false, reason: `El token no tiene acceso a ese ID, o el ID es incorrecto (code 100${sub})` };
      if (e.code === 10 || e.code === 200) return { ok: false, reason: `Faltan permisos en el token (code ${e.code}${sub})` };
      return { ok: false, reason: `${e.message} (code ${e.code}${sub})` };
    }
    return { ok: false, reason: err?.message ?? 'Error de red al contactar a Meta' };
  }
}
