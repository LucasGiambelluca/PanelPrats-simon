export class PhoneUtils {
  static normalize(phone: string): string {
    if (!phone) return '';
    if (phone.includes('@lid')) return phone.trim();
    let clean = phone.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@g.us', '').trim();
    if (clean.includes('@')) return clean;
    clean = clean.replace(/[^0-9]/g, '');

    // Unify Argentine numbers: remove mobile prefix '9'
    // Format: 54 9 XXX XXX XXXX (13 digits) -> remove 9 to become 54 XXXXXXXXXX (12 digits)
    if (clean.startsWith('549') && clean.length === 13) {
      clean = '54' + clean.slice(3);
    }
    // Unify Mexican numbers: remove mobile prefix '1'
    // Format: 52 1 XXX XXX XXXX (13 digits) -> remove 1 to become 52 XXXXXXXXXX (12 digits)
    if (clean.startsWith('521') && clean.length === 13) {
      clean = '52' + clean.slice(3);
    }
    return clean;
  }

  /**
   * Formas equivalentes de un teléfono para CONSULTAR (no para guardar). Resuelve el
   * mismatch AR con-9 / sin-9: distintos paths guardan el wa_id con el 9 móvil
   * (5492915093499) mientras normalize() lo saca (542915093499). Al consultar el
   * historial con `.in(variants)` matcheamos sin importar en qué forma se guardó.
   */
  static variants(phone: string): string[] {
    const norm = PhoneUtils.normalize(phone);
    if (!norm) return [];
    if (norm.includes('@')) return [norm]; // @lid u otros JIDs: sin variantes numéricas
    const set = new Set<string>([norm]);
    if (/^54\d{10}$/.test(norm)) set.add('549' + norm.slice(2)); // AR: agrega la forma móvil con 9
    return [...set];
  }

  static toJid(phone: string): string {
    if (!phone) return '';
    if (phone.includes('@')) return phone;
    if (phone.includes('-')) return `${phone}@g.us`;
    return `${phone}@s.whatsapp.net`;
  }

  static isLid(phone: string): boolean {
    return phone.includes('@lid');
  }

  /**
   * Resuelve el teléfono REAL de un remitente entrante.
   * WhatsApp a veces entrega el chat como `<id>@lid` (privacidad); el número real
   * viene en `key.senderPn`, pero NO en todos los mensajes. Cacheamos lid→phone
   * cuando senderPn aparece y resolvemos los `@lid` posteriores que llegan sin él.
   * Sin esto, el mismo contacto se parte en dos conversaciones (una `@lid`, otra real).
   */
  static resolveIdentity(remoteJid: string, senderPn: string | undefined, lidMap: Map<string, string>): string {
    if (remoteJid.includes('@lid')) {
      const lidKey = remoteJid.split('@')[0];
      if (senderPn) {
        const pn = this.normalize(senderPn);
        if (pn) lidMap.set(lidKey, pn);
        return pn;
      }
      const cached = lidMap.get(lidKey);
      if (cached) return cached;
      // sin senderPn ni cache: fallback al lid (se unificará al ver senderPn o por merge).
      return this.normalize(remoteJid);
    }
    return this.normalize(remoteJid);
  }
}
