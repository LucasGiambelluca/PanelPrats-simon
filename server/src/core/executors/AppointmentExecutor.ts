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
/** Resuelve una referencia a variable del contexto. Acepta 'fecha' o '{{fecha}}'. */
function resolveVar(ctx: any, ref: string | undefined, fallbackKey: string): string {
    const key = (ref || fallbackKey).replace(/[{}]/g, '').trim();
    const val = ctx[key];
    return val == null ? '' : String(val);
}

/** Construye un ISO a partir de fecha (YYYY-MM-DD) + hora (HH:MM). Vacío si inválido. */
function buildISO(date: string, hour: string): string | undefined {
    if (!date) return undefined;
    const t = hour && /^\d{1,2}:\d{2}/.test(hour) ? hour : '09:00';
    const d = new Date(`${date}T${t}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export class AppointmentExecutor implements NodeExecutor {
    async execute(nodeData: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const nombre = resolveVar(context, nodeData.nombreVar, 'nombre');
        const telefono = resolveVar(context, nodeData.telefonoVar, 'telefono') || context.phone || '';
        const resumen = resolveVar(context, nodeData.resumenVar, 'resumen');
        const oficina = String(nodeData.oficina || resolveVar(context, nodeData.oficinaVar, 'oficina')).trim();

        // Fecha/hora del turno (opcionales): si el flujo las capturó, la cita cae en
        // ese horario en la Agenda; si no, AppointmentService usa created_at.
        const fecha = resolveVar(context, nodeData.dateVar, 'fecha');
        const horaInicio = resolveVar(context, nodeData.startHourVar, 'hora_inicio');
        const horaFin = resolveVar(context, nodeData.endHourVar, 'hora_fin');

        // Slot elegido de un nodo de propuestas (appointmentProposalsNode):
        // si existe el array de horarios y el usuario respondió con un número,
        // usamos ese slot exacto. Si no, caemos a fecha/hora sueltas.
        const slotsArr = context[nodeData.slotsVar || 'horarios_array'];
        const choiceRaw = resolveVar(context, nodeData.slotChoiceVar, 'opcion_horario');
        const choiceIdx = parseInt(String(choiceRaw).replace(/[^\d]/g, ''), 10) - 1;

        let start_time: string | undefined;
        let end_time: string | undefined;
        if (Array.isArray(slotsArr) && choiceIdx >= 0 && slotsArr[choiceIdx]?.start) {
            start_time = slotsArr[choiceIdx].start;
            end_time = slotsArr[choiceIdx].end;
        } else {
            start_time = buildISO(fecha, horaInicio);
            // Fin: hora_fin si hay; si no, +1h del inicio.
            end_time = buildISO(fecha, horaFin)
                || (start_time ? new Date(new Date(start_time).getTime() + 60 * 60000).toISOString() : undefined);
        }

        console.log(`[AppointmentExecutor] Agendando cita para "${nombre}" (${telefono}) | ${start_time || 'sin fecha'}`);

        try {
            await AppointmentService.create({
                account_id: context.accountId,
                phone: telefono,
                nombre,
                telefono,
                resumen,
                status: 'pendiente',
                start_time,
                end_time,
                oficina,
            });

            // Interpolar {{variables}} en el mensaje de confirmación (ej {{nombre}}).
            const confirmText = (nodeData.text || '✅ ¡Listo! Tu cita quedó agendada. Te contactamos a la brevedad.')
                .replace(/\{\{\s*(\w+)\s*\}\}/g, (_: string, v: string) => {
                    const val = (context as any)[v];
                    return val === undefined || val === null ? '' : String(val);
                });

            return {
                messages: [confirmText],
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
