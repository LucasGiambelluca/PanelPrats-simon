import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { logger } from '../../utils/logger';

export class AudioToTextExecutor implements NodeExecutor {
    /**
     * Cuando el flujo llega aquí, se detiene y espera el audio del usuario.
     */
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const variableName = data.output_variable || data.variable || 'transcripcion';

        // --- DYNAMIC IN-FLOW TRANSCRIPTION ---
        // Extraemos la URL del archivo de audio que guardó el cliente WhatsApp.
        if (context._is_audio && context._receivedFile?.url) {
            try {
                if (context.user_message && context.user_message !== '_AUDIO_RECEIVED_') {
                     // Si ya venía transcrito de alguna forma, lo pasamos (Fallback)
                     logger.info(`[AudioToTextExecutor] Auto-processing existing transcription: "${context.user_message.substring(0, 30)}..."`);
                     return {
                         wait_for_input: false,
                         messages: [],
                         updatedContext: {
                             [variableName]: context.user_message,
                             _was_audio: true
                         }
                     };
                }

                logger.info(`[AudioToTextExecutor] Downloading audio from ${context._receivedFile.url} for transcription...`);
                // Descargamos el buffer desde la URL pública
                const axios = require('axios');
                const response = await axios.get(context._receivedFile.url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);

                logger.info(`[AudioToTextExecutor] Audio downloaded. Transcribing with AI...`);
                const { AIService } = require('../../services/AIService');
                const transcription = await AIService.transcribe(buffer, 'voice.ogg');

                if (transcription) {
                    logger.info(`[AudioToTextExecutor] Transcription successful: "${transcription}"`);
                    return {
                        wait_for_input: false,
                        messages: [],
                        updatedContext: {
                            [variableName]: transcription,
                            user_message: transcription, // Replace raw tag with actual text
                            _was_audio: true
                        }
                    };
                } else {
                    logger.warn(`[AudioToTextExecutor] Transcription returned empty.`);
                }
            } catch (err: any) {
                logger.error(`[AudioToTextExecutor] Error during transcription process: ${err.message}`);
            }
        }

        logger.info(`[AudioToTextExecutor] Waiting for audio input...`);
        return {
            wait_for_input: true,
            messages: []
        };
    }

    /**
     * Valida si el input fue audio y guarda la transcripción.
     */
    async handleInput(input: string, data: any, context: ExecutionContext) {
        const variableName = data.output_variable || data.variable || 'transcripcion';

        if (!input || input === '_MEDIA_RECEIVED_') {
            return {
                isValidInput: false,
                messages: ['⚠️ No pude procesar el audio. Por favor, intentá mandarlo de nuevo.']
            };
        }

        logger.info(`[AudioToTextExecutor] Transcripción capturada con éxito: "${input.substring(0, 50)}..."`);

        return {
            isValidInput: true,
            updatedContext: {
                [variableName]: input,
                _was_audio: true
            }
        };
    }
}
