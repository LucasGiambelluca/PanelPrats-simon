import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class MediaUploadExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        // 1. Check if we received a file in the context (injected by index.ts -> router -> engine)
        const receivedFile = context._receivedFile;

        if (receivedFile) {
            console.log(`[MediaUploadExecutor] File received: ${receivedFile.url}`);

            // 2. Validate (Optional: max size, type check if needed beyond what we did in index.ts)
            // For now, we assume index.ts did the heavy lifting.

            // 3. Save to variable
            const varName = data.variable || 'file_url'; // Default variable

            return {
                messages: ["✅ Archivo recibido correctamente."],
                wait_for_input: false,
                updatedContext: {
                    [varName]: receivedFile.url,
                    _receivedFile: null // Clear it so it doesn't persist to next nodes
                }
            };
        }

        // 4. If no file, ask for it
        return {
            messages: [data.message || "📸 Por favor, envía la imagen o documento."],
            wait_for_input: true
        };
    }
}
