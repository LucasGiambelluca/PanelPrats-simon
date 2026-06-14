import { NodeExecutor, ExecutionContext, NodeExecutionResult } from './types';
import { logger } from '../../utils/logger';

export class ArraySwitchExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const variableName = data.variable || 'split_words';
        const arrayToSearch = (context as any)[variableName];

        const cases = data.cases || [];
        const defaultHandle = data.default_handle || 'default';

        if (!Array.isArray(arrayToSearch)) {
            logger.warn(`[ArraySwitchExecutor] Variable "${variableName}" is not an array. Routing to default.`);
            return { messages: [], wait_for_input: false, conditionResult: defaultHandle };
        }

        logger.info(`[ArraySwitchExecutor] Searching keywords in array "${variableName}" (${arrayToSearch.length} items).`);

        for (const entry of cases) {
            const word = entry.value?.toLowerCase().trim();
            if (arrayToSearch.includes(word)) {
                logger.info(`[ArraySwitchExecutor] Exact Match found for word: "${word}" -> handle: ${entry.handle}`);
                return {
                    messages: [],
                    wait_for_input: false,
                    conditionResult: entry.handle
                };
            }
        }

        logger.info(`[ArraySwitchExecutor] No exact match in array. Routing to default: ${defaultHandle}`);
        return {
            messages: [],
            wait_for_input: false,
            conditionResult: defaultHandle
        };
    }
}
