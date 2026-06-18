import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { JitsiService } from './JitsiService';

const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const TTL_HORAS = Number(process.env.SALA_TTL_HORAS || 3);

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export interface JoinResult {
  roomUrl: string;   // URL completa de la sala Jitsi
  room: string;      // nombre de la sala (para el External API)
  displayName: string;
}

export const SalaService = {
  isConfigured(): boolean {
    return true; // Jitsi público no requiere credenciales
  },

  /** Crea una sala: nombre Jitsi impredecible + fila en DB. */
  async createSala(opts: { accountId?: string; appointmentId?: string; titulo?: string; createdBy?: string }) {
    const room = JitsiService.newRoom();
    const { data, error } = await supabase
      .from('salas')
      .insert({
        account_id: opts.accountId || null,
        appointment_id: opts.appointmentId || null,
        titulo: opts.titulo || null,
        daily_room: room.name,   // (columnas reutilizadas: guardan el room/url de Jitsi)
        daily_url: room.url,
        created_by: opts.createdBy || null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  /** Genera un enlace de invitado (token opaco, hash en DB). */
  async invitar(salaId: string, nombre: string): Promise<{ enlace: string; salaId: string; expiraEn: string }> {
    const { data: sala } = await supabase.from('salas').select('id').eq('id', salaId).maybeSingle();
    if (!sala) throw new Error('Sala no encontrada');

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TTL_HORAS * 3600 * 1000);

    const { error } = await supabase.from('invitaciones').insert({
      sala_id: salaId,
      nombre,
      token_hash: sha256(inviteToken),
      expires_at: expiresAt.toISOString(),
    });
    if (error) throw new Error(error.message);

    return {
      enlace: `${PUBLIC_APP_URL}/sala/${salaId}?invite=${inviteToken}`,
      salaId,
      expiraEn: expiresAt.toISOString(),
    };
  },

  /** Valida el token de invitado y devuelve la sala Jitsi. */
  async join(salaId: string, inviteToken: string): Promise<JoinResult> {
    const hash = sha256(inviteToken || '');
    const { data: inv } = await supabase
      .from('invitaciones')
      .select('*')
      .eq('sala_id', salaId)
      .eq('token_hash', hash)
      .maybeSingle();
    if (!inv) throw new Error('INVALID');
    if (new Date(inv.expires_at).getTime() < Date.now()) throw new Error('EXPIRED');

    const { data: sala } = await supabase.from('salas').select('*').eq('id', salaId).maybeSingle();
    if (!sala || sala.estado !== 'activa') throw new Error('INVALID');

    if (!inv.used_at) {
      await supabase.from('invitaciones').update({ used_at: new Date().toISOString() }).eq('id', inv.id);
    }

    return { roomUrl: sala.daily_url, room: sala.daily_room, displayName: inv.nombre };
  },

  /** Entrada del operador (desde el panel). */
  async hostToken(salaId: string, nombre = 'Operador'): Promise<JoinResult> {
    const { data: sala } = await supabase.from('salas').select('*').eq('id', salaId).maybeSingle();
    if (!sala) throw new Error('Sala no encontrada');
    return { roomUrl: sala.daily_url, room: sala.daily_room, displayName: nombre };
  },
};
