import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class ThreadManagerExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        console.log('[ThreadManager] Executing thread action:', data.action);

        try {
            const action = data.action || 'HANDOVER';
            let message = '';
            const phone = context.phone.replace(/[\s\-\+\(\)]/g, '');

            if (action === 'HANDOVER') {
                await engine.db.from('whatsapp_conversations')
                    .update({ status: 'HANDOVER' })
                    .eq('phone', phone);
                await engine.db.from('flow_executions')
                    .update({ status: 'HANDOVER', paused_at: new Date().toISOString() })
                    .eq('phone', phone)
                    .eq('status', 'active');
                message = data.message || "⏳ Te estamos transfiriendo con un humano. Por favor espera.";
            } else if (action === 'RESUME') {
                await engine.db.from('whatsapp_conversations')
                    .update({ status: 'ACTIVE' })
                    .eq('phone', phone);
                message = data.message || "🤖 El bot ha retomado la conversación.";
            }

            return {
                messages: [message],
                wait_for_input: false, // Don't wait, just change state
                nextNodeId: data.nextId // Optional: Jump to another node immediately
            };

        } catch (error) {
            console.error('[ThreadManager] Error:', error);
            return {
                messages: ["⚠️ Error al gestionar el hilo de conversación."],
                wait_for_input: false
            };
        }
    }
}
