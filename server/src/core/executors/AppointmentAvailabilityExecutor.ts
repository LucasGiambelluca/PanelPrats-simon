import { NodeExecutor, ExecutionContext, NodeExecutionResult } from './types';
import { AppointmentService } from '../../services/AppointmentService';

function resolveVar(ctx: any, ref: string | undefined, fallbackKey: string): string {
    const key = (ref || fallbackKey).replace(/[{}]/g, '').trim();
    const val = ctx[key];
    return val == null ? '' : String(val);
}

function buildISO(date: string, hour: string): string | undefined {
    if (!date) return undefined;
    const t = hour && /^\d{1,2}:\d{2}/.test(hour) ? hour : '09:00';
    const d = new Date(`${date}T${t}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export class AppointmentAvailabilityExecutor implements NodeExecutor {
    async execute(nodeData: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const fecha = resolveVar(context, nodeData.dateVar, 'fecha');
        const horaInicio = resolveVar(context, nodeData.startHourVar, 'hora_inicio');
        const horaFin = resolveVar(context, nodeData.endHourVar, 'hora_fin');

        const start_time = buildISO(fecha, horaInicio);
        const end_time = buildISO(fecha, horaFin)
            || (start_time ? new Date(new Date(start_time).getTime() + 60 * 60000).toISOString() : undefined);

        if (!start_time || !end_time) {
            console.warn(`[AppointmentAvailabilityExecutor] Fecha u hora inválidas: fecha="${fecha}", inicio="${horaInicio}", fin="${horaFin}"`);
            return {
                messages: [],
                wait_for_input: false,
                conditionResult: false,
            };
        }

        console.log(`[AppointmentAvailabilityExecutor] Chequeando disponibilidad: ${start_time} -> ${end_time}`);

        try {
            const appointments = await AppointmentService.list(context.accountId);
            
            // Buscar solapamientos
            const isOverlap = appointments.some(app => {
                if (app.status === 'cancelada') return false;
                if (!app.start_time || !app.end_time) return false;
                
                const appStart = new Date(app.start_time).getTime();
                const appEnd = new Date(app.end_time).getTime();
                const reqStart = new Date(start_time).getTime();
                const reqEnd = new Date(end_time).getTime();
                
                return appStart < reqEnd && appEnd > reqStart;
            });

            const isAvailable = !isOverlap;
            console.log(`[AppointmentAvailabilityExecutor] Resultado: ${isAvailable ? '✅ DISPONIBLE' : '❌ SOLAPADO'}`);

            return {
                messages: [],
                wait_for_input: false,
                conditionResult: isAvailable,
            };
        } catch (e: any) {
            console.error('[AppointmentAvailabilityExecutor] Error al consultar disponibilidad:', e);
            return {
                messages: [],
                wait_for_input: false,
                conditionResult: false,
            };
        }
    }
}
