import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class SendMediaExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        // Interpolación básica de variables en el caption
        let caption = data.caption || '';
        caption = caption.replace(/\{\{(\w+)\}\}/g, (_: string, varName: string) => {
            return context[varName] || '';
        });

        let messageObj: any = null;

        if (data.mediaType === 'image') {
            messageObj = {
                image: { url: data.mediaUrl },
                caption: caption
            };
        } else {
            messageObj = {
                document: { url: data.mediaUrl },
                mimetype: data.mimetype || 'application/pdf',
                fileName: data.fileName || 'documento.pdf',
                caption: caption
            };
        }

        return {
            messages: [messageObj],
            wait_for_input: false,
        };
    }
}
