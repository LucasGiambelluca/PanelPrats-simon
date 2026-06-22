import type { ToolContext, ToolResult } from './types';
import type { AppointmentService as ApptSvc } from '../../../services/AppointmentService';
import type { KnowledgeBase } from './KnowledgeBase';

export interface ToolDeps {
  appointments: typeof ApptSvc;
  knowledge: KnowledgeBase;
  // marca HANDOVER y corta el bot; recibe identidad server-side + payload del modelo.
  handoff: (accountId: string, phone: string, payload: { motivo: string; resumen_caso: string }) => Promise<void>;
}

// Esquema de tools en formato OpenAI function-calling.
const SCHEMAS = [
  { type: 'function', function: { name: 'check_availability', description: 'Lista horarios libres en una ventana de fechas.', parameters: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, oficina: { type: 'string' } }, required: ['desde', 'hasta'] } } },
  { type: 'function', function: { name: 'book_appointment', description: 'Agenda una cita. Confirmá los datos con el cliente ANTES de llamar.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, oficina: { type: 'string' }, resumen: { type: 'string' } }, required: ['nombre', 'start_time', 'end_time', 'resumen'] } } },
  { type: 'function', function: { name: 'reschedule_appointment', description: 'Reprograma una cita existente.', parameters: { type: 'object', properties: { appointment_id: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' } }, required: ['appointment_id', 'start_time', 'end_time'] } } },
  { type: 'function', function: { name: 'cancel_appointment', description: 'Cancela una cita existente.', parameters: { type: 'object', properties: { appointment_id: { type: 'string' } }, required: ['appointment_id'] } } },
  { type: 'function', function: { name: 'search_knowledge', description: 'Busca en la base del estudio. Usala SIEMPRE antes de responder temas previsionales.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'handoff_to_human', description: 'Deriva la conversación a una persona del estudio.', parameters: { type: 'object', properties: { motivo: { type: 'string' }, resumen_caso: { type: 'string' } }, required: ['motivo', 'resumen_caso'] } } },
];

export class ToolRegistry {
  constructor(private deps: ToolDeps) {}

  schemas() { return SCHEMAS; }

  /** Ejecuta una tool. La identidad (accountId/phone) viene del ctx, NUNCA de args. */
  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      switch (name) {
        case 'check_availability': {
          const list = await this.deps.appointments.list(ctx.accountId);
          const ocupadas = list
            .filter((a) => a.status !== 'cancelada' && a.start_time && (!args.oficina || (a.oficina || '') === args.oficina))
            .map((a) => ({ start: a.start_time, end: a.end_time, oficina: a.oficina }));
          return { ok: true, data: { ocupadas, desde: args.desde, hasta: args.hasta } };
        }
        case 'book_appointment': {
          const appt = await this.deps.appointments.create({
            account_id: ctx.accountId, phone: ctx.phone, telefono: ctx.phone,
            nombre: args.nombre, resumen: args.resumen ?? '', status: 'pendiente',
            start_time: args.start_time, end_time: args.end_time, oficina: args.oficina,
          } as any);
          return { ok: true, data: { appointment_id: appt.id } };
        }
        case 'reschedule_appointment': {
          await this.deps.appointments.update(args.appointment_id, { start_time: args.start_time, end_time: args.end_time });
          return { ok: true };
        }
        case 'cancel_appointment': {
          await this.deps.appointments.update(args.appointment_id, { status: 'cancelada' });
          return { ok: true };
        }
        case 'search_knowledge': {
          const hit = await this.deps.knowledge.search(ctx.accountId, args.query ?? '');
          return { ok: true, data: hit };
        }
        case 'handoff_to_human': {
          await this.deps.handoff(ctx.accountId, ctx.phone, { motivo: args.motivo ?? '', resumen_caso: args.resumen_caso ?? '' });
          return { ok: true, data: { handoff: true } };
        }
        default:
          return { ok: false, error: `tool desconocida: ${name}` };
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg === 'SLOT_TAKEN') return { ok: false, error: 'Ese horario ya está ocupado, ofrecé otro.' };
      return { ok: false, error: 'No pude completar la acción; ofrecé derivar a una persona.' };
    }
  }
}
