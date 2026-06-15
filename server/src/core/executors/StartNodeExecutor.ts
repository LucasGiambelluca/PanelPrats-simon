import { NodeExecutor, NodeExecutionResult } from './types';

export class StartNodeExecutor implements NodeExecutor {
    async execute(data: any, context: any, engine: any): Promise<NodeExecutionResult> {
        // Start node usually does nothing but marking the entry point.
        // potentially it could check for trigger words but that's handled by the engine.
        // Returning empty array and false allows engine to auto-advance to next node.
        return {
            wait_for_input: false,
            messages: []
        };
    }
}
