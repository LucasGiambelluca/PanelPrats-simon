import { NodeExecutor, ExecutionContext, NodeExecutionResult } from './types';
import { AppointmentService } from '../../services/AppointmentService';

/**
 * AppointmentExecutor — Agenda una cita: guarda nombre, teléfono y resumen
 * del caso en la tabla `appointments` (scoped por account_id).
 *
 * Config (data.*):
 *  - nombreVar    (default 'nombre')   : variable del contexto con el nombre
 *  - telefonoVar  (default 'telefono') : variable con el teléfono (cae a context.phone si vacío)
 *  - resumenVar   (default 'resumen')  : variable con el resumen del caso
 *  - text                              : mensaje de confirmación (opcional)
 *
 * Las variables se llenan en nodos previos (questionNode, etc.).
 */
export class AppointmentExecutor implements NodeExecutor {
    async execute(nodeData: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const nombre = context[nodeData.nombreVar || 'nombre'] || '';
        const telefono = context[nodeData.telefonoVar || 'telefono'] || context.phone || '';
        const resumen = context[nodeData.resumenVar || 'resumen'] || '';

        console.log(`[AppointmentExecutor] Agendando cita para "${nombre}" (${telefono})`);

        try {
            await AppointmentService.create({
                account_id: context.accountId,
                phone: telefono,
                nombre,
                telefono,
                resumen,
                status: 'pendiente',
            });

            return {
                messages: [nodeData.text || '✅ ¡Listo! Tu cita quedó agendada. Te contactamos a la brevedad.'],
                wait_for_input: false,
            };
        } catch (e: any) {
            console.error('[AppointmentExecutor] Error al guardar la cita:', e);
            return {
                messages: ['⚠️ Hubo un error al agendar la cita. Por favor intentá más tarde.'],
                wait_for_input: false,
            };
        }
    }
}
