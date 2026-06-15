import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class FlowLinkExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        // This node is special; it signals the engine to switch flows.
        // We return specific metadata that FlowEngine will handle.
        return {
            messages: [],
            wait_for_input: false,
            // Logic handled in engine: switch flow
            // We can pass the target flow ID here if needed, but engine reads node data too.
        };
    }
}
