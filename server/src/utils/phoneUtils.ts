export class PhoneUtils {
  static normalize(phone: string): string {
    if (!phone) return '';
    if (phone.includes('@lid')) return phone.trim();
    let clean = phone.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@g.us', '').trim();
    if (clean.includes('@')) return clean;
    return clean.replace(/[^0-9]/g, '');
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
}
