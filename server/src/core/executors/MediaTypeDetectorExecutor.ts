import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { logger } from '../../utils/logger';

/**
 * MediaTypeDetectorExecutor — Detecta si el mensaje entrante es audio o texto
 *
 * Este nodo NO espera input. Evalúa las variables del contexto que ya fueron
 * inyectadas por el WhatsAppClient al procesar el mensaje.
 *
 * Configuración del nodo (data):
 * - output_variable: Variable donde guardar el tipo detectado (default: 'media_type')
 * - audio_handle: Handle para la salida de audio (default: 'audio')
 * - text_handle: Handle para la salida de texto (default: 'text')
 *
 * Outputs (conditionResult):
 *   → "audio" si el mensaje original era un audio (nota de voz)
 *   → "text" si era texto normal
 *   → "image" si era una imagen
 *   → "location" si era una ubicación GPS
 *   → "unknown" si no se pudo determinar
 *
 * Context Variables inyectadas:
 *   - {output_variable}: tipo de media ('audio' | 'text' | 'image' | 'location' | 'unknown')
 *   - {output_variable}_is_audio: boolean
 *   - {output_variable}_is_text: boolean
 *   - {output_variable}_transcription: string (si era audio, el texto ya transcrito)
 */
export class MediaTypeDetectorExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        const outputVariable = data.output_variable || 'media_type';
        const audioHandle = data.audio_handle || 'audio';
        const textHandle = data.text_handle || 'text';

        // Detectar tipo basado en las variables del contexto
        // El WhatsAppClient inyecta _isAudio, _receivedFile, _location en fileContext
        let mediaType = 'text';

        if (context._isAudio) {
            mediaType = 'audio';
        } else if (context._location || context._LOCATION_RECEIVED_) {
            mediaType = 'location';
        } else if (context._receivedFile) {
            const mime = context._receivedFile?.mimeType || '';
            if (mime.startsWith('image/')) {
                mediaType = 'image';
            } else {
                mediaType = 'file';
            }
        }

        logger.info(`🎙️ [MediaTypeDetector] Detected: ${mediaType} | isAudio: ${context._isAudio || false}`);

        // El conditionResult permite ramificar el flujo
        const handle = mediaType === 'audio' ? audioHandle : textHandle;

        return {
            messages: [],
            wait_for_input: false,
            conditionResult: handle,
            updatedContext: {
                [outputVariable]: mediaType,
                [`${outputVariable}_is_audio`]: mediaType === 'audio',
                [`${outputVariable}_is_text`]: mediaType === 'text',
                [`${outputVariable}_transcription`]: mediaType === 'audio' ? (context.respuesta || context._transcription || '') : '',
            },
        };
    }
}
