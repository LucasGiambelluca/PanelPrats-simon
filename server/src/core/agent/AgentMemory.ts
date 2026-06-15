// ─── AgentMemory (Producción) ─────────────────────────────────────────────────
// Tomado de /agente IA/memory.ts sin cambios (está perfecto tal cual).
// Gestiona la ventana deslizante de historial en memoria (in-process).
// Para sesiones persistentes entre reinicios, el AIAgentExecutor
// complementa esto con el historial desde Supabase.

import type { AgentMemory, MemoryEntry, IntentType } from './AgentTypes';

const MAX_HISTORY = 20; // ventana de contexto (mensajes)

export class AgentMemoryManager {
    private store = new Map<string, AgentMemory>();

    get(sessionId: string): AgentMemory {
        if (!this.store.has(sessionId)) {
            this.store.set(sessionId, { sessionId, history: [] });
        }
        return this.store.get(sessionId)!;
    }

    append(
        sessionId: string,
        role: MemoryEntry['role'],
        content: string,
        intent?: IntentType
    ): void {
        const memory = this.get(sessionId);
        memory.history.push({ role, content, timestamp: Date.now(), intent });
        // ventana deslizante: conservar solo los últimos MAX_HISTORY
        if (memory.history.length > MAX_HISTORY) {
            memory.history = memory.history.slice(-MAX_HISTORY);
        }
    }

    setClient(sessionId: string, phone: string): void {
        const memory = this.get(sessionId);
        memory.clientPhone = phone;
    }

    setLastOrder(sessionId: string, orderId: string): void {
        const memory = this.get(sessionId);
        memory.lastOrderId = orderId;
    }

    /** Convierte el historial a formato para el prompt de IA */
    formatForPrompt(sessionId: string): string {
        const memory = this.get(sessionId);
        if (memory.history.length === 0) return '';
        return memory.history
            .map(e => `${e.role === 'user' ? 'Cliente' : 'Bot'}: ${e.content}`)
            .join('\n');
    }

    /** Convierte el historial al formato que espera AIService */
    toAIServiceFormat(sessionId: string): { role: 'user' | 'assistant'; content: string }[] {
        const memory = this.get(sessionId);
        return memory.history.map(e => ({ role: e.role, content: e.content }));
    }

    clear(sessionId: string): void {
        this.store.delete(sessionId);
    }

    size(sessionId: string): number {
        return this.get(sessionId).history.length;
    }
}

// Singleton global: una instancia compartida por todos los ejecutores
export const agentMemory = new AgentMemoryManager();
