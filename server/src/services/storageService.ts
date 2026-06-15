import { supabase } from '../config/supabase';

/**
 * StorageService — versión genérica mínima (Plan 3).
 *
 * El origen subía media de WhatsApp (imágenes/audios/documentos) a un bucket de
 * Supabase Storage y devolvía la URL pública. Lo portamos tal cual, sin acoplamiento
 * a comercio: solo download (lo hace WhatsAppClient con downloadMediaMessage) → upload.
 */
export class StorageService {
  private bucket = 'chat-media';

  async ensureBucket(): Promise<boolean> {
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const exists = buckets?.some((b) => b.name === this.bucket);

      if (!exists) {
        console.log(`[StorageService] Creating bucket: ${this.bucket}`);
        const { error } = await supabase.storage.createBucket(this.bucket, {
          public: true,
          fileSizeLimit: 10485760, // 10MB
        });
        if (error) throw error;
      }
      return true;
    } catch (err) {
      console.error('[StorageService] Bucket Error:', err);
      return false;
    }
  }

  async uploadMedia(phone: string, buffer: Buffer, mimeType: string): Promise<string | null> {
    try {
      await this.ensureBucket();
      const ext = this.getExtension(mimeType);
      const filename = `${phone}/${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from(this.bucket)
        .upload(filename, buffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (error) {
        console.error('[StorageService] Upload Error:', error);
        return null;
      }

      const { data: publicData } = supabase.storage.from(this.bucket).getPublicUrl(filename);
      return publicData.publicUrl;
    } catch (err) {
      console.error('[StorageService] Critical Error:', err);
      return null;
    }
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-excel': 'xls',
    };
    return map[mimeType] || 'bin';
  }
}

export default new StorageService();
