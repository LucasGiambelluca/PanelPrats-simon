import { NodeExecutor, ExecutionContext, NodeExecutionResult } from './types';
import { logger } from '../../utils/logger';

export class TextSplitterExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const sourceVar = data.source_variable || 'transcripcion';
        const targetVar = data.target_variable || 'split_words';

        // Try to get the specific variable, if not fallback to user_message
        const textToSplit = String((context as any)[sourceVar] || context.user_message || '').toLowerCase();

        // Split by words, removing punctuation
        const wordsArray = textToSplit.replace(/[^\w\sáéíóúüñ]/gi, '').split(/\s+/).filter(w => w.length > 0);

        logger.info(`[TextSplitterExecutor] Splitted "${sourceVar}" into ${wordsArray.length} words. Saved as "${targetVar}".`);

        return {
            messages: [],
            wait_for_input: false,
            updatedContext: { [targetVar]: wordsArray }
        };
    }
}
