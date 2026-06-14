import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class TimerExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        const duration = parseInt(data.duration) || 1000; // Default 1s
        const showTyping = data.showTyping !== false; // Default true

        console.log(`[TimerExecutor] Waiting ${duration}ms (Typing: ${showTyping})...`);

        if (showTyping && context.chatContext?.remoteJid) {
            // Optional: Send "presence update" (typing...) if the engine supports it/exposes the socket
            // engine.provider.sendPresenceUpdate('composing', context.chatContext.remoteJid);
        }

        // Blocking delay
        await new Promise(resolve => setTimeout(resolve, duration));

        return {
            messages: [],
            wait_for_input: false
        };
    }
}
