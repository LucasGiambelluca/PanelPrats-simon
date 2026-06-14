import path from 'path';

/** Clave Redis del checkpoint de sesión, aislada por cuenta. */
export function checkpointKey(accountId: string, phone: string): string {
  return `checkpoint:${accountId}:${phone}`;
}

/** ID de sesión: distingue chat 1-a-1 de grupo, prefijado por cuenta. */
export function sessionId(accountId: string, phone: string, remoteJid: string): string {
  const kind = remoteJid.endsWith('@g.us') ? `group:${remoteJid}` : `1to1:${phone}`;
  return `${accountId}:${kind}`;
}

/** Carpeta de credenciales Baileys, una por cuenta. */
export function authDir(basePath: string, accountId: string): string {
  return path.posix.join(basePath, accountId);
}
