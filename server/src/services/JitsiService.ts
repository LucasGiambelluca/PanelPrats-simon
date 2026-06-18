import crypto from 'crypto';

// Jitsi público (meet.jit.si): salas de video gratis, sin API key ni tarjeta.
// La "seguridad" del lado nuestro la da el invite-token opaco (link); el nombre
// de sala es random/impredecible para que no la adivinen.
const JITSI_DOMAIN = process.env.JITSI_DOMAIN || 'meet.jit.si';

export const JitsiService = {
  domain: JITSI_DOMAIN,

  /** Genera una sala nueva (nombre impredecible). No hace falta llamar a ninguna API. */
  newRoom(): { name: string; url: string } {
    const name = 'pys-' + crypto.randomBytes(12).toString('hex');
    return { name, url: `https://${JITSI_DOMAIN}/${name}` };
  },
};
