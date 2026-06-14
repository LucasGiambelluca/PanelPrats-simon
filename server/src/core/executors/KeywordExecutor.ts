import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { logger } from '../../utils/logger';

/**
 * KeywordExecutor: Busca palabras clave en el mensaje y ramifica el flujo.
 * Ideal para procesar transcripciones de audio o mensajes directos.
 */
export class KeywordExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const textToSearch = (context.user_message || context.transcripcion || '').toLowerCase();

        // data.keywords es un array de { word: string, handle: string }
        const keywords = data.keywords || [];
        const defaultHandle = data.default_handle || 'default';

        logger.info(`[KeywordExecutor] Searching keywords in: "${textToSearch.substring(0, 30)}..."`);

        for (const entry of keywords) {
            const word = entry.word.toLowerCase().trim();
            if (textToSearch.includes(word)) {
                logger.info(`[KeywordExecutor] Match found: "${word}" -> handle: ${entry.handle}`);
                return {
                    messages: [],
                    wait_for_input: false,
                    conditionResult: entry.handle
                };
            }
        }

        logger.info(`[KeywordExecutor] No match found. Rowting to: ${defaultHandle}`);
        return {
            messages: [],
            wait_for_input: false,
            conditionResult: defaultHandle
        };
    }
}
