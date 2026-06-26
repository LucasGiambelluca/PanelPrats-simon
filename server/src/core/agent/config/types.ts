// Tipos del "cerebro" del agente de atención. Un Change es un cambio PROPUESTO
// (lo generan las tools del config-agent o la edición manual); applyChanges lo
// aplica fan-out a todas las cuentas del estudio.

export type Oficina = 'CABA' | 'Quilmes' | 'Haedo';

export type Change =
  | { type: 'set_tono'; texto: string }
  | { type: 'set_datos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'set_procedimientos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'add_faq'; pregunta: string; respuesta: string; tags?: string[] }
  | { type: 'edit_faq'; pregunta: string; nueva_respuesta?: string; nueva_pregunta?: string; tags?: string[] }
  | { type: 'remove_faq'; pregunta: string }
  | { type: 'add_zona'; localidad: string; oficina: Oficina }
  | { type: 'remove_zona'; localidad: string };

export interface BrainFaq { id: string; pregunta: string; respuesta: string; tags: string[] }
export interface BrainZona { id: string; alias: string; oficina: string }

export interface BrainState {
  tono: string | null;
  datos: string | null;
  procedimientos: string | null;
  faqs: BrainFaq[];
  zonas: BrainZona[];
  lineas: number;
}

export interface ApplyResult { change: Change; ok: boolean; error?: string }

// Interfaz de persistencia inyectable (testeable sin supabase).
export type AccountField = 'agent_persona' | 'business_context' | 'agent_procedures';

export interface BrainDb {
  listAccountIds(): Promise<string[]>;
  getField(accountId: string, field: AccountField): Promise<string | null>;
  setField(accountId: string, field: AccountField, value: string): Promise<void>;
  upsertFaq(accountId: string, faq: { pregunta: string; respuesta: string; tags: string[] }): Promise<void>;
  editFaq(accountId: string, pregunta: string, patch: { respuesta?: string; pregunta?: string; tags?: string[] }): Promise<void>;
  removeFaq(accountId: string, pregunta: string): Promise<void>;
  upsertZona(accountId: string, aliasNorm: string, alias: string, oficina: string): Promise<void>;
  removeZona(accountId: string, aliasNorm: string): Promise<void>;
  listFaqs(accountId: string): Promise<BrainFaq[]>;
  listZonas(accountId: string): Promise<BrainZona[]>;
}
