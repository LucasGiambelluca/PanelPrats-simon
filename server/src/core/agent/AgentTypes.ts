// ─── Agent Types (Producción) ────────────────────────────────────────────────
// Basado en /agente IA/types.ts — extendido para Supabase + AIService

export type IntentType =
  | 'ORDER'
  | 'CHECKOUT'
  | 'INQUIRY'
  | 'GREETING'
  | 'CANCEL'
  | 'FALLBACK'
  | 'UNKNOWN';

// Mapeo de intents en inglés → español (para conditionResult del flujo)
export const INTENT_MAP: Record<IntentType, string> = {
  ORDER:   'pedido',
  CHECKOUT: 'checkout',
  INQUIRY: 'consulta',
  GREETING: 'saludo',
  CANCEL:  'cancelar',
  FALLBACK: 'desconocido',
  UNKNOWN: 'desconocido',
};

export interface AgentInput {
  text?: string;
  transcription?: string; // Pilar 1: captura dinámica del "bolsillo"
  clientPhone?: string;
  clientName?: string;
  sessionId: string;
  // Opcionales: clave y modelo inyectados desde el nodo visual
  apiKey?: string;
  model?: string;
}

export interface OrderItem {
  name: string;         // nombre tal como lo dijo el usuario
  qty: number;
  resolvedName?: string; // Pilar 4: nombre real en la DB
  resolvedId?: string;
  price?: number;
  matchScore?: number;
}

export interface AgentResponse {
  intent: IntentType;
  response: string;
  items?: OrderItem[];
  address?: string | null;
  delivery_method?: string | null;
  payment_method?: string | null;
  customer_name?: string | null;
  rawJson?: string;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  intent?: IntentType;
}

export interface AgentMemory {
  sessionId: string;
  history: MemoryEntry[];
  clientPhone?: string;
  lastOrderId?: string;
}

// ─── Tools / Superpoderes ────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  price: number;
  stock?: number;
  is_active?: boolean;
  category?: string;
}

export interface Order {
  id: string;
  clientPhone: string;
  items: OrderItem[];
  status: 'pending' | 'confirmed' | 'delivered' | 'cancelled';
  createdAt: number;
  total: number;
}

export interface BusinessHours {
  open: string;
  close: string;
  isOpen: boolean;
  message: string;
}

export interface ToolsContext {
  products?: Product[];
  lastOrder?: Order | null;
  businessHours?: BusinessHours;
}

// ─── Product similarity search ───────────────────────────────────────────────

export interface ProductMatch {
  product: Product;
  score: number;
}

// ─── Node State (para visualización) ─────────────────────────────────────────

export type NodeStatus = 'idle' | 'processing' | 'success' | 'error';
export type PillarId = 'capture' | 'tools' | 'json' | 'resolver';

export interface PillarState {
  id: PillarId;
  label: string;
  sublabel: string;
  status: NodeStatus;
}

export interface AgentNodeState {
  status: NodeStatus;
  activeIntent: IntentType | null;
  pillars: PillarState[];
  lastResponse: AgentResponse | null;
  memorySize: number;
  toolsLoaded: boolean;
}
