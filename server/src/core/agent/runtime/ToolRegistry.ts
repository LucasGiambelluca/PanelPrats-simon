import type { ToolContext, ToolResult } from './types';
import type { AppointmentService as ApptSvc } from '../../../services/AppointmentService';
import type { KnowledgeBase } from './KnowledgeBase';
import type { AvailabilityService } from '../../../services/AvailabilityService';
import type { OfferedOption } from '../context/OptionResolver';
import { resolveOption } from '../context/OptionResolver';
import { validarTelefonoAR } from '../../../utils/phone-ar';
import { validateQualification } from '../context/QualificationRules';

const TZ = 'America/Argentina/Buenos_Aires';
function fmtSlot(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: TZ,
    });
  } catch { return iso; }
}

export interface ToolDeps {
  appointments: typeof ApptSvc;
  knowledge: KnowledgeBase;
  availability: AvailabilityService;
  // marca HANDOVER y corta el bot; recibe identidad server-side + payload del modelo.
  handoff: (accountId: string, phone: string, payload: { motivo: string; resumen_caso: string }) => Promise<void>;

  // ── Capacidades nuevas (opcionales: si faltan, la tool degrada con gracia) ──
  // Geo-routing (Capacidad 3).
  suggestOffice?: (accountId: string, texto: string) => Promise<any>;
  // Opciones ofrecidas (Capacidad 4): persisten qué se mostró y en qué orden.
  offered?: { set: (accountId: string, phone: string, opts: OfferedOption[]) => Promise<void>; get: (accountId: string, phone: string) => Promise<OfferedOption[]> };
  // Ficha IA al agendar (Capacidad 2).
  buildFicha?: (conversation: string, ctx: { telefono: string; modalidad: 'presencial' | 'video'; zona?: string | null }) => Promise<{ resumen_ia: string; perfil: Record<string, any> }>;
  // Registro de la calificación del área (memoria estructurada por área).
  setCalificacion?: (accountId: string, phone: string, area: string, entry: { resultado: string; datos: Record<string, any>; calificado_at: string }) => Promise<void>;
}

// Esquema de tools en formato OpenAI function-calling.
const SCHEMAS = [
  { type: 'function', function: { name: 'list_offices', description: 'Lista las oficinas/modalidades del estudio (presencial y video) con su dirección. Usala antes de ofrecer un turno.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'check_availability', description: 'Lista los horarios LIBRES (no ocupados) de una oficina en una ventana de fechas. Llamá list_offices primero para saber qué oficina pasar.', parameters: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, oficina: { type: 'string' } }, required: ['desde', 'hasta', 'oficina'] } } },
  { type: 'function', function: { name: 'book_appointment', description: 'Agenda una cita. Confirmá los datos con el cliente ANTES de llamar.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, oficina: { type: 'string' }, resumen: { type: 'string' } }, required: ['nombre', 'start_time', 'end_time', 'oficina', 'resumen'] } } },
  { type: 'function', function: { name: 'reschedule_appointment', description: 'Reprograma una cita existente: cambia el horario y/o la SEDE. Si el cliente cambia de sede, pasá la nueva oficina (y un horario disponible en esa sede).', parameters: { type: 'object', properties: { appointment_id: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, oficina: { type: 'string', description: 'Nueva sede/oficina (opcional, solo si cambia de sede).' } }, required: ['appointment_id', 'start_time', 'end_time'] } } },
  { type: 'function', function: { name: 'cancel_appointment', description: 'Cancela una cita existente.', parameters: { type: 'object', properties: { appointment_id: { type: 'string' } }, required: ['appointment_id'] } } },
  { type: 'function', function: { name: 'search_knowledge', description: 'Busca en la base del estudio. Usala SIEMPRE antes de responder temas previsionales.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'handoff_to_human', description: 'Deriva la conversación a una persona del estudio.', parameters: { type: 'object', properties: { motivo: { type: 'string' }, resumen_caso: { type: 'string' } }, required: ['motivo', 'resumen_caso'] } } },
  { type: 'function', function: { name: 'suggest_office', description: 'Dada la zona/localidad que dice el cliente (ej "soy de Lanús"), sugiere la oficina más cercana. Si es vago o fuera de cobertura, lo indica. Usala antes de proponer presencial.', parameters: { type: 'object', properties: { location_text: { type: 'string' } }, required: ['location_text'] } } },
  { type: 'function', function: { name: 'pick_option', description: 'Interpreta una respuesta del cliente que se refiere a una opción ya ofrecida ("el tercero", "el de videollamada", "a la tarde"). Devuelve el valor elegido o null si es ambiguo.', parameters: { type: 'object', properties: { user_text: { type: 'string' } }, required: ['user_text'] } } },
  { type: 'function', function: { name: 'start_booking', description: 'Iniciá el agendado de un turno cuando el cliente quiere una cita/consulta. A partir de ahí un flujo guiado propone horarios, toma la elección y confirma SOLO; vos NO sigas los pasos ni llames book_appointment manualmente. Pasá lo que ya sepas (modalidad, zona, nombre, telefono).', parameters: { type: 'object', properties: { modalidad: { type: 'string', enum: ['presencial', 'video'] }, zona: { type: 'string' }, nombre: { type: 'string' }, telefono: { type: 'string', description: 'Teléfono ya validado con validate_phone, si el cliente lo dio en la conversación.' } } } } },
  { type: 'function', function: { name: 'validate_phone', description: 'Validá un número de teléfono que el cliente te DICE (no el de WhatsApp): chequea que tenga forma de número argentino con código de área real. Usala cuando el cliente te da un número de contacto. Si NO es válido, pedíle que lo confirme.', parameters: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] } } },
  { type: 'function', function: { name: 'set_qualification', description: 'Registrá el resultado de la calificación del área (jubilación, pensión, laboral, ART, tránsito) cuando terminaste las preguntas del PROCEDIMIENTO, ANTES de ofrecer agendar.', parameters: { type: 'object', properties: { area: { type: 'string', enum: ['jubilacion_hombre', 'jubilacion_mujer', 'jubilacion', 'pension_viudez', 'laboral', 'art', 'transito'] }, resultado: { type: 'string', enum: ['gratis', 'pago', 'descartar'] }, edad: { type: 'number' }, hijos: { type: 'number' }, aportes_aprox: { type: 'number' }, insalubres: { type: 'boolean', description: 'Solo jubilación hombre <63: ¿tiene aportes por tareas insalubres?' }, nacionalidad: { type: 'string', enum: ['argentino', 'extranjero'] }, anio_ingreso: { type: 'number', description: 'Extranjero: año de ingreso al país según DNI.' }, notas: { type: 'string' } }, required: ['area', 'resultado'] } } },
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
          // Registrar lo ofrecido para que pick_option entienda "el de Quilmes" / "el segundo".
          await this.deps.offered?.set(ctx.accountId, ctx.phone,
            oficinas.map((o, i) => ({ index: i + 1, label: `${o.nombre}${o.modalidad ? ' — ' + o.modalidad : ''}`, value: o.nombre })));
          return { ok: true, data: { oficinas } };
        }
        case 'check_availability': {
          const slots = await this.deps.availability.freeSlots(ctx.accountId, args.oficina, { desde: args.desde, hasta: args.hasta, max: 3 });
          if (!slots.length) {
            const existe = await this.deps.availability.getOffice(ctx.accountId, args.oficina);
            return { ok: true, data: { oficina: args.oficina, slots: [], sin_oficina: !existe } };
          }
          // Registrar los horarios ofrecidos (orden estable) para pick_option.
          await this.deps.offered?.set(ctx.accountId, ctx.phone,
            slots.map((s, i) => ({ index: i + 1, label: fmtSlot(s.start), value: s.start })));
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
          // Enriquecimiento pre-INSERT (Capacidad 2): ficha estructurada + resumen
          // natural, en el MISMO registro. Best-effort: si falla, se agenda igual.
          let resumen_ia: string | null = null;
          let perfil_json: Record<string, any> | null = null;
          // telefono real: en FB/IG ctx.phone es el id de la red (PSID/IGSID), NO un teléfono.
          // El BookingFlow lo pide al usuario y lo pasa en args.telefono. WhatsApp: ctx.phone ya es el número.
          const telefono = (args?.telefono && String(args.telefono).trim()) || ctx.phone;
          if (this.deps.buildFicha && ctx.conversation) {
            try {
              const modalidad = office?.modalidad === 'video' ? 'video' : 'presencial';
              const ficha = await this.deps.buildFicha(ctx.conversation, { telefono, modalidad, zona: ctx.zona });
              resumen_ia = ficha.resumen_ia || null;
              perfil_json = ficha.perfil ?? null;
            } catch { /* sin ficha: la cita se crea igual */ }
          }
          const appt = await this.deps.appointments.create({
            account_id: ctx.accountId, phone: ctx.phone, telefono,
            nombre: args.nombre, resumen: args.resumen ?? '', status: 'pendiente',
            start_time: args.start_time, end_time: args.end_time, oficina: args.oficina,
            assigned_profile_id: assigned,
            resumen_ia, perfil_json,
          } as any);
          return { ok: true, data: { appointment_id: appt.id, modalidad: office?.modalidad, direccion: office?.direccion ?? undefined, video_link: office?.video_link ?? undefined } };
        }
        case 'reschedule_appointment': {
          const appt = await this.deps.appointments.getById(args.appointment_id);
          if (!appt || appt.account_id !== ctx.accountId || appt.phone !== ctx.phone) {
            return { ok: false, error: 'No encuentro esa cita a tu nombre.' };
          }
          // Permite cambiar de SEDE: si viene args.oficina, valida cupo en la nueva.
          const targetOficina = (args.oficina ?? appt.oficina ?? '') as string;
          const office = await this.deps.availability.getOffice(ctx.accountId, targetOficina);
          const hasProfs = office ? await this.deps.availability.officeHasProfessionals(office) : false;
          let assigned: string | null = null;
          if (hasProfs) {
            assigned = await this.deps.availability.pickProfessional(office!, args.start_time, args.end_time);
            if (!assigned) return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          } else if (!(await this.deps.availability.hasCapacity(ctx.accountId, targetOficina, args.start_time, args.end_time))) {
            return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          }
          await this.deps.appointments.update(args.appointment_id, { start_time: args.start_time, end_time: args.end_time, oficina: targetOficina, assigned_profile_id: assigned });
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
        case 'suggest_office': {
          if (!this.deps.suggestOffice) return { ok: true, data: { oficina_sugerida: null, necesita_aclaracion: true, siempre_ofrecer_video: true } };
          const data = await this.deps.suggestOffice(ctx.accountId, args.location_text ?? '');
          return { ok: true, data };
        }
        case 'pick_option': {
          const offered = (await this.deps.offered?.get(ctx.accountId, ctx.phone)) ?? [];
          const m = resolveOption({ userText: args.user_text ?? '', offered });
          return { ok: true, data: { matched_value: m.matchedValue, confianza: m.confianza } };
        }
        case 'validate_phone': {
          const r = validarTelefonoAR(String(args.numero ?? ''));
          return { ok: true, data: { valido: r.valido, normalizado: r.normalizado, motivo: r.motivo ?? null } };
        }
        case 'set_qualification': {
          if (!this.deps.setCalificacion || !args?.area || !args?.resultado) return { ok: true, data: { registrado: false } };
          const datos: Record<string, any> = {};
          if (args.edad != null) datos.edad = args.edad;
          if (args.hijos != null) datos.hijos = args.hijos;
          if (args.aportes_aprox != null) datos.aportes_aprox = args.aportes_aprox;
          if (args.insalubres != null) datos.insalubres = args.insalubres;
          if (args.nacionalidad) datos.nacionalidad = args.nacionalidad;
          if (args.anio_ingreso != null) datos.anio_ingreso = args.anio_ingreso;
          if (args.notas) datos.notas = args.notas;
          const check = validateQualification(String(args.area), String(args.resultado), datos);
          if (!check.ok) return { ok: false, error: check.error };
          await this.deps.setCalificacion(ctx.accountId, ctx.phone, String(args.area), {
            resultado: String(args.resultado), datos, calificado_at: new Date().toISOString(),
          });
          return { ok: true, data: { registrado: true } };
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
