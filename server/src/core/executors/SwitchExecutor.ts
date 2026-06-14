import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { logger } from '../../utils/logger';

/**
 * SwitchExecutor: Evalúa una variable y ramifica según su valor exacto.
 */
export class SwitchExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const variableName = data.variable;
        const valueToCompare = String((context as any)[variableName] || '').toLowerCase().trim();

        // data.cases es un array de { value: string, handle: string }
        const cases = data.cases || [];
        const defaultHandle = data.default_handle || 'default';

        logger.info(`[SwitchExecutor] Comparing variable "${variableName}" (Value: ${valueToCompare})`);

        for (const entry of cases) {
            const caseValue = String(entry.value).toLowerCase().trim();
            if (valueToCompare === caseValue) {
                logger.info(`[SwitchExecutor] Case match: "${caseValue}" -> handle: ${entry.handle}`);
                return {
                    messages: [],
                    wait_for_input: false,
                    conditionResult: entry.handle
                };
            }
        }

        return {
            messages: [],
            wait_for_input: false,
            conditionResult: defaultHandle
        };
    }
}
