import { NodeExecutor, ExecutionContext, NodeExecutionResult } from './types';
import { AppointmentService } from '../../services/AppointmentService';
import { supabase } from '../../config/supabase';
import { notify } from '../../services/NotifierService';
import { AIService } from '../../services/AIService';
import { buildReceptionFicha } from '../agent/context/ReceptionFichaBuilder';
import { redisPersistence } from '../../infrastructure/persistence/RedisPersistenceService';
import { validarTelefonoAR } from '../../utils/phone-ar';

// Ficha IA best-effort (Capacidad 2): arma resumen + perfil desde el historial.
// Si no hay IA / historial, devuelve nulls (la cita se agenda igual).
async function buildFichaBestEffort(accountId: string, phone: string, oficina: string, resumen: string): Promise<{ resumen_ia: string | null; perfil_json: any }> {
  try {
    const hist = await redisPersistence.getHistory(accountId, phone, 16);
    const convo = (hist ?? []).map((m: any) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content}`).join('\n')
      || (resumen ? `Cliente: ${resumen}` : '');
    if (!convo.trim()) return { resumen_ia: null, perfil_json: null };
    const modalidad = /video|llamada|virtual/i.test(oficina) ? 'video' : 'presencial';
    const ficha = await buildReceptionFicha({ complete: (o) => AIService.complete(o) }, { conversation: convo, ctx: { telefono: phone, modalidad }, model: 'gpt-4o' });
    return { resumen_ia: ficha.resumen_ia || null, perfil_json: ficha };
  } catch {
    return { resumen_ia: null, perfil_json: null };
  }
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function fechaLegible(iso?: string): string {
  if (!iso) return 'a coordinar';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'a coordinar';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${DIAS[d.getDay()]} ${dd}/${mm} ${hh}:${mi} hs`;
}

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
        let telefono = resolveVar(context, nodeData.telefonoVar, 'telefono') || context.phone || '';
        // Validar por conformación (código de área AR). Si el cliente escribió un número
        // inválido o una referencia ("el mismo", "este"), usamos el de WhatsApp (context.phone).
        const tel = validarTelefonoAR(String(telefono));
        if (tel.valido && tel.normalizado) {
            telefono = tel.normalizado;
        } else {
            telefono = context.phone || telefono;
        }
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
        let assignedProfileId: string | null = null;
        let slotOficina = '';
        if (Array.isArray(slotsArr) && choiceIdx >= 0 && slotsArr[choiceIdx]?.start) {
            start_time = slotsArr[choiceIdx].start;
            end_time = slotsArr[choiceIdx].end;
            // Slot del motor en cascada: trae la chica (profileId) y la agenda (oficina).
            assignedProfileId = slotsArr[choiceIdx].profileId ?? null;
            if (slotsArr[choiceIdx].oficina) slotOficina = String(slotsArr[choiceIdx].oficina);
        } else {
            start_time = buildISO(fecha, horaInicio);
            // Fin: hora_fin si hay; si no, +1h del inicio.
            end_time = buildISO(fecha, horaFin)
                || (start_time ? new Date(new Date(start_time).getTime() + 60 * 60000).toISOString() : undefined);
        }

        console.log(`[AppointmentExecutor] Agendando cita para "${nombre}" (${telefono}) | ${start_time || 'sin fecha'}`);

        try {
            const ficha = await buildFichaBestEffort(context.accountId, telefono || context.phone, slotOficina || oficina, resumen);
            await AppointmentService.create({
                account_id: context.accountId,
                phone: telefono,
                nombre,
                telefono,
                resumen,
                status: 'pendiente',
                start_time,
                end_time,
                oficina: slotOficina || oficina,
                assigned_profile_id: assignedProfileId,
                resumen_ia: ficha.resumen_ia,
                perfil_json: ficha.perfil_json,
            });

            // ── Notificación a la operadora (línea del estudio) ───────────────────
            // Avisa al número de la línea (o a notify_phone si está configurado) con el
            // resumen + link wa.me al cliente, para que la operadora videollame a mano
            // desde la app de WhatsApp (no se puede iniciar video por API).
            try {
                const { data: acc } = await supabase
                    .from('accounts')
                    .select('phone_number, name')
                    .eq('id', context.accountId)
                    .maybeSingle();
                const notifyTo = String(nodeData.notifyVar ? resolveVar(context, nodeData.notifyVar, 'notify_phone') : '')
                    || String((acc as any)?.phone_number || '').replace(/\D/g, '');
                const leadDigits = String(telefono || '').replace(/\D/g, '');
                if (notifyTo && leadDigits) {
                    const msg =
                        `📅 *Nueva cita agendada*\n` +
                        `Cliente: ${nombre || '—'}\n` +
                        `🗓️ ${fechaLegible(start_time)}` + (oficina ? ` · ${oficina}` : '') + `\n` +
                        (resumen ? `Tema: ${resumen}\n` : '') +
                        `👉 Llamar al cliente: https://wa.me/${leadDigits}` +
                        ((acc as any)?.name ? `\nLínea: ${(acc as any).name}` : '');
                    await notify(context.accountId, notifyTo, msg);
                }
            } catch (e: any) {
                console.warn('[AppointmentExecutor] notificación no enviada:', e?.message || e);
            }

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
            if (String(e?.message) === 'SLOT_TAKEN') {
                console.warn('[AppointmentExecutor] slot ocupado al confirmar:', start_time);
                return {
                    messages: ['⚠️ Ese horario se acaba de ocupar. Por favor elegí otro horario.'],
                    wait_for_input: false,
                };
            }
            console.error('[AppointmentExecutor] Error al guardar la cita:', e);
            return {
                messages: ['⚠️ Hubo un error al agendar la cita. Por favor intentá más tarde.'],
                wait_for_input: false,
            };
        }
    }
}
