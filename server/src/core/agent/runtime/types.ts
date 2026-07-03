// Identidad inyectada server-side al ejecutar una tool. El modelo NUNCA la provee.
export interface ToolContext {
  accountId: string;
  phone: string;
  // Conversación acumulada (para el ReceptionFichaBuilder en book_appointment).
  conversation?: string;
  // Zona resuelta por suggest_office en este hilo (para etiquetar la ficha).
  zona?: string | null;
  // Área de calificación de ESTA conversación (para copiar la calificación correcta al agendar).
  area?: string | null;
}

// Resultado normalizado de una tool (lo que se devuelve al modelo).
export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
}

// Ficha compacta del contacto que se inyecta en el prompt.
export interface ContactFicha {
  profile: Record<string, any>;
  preferences: Record<string, any>;
  summary: string | null;
  fichaText: string; // línea(s) lista(s) para el prompt
  calificacion?: Record<string, any> | null;
}

// Config de cuenta relevante para el agente.
export interface AgentAccountConfig {
  accountId: string;
  agentName: string;          // default 'Sofía'
  agentPersona?: string | null;
  businessContext?: string | null;
  agentProcedures?: string | null;
  estudioNombre?: string | null;
  apiKey?: string | null;
  model?: string | null;
}
