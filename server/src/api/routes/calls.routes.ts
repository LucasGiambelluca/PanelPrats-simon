import { Router } from 'express';
import { supabase } from '../../config/supabase';

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

/**
 * Llamadas de voz por la API oficial de WhatsApp (Meta Business Calling API).
 *
 * IMPORTANTE: WhatsApp NO ofrece videollamadas por API (ni oficial ni Baileys).
 * La Calling API de Meta es SOLO voz (beta, regiones limitadas) y requiere:
 *  - cuenta en la API oficial (provider='official') con número en Cloud API,
 *  - permiso de Calling habilitado en la app de Meta,
 *  - consentimiento del usuario y webhook de eventos de llamada.
 *
 * Este endpoint deja el punto de integración listo: valida el provider y, cuando
 * estén las credenciales/Calling habilitado, acá se dispara el POST a
 * /{phone_number_id}/calls de la Graph API.
 */
export function callsRouter(): Router {
  const r = Router();

  r.post('/voice', async (req, res) => {
    const { account_id, phone } = req.body || {};
    if (!account_id || !phone) {
      return res.status(400).json({ status: 'error', message: 'Faltan account_id o phone' });
    }

    // Resolver el provider/credenciales de la cuenta.
    let provider: string | undefined;
    let externalId: string | undefined; // phone_number_id de Cloud API
    let accessToken: string | undefined;
    if (isSupabaseConfigured) {
      try {
        const { data } = await supabase
          .from('accounts')
          .select('provider, external_id, access_token')
          .eq('id', account_id)
          .maybeSingle();
        provider = (data as any)?.provider;
        externalId = (data as any)?.external_id;
        accessToken = (data as any)?.access_token;
      } catch { /* ignore */ }
    }

    if (provider !== 'official') {
      return res.json({
        status: 'not_configured',
        message: 'La llamada de voz requiere la API oficial de WhatsApp (Meta) con Calling habilitado. Esta cuenta usa Baileys.',
      });
    }

    if (!externalId || !accessToken) {
      return res.json({
        status: 'not_configured',
        message: 'Faltan credenciales de la API oficial (Phone Number ID / Access Token) para iniciar la llamada.',
      });
    }

    // Punto de integración con la Meta Business Calling API (voz). Requiere que el
    // permiso de Calling esté habilitado en la app de Meta. Hasta entonces,
    // respondemos not_configured en vez de fingir que la llamada salió.
    // TODO: POST https://graph.facebook.com/v21.0/{externalId}/calls  (Calling API, voz)
    return res.json({
      status: 'not_configured',
      message: 'Calling API de Meta aún no habilitada para esta cuenta. Pedí habilitar el permiso de Calling en tu app de Meta.',
    });
  });

  return r;
}
