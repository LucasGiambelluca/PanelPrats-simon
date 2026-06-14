import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { logger } from '../../utils/logger';

/**
 * WebhookExecutor — Entry point / trigger node.
 * Simply passes through to the next node, injecting the raw message into context.
 */
export class WebhookExecutor implements NodeExecutor {
    async execute(nodeData: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        logger.info(`[Webhook] ⚡ Message received. Passing through.`);

        return {
            messages: [],
            wait_for_input: false,
            updatedContext: {
                webhook_raw_message: context.user_message || context.last_user_message || '',
                webhook_timestamp: new Date().toISOString(),
            },
        };
    }
}
