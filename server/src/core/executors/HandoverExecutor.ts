import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { PhoneUtils } from '../../utils/phoneUtils';

export class HandoverExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        const cleanPhone = PhoneUtils.normalize(context.phone);
        console.log(`[HandoverExecutor] Triggering human handover for ${cleanPhone}`);

        // 1. Set the state to PAUSED/HANDOVER so the automated bot stops answering
        await engine.db.from('flow_executions')
            .update({ status: 'HANDOVER', paused_at: new Date().toISOString() })
            .eq('phone', cleanPhone)
            .eq('status', 'active');

        // 2. Mark the conversation as HANDOVER for the frontend to move it to the Attention tab
        await engine.db.from('whatsapp_conversations')
            .update({ status: 'HANDOVER', updated_at: new Date().toISOString() })
            .eq('phone', cleanPhone);

        // 3. Build and interpolate the response message
        let responseMessage = data.message || 'Te estamos transfiriendo con un asesor humano. Por favor, aguarda un momento.';

        // Interpolate {{variable}} placeholders with values from the flow context
        responseMessage = responseMessage.replace(/\{\{([\w.]+)\}\}/g, (_: string, varName: string) => {
            const value = context[varName];
            if (value !== undefined && value !== null && value !== '') {
                return String(value);
            }
            // If variable not found, replace with a friendly fallback instead of raw placeholder
            return '(no especificado)';
        });

        return {
            wait_for_input: true,
            messages: [{ type: 'text', text: responseMessage }]
        };
    }
}
