import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { interpolate } from '../engine/interpolate';

export class MessageExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const content = interpolate(data.message || data.text || '', context);
        return { messages: [content], wait_for_input: false };
    }
}
