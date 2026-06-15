import { NodeExecutor, ExecutionContext, NodeExecutionResult } from './types';
import { supabase } from '../../config/database';

/**
 * ReportExecutor — Registra un reporte/reclamo generado desde un flujo.
 *
 * ADAPTACIÓN (Plan 2, Task 5): el origen escribía en las tablas de comercio
 * `clients` (para resolver client_id) y `claims`. En el panel genérico esas
 * tablas no existen, así que se repunta el insert a una tabla genérica
 * `reports`. Si el insert falla (p. ej. la tabla aún no existe), se loguea el
 * error y se responde con un mensaje de confirmación controlado para no romper
 * el flujo.
 */
export class ReportExecutor implements NodeExecutor {
    async execute(nodeData: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        const descriptionVar = nodeData.variable || 'claim_description';
        const description = context[descriptionVar] || context.temp_input || 'No description provided';
        const type = nodeData.reportType || 'reclamo';
        const priority = nodeData.priority || 'medium';

        console.log(`[ReportExecutor] Creating report for user ${context.phone}`);

        try {
            // Create report in the generic `reports` table.
            const { error } = await supabase
                .from('reports')
                .insert({
                    account_id: context.accountId,
                    phone: context.phone,
                    type,
                    description,
                    priority,
                    status: 'open',
                    metadata: {
                        source: 'whatsapp_bot',
                        flow_context: context
                    }
                });

            if (error) {
                console.error("[ReportExecutor] Failed to create report:", error);
                return {
                    messages: ["⚠️ Hubo un error al registrar tu reporte. Por favor intenta más tarde."],
                    wait_for_input: false
                };
            }

            return {
                messages: nodeData.text ? [nodeData.text] : ["✅ Tu reporte ha sido registrado exitosamente. Nos pondremos en contacto pronto."],
                wait_for_input: false
            };

        } catch (e) {
            console.error("[ReportExecutor] Unexpected error:", e);
            return {
                messages: ["⚠️ Error inesperado al procesar el reporte."],
                wait_for_input: false
            };
        }
    }
}
