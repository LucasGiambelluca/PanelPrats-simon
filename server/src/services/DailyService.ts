import axios from 'axios';
import { logger } from '../utils/logger';

// Wrapper de la REST API de Daily.co. La API key vive SOLO en el server.
const DAILY_API = 'https://api.daily.co/v1';
const DAILY_API_KEY = process.env.DAILY_API_KEY;

function headers() {
  return { Authorization: `Bearer ${DAILY_API_KEY}`, 'Content-Type': 'application/json' };
}

export const DailyService = {
  isConfigured(): boolean {
    return !!DAILY_API_KEY;
  },

  /**
   * Crea una room PRIVADA (nadie entra sin meeting token). Daily autogenera el
   * nombre y devuelve la URL. `expSeconds` opcional cierra la room en X tiempo.
   */
  async createRoom(opts: { expSeconds?: number } = {}): Promise<{ name: string; url: string }> {
    const properties: any = {
      enable_chat: false,
      enable_screenshare: true,
      eject_at_room_exp: true,
    };
    if (opts.expSeconds) properties.exp = Math.floor(Date.now() / 1000) + opts.expSeconds;

    const { data } = await axios.post(
      `${DAILY_API}/rooms`,
      { privacy: 'private', properties },
      { headers: headers(), timeout: 15000 }
    );
    return { name: data.name, url: data.url };
  },

  /**
   * Mintea un meeting token para entrar a una room. Para invitados: is_owner=false
   * (sin admin/moderación) y exp corto. Para el operador: is_owner=true.
   */
  async createMeetingToken(opts: {
    roomName: string;
    userName: string;
    isOwner?: boolean;
    expSeconds?: number;
  }): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + (opts.expSeconds ?? 3 * 3600);
    const { data } = await axios.post(
      `${DAILY_API}/meeting-tokens`,
      {
        properties: {
          room_name: opts.roomName,
          user_name: opts.userName,
          is_owner: !!opts.isOwner,
          exp,
          eject_at_token_exp: true,
        },
      },
      { headers: headers(), timeout: 15000 }
    );
    return data.token as string;
  },

  /** Borra la room en Daily (al cerrar la sala). Best-effort. */
  async deleteRoom(roomName: string): Promise<void> {
    try {
      await axios.delete(`${DAILY_API}/rooms/${roomName}`, { headers: headers(), timeout: 10000 });
    } catch (e: any) {
      logger.warn(`[Daily] no se pudo borrar room ${roomName}: ${e?.message}`);
    }
  },
};
