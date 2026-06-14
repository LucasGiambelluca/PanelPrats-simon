import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { logger } from '../../utils/logger';
import { redisPersistence } from '../../infrastructure/persistence/RedisPersistenceService';

/**
 * BufferMemoryExecutor — Loads recent conversation history from Redis
 * and injects it into the flow context for the AI Agent to consume.
 */
export class BufferMemoryExecutor implements NodeExecutor {
    async execute(nodeData: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const capacity = nodeData.capacity || 10;
        const phone = context.phone;
        // Plan 2 Task 7: getHistory ahora exige accountId como primer parámetro
        // para aislar el historial por cuenta. El contexto de ejecución lo lleva.
        const accountId = context.accountId;

        logger.info(`[Memory] 🧠 Loading last ${capacity} messages for ${phone} from Redis...`);

        try {
            // Fetch history from shared memory service
            const history = await redisPersistence.getHistory(accountId, phone, capacity);

            return {
                messages: [],
                wait_for_input: false,
                updatedContext: {
                    ai_memory_stack: history,
                    _history_loaded: true,
                    _memory_capacity: capacity
                }
            };
        } catch (error) {
            logger.error(`[Memory] Failed to load history`, error);
            return { messages: [], wait_for_input: false };
        }
    }
}
