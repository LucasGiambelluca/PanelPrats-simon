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
