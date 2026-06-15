import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

/**
 * DocumentExecutor — Genera un comprobante PDF de un pedido.
 *
 * ADAPTACIÓN (Plan 2, Task 5): el origen importaba `PdfService` (acoplado a
 * comercio + dependencia `pdfkit`, ninguna de las cuales se porta al panel
 * genérico). Para mantener el executor registrable y que el motor compile sin
 * agregar `pdfkit`, este nodo queda como no-op funcional: si no hay servicio de
 * PDF disponible, devuelve un mensaje de error controlado en lugar de generar
 * el comprobante. Cuando exista un PdfService genérico, reemplazar el cuerpo.
 */
export class DocumentExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        console.log('[DocumentExecutor] PDF generation requested but no PdfService is available (generic panel). Returning controlled no-op.');

        return {
            messages: [
                data.unavailable_message ||
                "⚠️ La generación de comprobantes PDF no está disponible en este momento."
            ],
            wait_for_input: false
        };
    }
}
