import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { DailyService } from './DailyService';

const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const TTL_HORAS = Number(process.env.SALA_TTL_HORAS || 3);

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export interface JoinResult {
  roomUrl: string;
  dailyToken: string;
  displayName: string;
}

export const SalaService = {
  isConfigured(): boolean {
    return DailyService.isConfigured();
  },

  /** Crea una sala: room en Daily + fila en DB. */
  async createSala(opts: { accountId?: string; appointmentId?: string; titulo?: string; createdBy?: string }) {
    const room = await DailyService.createRoom();
    const { data, error } = await supabase
      .from('salas')
      .insert({
        account_id: opts.accountId || null,
        appointment_id: opts.appointmentId || null,
        titulo: opts.titulo || null,
        daily_room: room.name,
        daily_url: room.url,
        created_by: opts.createdBy || null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  /** Genera un enlace de invitado para una sala (token opaco, hash en DB). */
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

  /** Valida el token de invitado y devuelve credenciales de Daily (guest). */
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

    // exp del token de Daily = lo que reste de validez del enlace (mínimo 5 min).
    const remainingSec = Math.max(300, Math.floor((new Date(inv.expires_at).getTime() - Date.now()) / 1000));
    const dailyToken = await DailyService.createMeetingToken({
      roomName: sala.daily_room,
      userName: inv.nombre,
      isOwner: false,
      expSeconds: remainingSec,
    });

    // Auditoría: registrar primer uso (no es single-use: permite reconexión).
    if (!inv.used_at) {
      await supabase.from('invitaciones').update({ used_at: new Date().toISOString() }).eq('id', inv.id);
    }

    return { roomUrl: sala.daily_url, dailyToken, displayName: inv.nombre };
  },

  /** Token de operador (owner) para entrar desde el panel. */
  async hostToken(salaId: string, nombre = 'Operador'): Promise<JoinResult> {
    const { data: sala } = await supabase.from('salas').select('*').eq('id', salaId).maybeSingle();
    if (!sala) throw new Error('Sala no encontrada');
    const dailyToken = await DailyService.createMeetingToken({
      roomName: sala.daily_room,
      userName: nombre,
      isOwner: true,
      expSeconds: TTL_HORAS * 3600,
    });
    return { roomUrl: sala.daily_url, dailyToken, displayName: nombre };
  },
};
