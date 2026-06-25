export interface Account {
  id: string;
  user_id: string;
  name: string;
  phone_number: string | null;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  channel?: 'whatsapp' | 'facebook' | 'instagram';
  provider?: 'baileys' | 'official';
  flow_id?: string | null;
  external_id?: string | null;
  access_token?: string | null;
  app_secret?: string | null;
  verify_token?: string | null;
  qr_code?: string | null;
  reminder_minutes?: number; // anticipación del recordatorio de citas (min)
  // Agente IA de soporte global (por cuenta)
  ai_support_enabled?: boolean;
  ai_api_key?: string | null;
  ai_model?: string | null;
  ai_support_prompt?: string | null;
  // Modo del agente: 'flows' (menú + soporte off-script) | 'ai_first' (agente siempre presente)
  agent_mode?: 'flows' | 'ai_first';
  business_context?: string | null;
  created_at: string;
}

export interface Flow {
  id: string;
  account_id: string;
  name: string;
  trigger_word: string | null;
  nodes: any[];
  edges: any[];
  is_active: boolean;
  created_at?: string;
}

export interface WhatsAppConversation {
  id: string;
  account_id: string;
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  status: 'BOT' | 'HANDOVER';
}

export type WaMessageDirection = 'INBOUND' | 'OUTBOUND';

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: WaMessageDirection;
  content: string | null;
  media_url: string | null;
  message_type: string;
  timestamp: string;
}

export type Role = 'admin' | 'empleada';

export interface Profile {
  id: string;
  role: Role;
  name: string | null;
  active: boolean;
  email?: string | null;
  created_at?: string;
}

export interface Office {
  id: string;
  account_id: string;
  nombre: string;
  modalidad: 'presencial' | 'video' | 'ambas';
  direccion: string | null;
  video_link: string | null;
  dias: number[];
  hora_inicio: string;
  hora_fin: string;
  slot_min: number;
  capacidad: number;
  buffer_min: number;
  activa: boolean;
  orden: number;
}

export interface OfficeProfessional {
  profile_id: string;
  name: string | null;
  role: Role | null;
  activa: boolean;
}

export interface AvailabilityWindow {
  id?: string;
  dia: number;          // 0-6
  hora_inicio: string;  // HH:MM
  hora_fin: string;     // HH:MM
}

export interface ProfessionalBlock {
  id: string;
  office_id: string | null;
  start_time: string;   // ISO
  end_time: string;     // ISO
  motivo: string | null;
}

export interface ProfessionalLite {
  id: string;
  name: string | null;
  role: Role;
}
