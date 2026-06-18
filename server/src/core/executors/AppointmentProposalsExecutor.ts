import { NodeExecutor, ExecutionContext, NodeExecutionResult } from './types';
import { AppointmentService } from '../../services/AppointmentService';

export class AppointmentProposalsExecutor implements NodeExecutor {
    async execute(nodeData: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const allowedDays: number[] = Array.isArray(nodeData.allowedDays) 
            ? nodeData.allowedDays.map(Number)
            : [1, 2, 3, 4, 5]; // Por defecto Lunes a Viernes

        const startHourStr = nodeData.startHour || '09:00';
        const endHourStr = nodeData.endHour || '18:00';
        const slotDurationMin = Number(nodeData.slotDuration) || 60;
        const maxProposals = Number(nodeData.maxProposals) || 3;
        const outputVar = nodeData.outputVariable || 'horarios_disponibles';
        // Oficina/modalidad: si está definida, la disponibilidad es un pool independiente
        // (solo cuentan los turnos de ESA oficina para el solapamiento).
        const oficinaVar = nodeData.oficinaVar || 'oficina';
        const oficina = String(nodeData.oficina || (context as any)[oficinaVar] || '').trim();

        const [startH, startM] = startHourStr.split(':').map(Number);
        const [endH, endM] = endHourStr.split(':').map(Number);

        console.log(`[AppointmentProposalsExecutor] Buscando hasta ${maxProposals} horarios libres. Días permitidos: ${allowedDays.join(',')}`);

        try {
            const appointments = await AppointmentService.list(context.accountId);
            const activeAppointments = appointments.filter(app =>
                app.status !== 'cancelada' && app.start_time && app.end_time &&
                (!oficina || (app.oficina || '') === oficina)
            );

            const proposedSlots: { start: Date; end: Date }[] = [];
            const now = new Date();

            let currentSearchDate = new Date(now);
            const minutes = currentSearchDate.getMinutes();
            const rem = minutes % slotDurationMin;
            if (rem !== 0) {
                currentSearchDate.setMinutes(minutes + (slotDurationMin - rem), 0, 0);
            } else {
                currentSearchDate.setSeconds(0, 0);
            }

            for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
                if (proposedSlots.length >= maxProposals) break;

                const dayToCheck = new Date(currentSearchDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
                const dayOfWeek = dayToCheck.getDay();

                if (!allowedDays.includes(dayOfWeek)) continue;

                const workStart = new Date(dayToCheck);
                workStart.setHours(startH || 9, startM || 0, 0, 0);

                const workEnd = new Date(dayToCheck);
                workEnd.setHours(endH || 18, endM || 0, 0, 0);

                let slotStart = new Date(workStart);
                if (dayOffset === 0 && now > workStart) {
                    slotStart = new Date(currentSearchDate);
                    if (slotStart < workStart) {
                        slotStart = new Date(workStart);
                    }
                }

                while (slotStart < workEnd && proposedSlots.length < maxProposals) {
                    const slotEnd = new Date(slotStart.getTime() + slotDurationMin * 60 * 1000);

                    if (slotEnd > workEnd) break;
                    if (slotStart <= now) {
                        slotStart = slotEnd;
                        continue;
                    }

                    const hasOverlap = activeAppointments.some(app => {
                        const appStart = new Date(app.start_time!).getTime();
                        const appEnd = new Date(app.end_time!).getTime();
                        const reqStart = slotStart.getTime();
                        const reqEnd = slotEnd.getTime();
                        return appStart < reqEnd && appEnd > reqStart;
                    });

                    if (!hasOverlap) {
                        proposedSlots.push({
                            start: new Date(slotStart),
                            end: new Date(slotEnd)
                        });
                    }

                    slotStart = slotEnd;
                }
            }

            const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            const formattedLines = proposedSlots.map((slot, index) => {
                const dayName = diasSemana[slot.start.getDay()];
                const dateStr = `${String(slot.start.getDate()).padStart(2, '0')}/${String(slot.start.getMonth() + 1).padStart(2, '0')}`;
                const timeStr = `${String(slot.start.getHours()).padStart(2, '0')}:${String(slot.start.getMinutes()).padStart(2, '0')}`;
                return `${index + 1}) ${dayName} ${dateStr} a las ${timeStr} hs`;
            });

            const formattedText = formattedLines.length > 0
                ? formattedLines.join('\n')
                : 'No hay horarios disponibles en los próximos días.';

            console.log(`[AppointmentProposalsExecutor] Encontrados ${proposedSlots.length} horarios libres.`);

            const slotsArray = proposedSlots.map(slot => ({
                start: slot.start.toISOString(),
                end: slot.end.toISOString()
            }));

            context[outputVar] = formattedText;
            context[`${outputVar}_array`] = slotsArray;

            // Emitir el listado como mensaje: el nodo "sugerir horarios" debe MOSTRAR
            // los horarios, no solo guardarlos en una variable (antes quedaba mudo).
            // Si data.text trae plantilla, se usa esa con {{outputVar}} reemplazado.
            const message = typeof nodeData.text === 'string' && nodeData.text.trim()
                ? nodeData.text.replace(new RegExp(`{{\\s*${outputVar}\\s*}}`, 'g'), formattedText)
                : formattedText;

            // updatedContext es lo ÚNICO que flow.engine persiste en la sesión.
            // Sin esto, horarios_array se pierde y el nodo de agendar (turno siguiente)
            // no encuentra el slot elegido.
            return {
                messages: [message],
                wait_for_input: false,
                updatedContext: {
                    [outputVar]: formattedText,
                    [`${outputVar}_array`]: slotsArray,
                },
            };
        } catch (e: any) {
            console.error('[AppointmentProposalsExecutor] Error al sugerir horarios:', e);
            context[outputVar] = 'Error al consultar disponibilidad de horarios.';
            return {
                messages: [],
                wait_for_input: false
            };
        }
    }
}
