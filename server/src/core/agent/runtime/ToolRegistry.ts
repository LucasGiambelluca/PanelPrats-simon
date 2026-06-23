import type { ToolContext, ToolResult } from './types';
import type { AppointmentService as ApptSvc } from '../../../services/AppointmentService';
import type { KnowledgeBase } from './KnowledgeBase';
import type { AvailabilityService } from '../../../services/AvailabilityService';

export interface ToolDeps {
  appointments: typeof ApptSvc;
  knowledge: KnowledgeBase;
  availability: AvailabilityService;
  // marca HANDOVER y corta el bot; recibe identidad server-side + payload del modelo.
  handoff: (accountId: string, phone: string, payload: { motivo: string; resumen_caso: string }) => Promise<void>;
}

// Esquema de tools en formato OpenAI function-calling.
const SCHEMAS = [
  { type: 'function', function: { name: 'list_offices', description: 'Lista las oficinas/modalidades del estudio (presencial y video) con su dirección. Usala antes de ofrecer un turno.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'check_availability', description: 'Lista los horarios LIBRES (no ocupados) de una oficina en una ventana de fechas. Llamá list_offices primero para saber qué oficina pasar.', parameters: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, oficina: { type: 'string' } }, required: ['desde', 'hasta', 'oficina'] } } },
  { type: 'function', function: { name: 'book_appointment', description: 'Agenda una cita. Confirmá los datos con el cliente ANTES de llamar.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, oficina: { type: 'string' }, resumen: { type: 'string' } }, required: ['nombre', 'start_time', 'end_time', 'oficina', 'resumen'] } } },
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
        case 'list_offices': {
          const oficinas = (await this.deps.availability.listOffices(ctx.accountId))
            .map((o) => ({ nombre: o.nombre, modalidad: o.modalidad, direccion: o.direccion ?? null }));
          return { ok: true, data: { oficinas } };
        }
        case 'check_availability': {
          const slots = await this.deps.availability.freeSlots(ctx.accountId, args.oficina, { desde: args.desde, hasta: args.hasta, max: 3 });
          if (!slots.length) {
            const existe = await this.deps.availability.getOffice(ctx.accountId, args.oficina);
            return { ok: true, data: { oficina: args.oficina, slots: [], sin_oficina: !existe } };
          }
          return { ok: true, data: { oficina: args.oficina, slots } };
        }
        case 'book_appointment': {
          const office = await this.deps.availability.getOffice(ctx.accountId, args.oficina);
          const hasProfs = office ? await this.deps.availability.officeHasProfessionals(office) : false;
          let assigned: string | null = null;
          if (hasProfs) {
            assigned = await this.deps.availability.pickProfessional(office!, args.start_time, args.end_time);
            if (!assigned) return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          } else if (!(await this.deps.availability.hasCapacity(ctx.accountId, args.oficina, args.start_time, args.end_time))) {
            return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          }
          const appt = await this.deps.appointments.create({
            account_id: ctx.accountId, phone: ctx.phone, telefono: ctx.phone,
            nombre: args.nombre, resumen: args.resumen ?? '', status: 'pendiente',
            start_time: args.start_time, end_time: args.end_time, oficina: args.oficina,
            assigned_profile_id: assigned,
          } as any);
          return { ok: true, data: { appointment_id: appt.id, modalidad: office?.modalidad, direccion: office?.direccion ?? undefined, video_link: office?.video_link ?? undefined } };
        }
        case 'reschedule_appointment': {
          const appt = await this.deps.appointments.getById(args.appointment_id);
          if (!appt || appt.account_id !== ctx.accountId || appt.phone !== ctx.phone) {
            return { ok: false, error: 'No encuentro esa cita a tu nombre.' };
          }
          const office = await this.deps.availability.getOffice(ctx.accountId, appt.oficina ?? '');
          const hasProfs = office ? await this.deps.availability.officeHasProfessionals(office) : false;
          let assigned: string | null = null;
          if (hasProfs) {
            assigned = await this.deps.availability.pickProfessional(office!, args.start_time, args.end_time);
            if (!assigned) return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          } else if (!(await this.deps.availability.hasCapacity(ctx.accountId, appt.oficina ?? '', args.start_time, args.end_time))) {
            return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          }
          await this.deps.appointments.update(args.appointment_id, { start_time: args.start_time, end_time: args.end_time, assigned_profile_id: assigned });
          return { ok: true };
        }
        case 'cancel_appointment': {
          const appt = await this.deps.appointments.getById(args.appointment_id);
          if (!appt || appt.account_id !== ctx.accountId || appt.phone !== ctx.phone) {
            return { ok: false, error: 'No encuentro esa cita a tu nombre.' };
          }
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
