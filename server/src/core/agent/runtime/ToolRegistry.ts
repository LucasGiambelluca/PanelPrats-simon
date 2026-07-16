import type { ToolContext, ToolResult } from './types';
import type { AppointmentService as ApptSvc } from '../../../services/AppointmentService';
import type { KnowledgeBase } from './KnowledgeBase';
import type { AvailabilityService } from '../../../services/AvailabilityService';
import type { OfferedOption } from '../context/OptionResolver';
import { resolveOption } from '../context/OptionResolver';
import { validarTelefonoAR } from '../../../utils/phone-ar';
import { esPsid } from '../../../utils/psid';
import { validateQualification } from '../context/QualificationRules';
import { isHolidayARInstant } from '../context/holidays';

const TZ = 'America/Argentina/Buenos_Aires';
// Monto de la consulta paga (análisis previsional). Fijo por ahora; configurable a futuro.
const MONTO_CONSULTA_PAGA = 29000;
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
  buildFicha?: (conversation: string, ctx: { telefono: string | null; modalidad: 'presencial' | 'video'; zona?: string | null }) => Promise<{ resumen_ia: string; perfil: Record<string, any> }>;
  // Registro de la calificación del área (memoria estructurada por área).
  setCalificacion?: (accountId: string, phone: string, area: string, entry: { resultado: string; datos: Record<string, any>; calificado_at: string }) => Promise<void>;
  // Lectura de la calificación vigente del contacto (Fix 4): se copia a columnas
  // estructuradas de la cita al agendar (dato ya validado, no se re-extrae por IA).
  // Devuelve SOLO la entrada del área ACTUAL y VIGENTE (dentro del TTL), o null.
  getCalificacion?: (accountId: string, phone: string, area: string | null) => Promise<{ area: string; entry: any } | null>;
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
  { type: 'function', function: { name: 'set_qualification', description: 'Registrá el resultado de la calificación del área (jubilación, pensión, laboral, ART, tránsito) cuando terminaste las preguntas del PROCEDIMIENTO, ANTES de ofrecer agendar.', parameters: { type: 'object', properties: { area: { type: 'string', enum: ['jubilacion_hombre', 'jubilacion_mujer', 'jubilacion', 'pension_viudez', 'laboral', 'art', 'transito'] }, resultado: { type: 'string', enum: ['gratis', 'pago', 'descartar'] }, edad: { type: 'number' }, hijos: { type: 'number' }, aportes_aprox: { type: 'number' }, insalubres: { type: 'boolean', description: 'Solo jubilación hombre <63: ¿tiene aportes por tareas insalubres?' }, nacionalidad: { type: 'string', enum: ['argentino', 'extranjero'] }, anio_ingreso: { type: 'number', description: 'Extranjero: año de ingreso al país según DNI.' }, a_confirmar: { type: 'array', items: { type: 'string' }, description: 'Temas que faltan confirmar (ej ["aportes"]); permite agendar gratis "a confirmar" sin trabarse cuando el cliente no da el dato.' }, notas: { type: 'string' } }, required: ['area', 'resultado'] } } },
];

export class ToolRegistry {
  constructor(private deps: ToolDeps) {}

  schemas() { return SCHEMAS; }

  /**
   * Resuelve el pool (oficina + profesional) para un slot. Si el pool pedido no
   * tiene cupo y es de VIDEO, prueba los otros pools de video para el MISMO
   * horario (queja prod 2026-07-09: el bot corría la fecha en vez de agendar con
   * otra abogada). Presencial nunca cambia de sede: el cliente eligió un lugar.
   * Devuelve null si no hay cupo en ningún pool elegible.
   */
  private async resolvePool(accountId: string, oficina: string, start: string, end: string):
    Promise<{ office: any | null; oficina: string; assigned: string | null } | null> {
    const tryOffice = async (office: any | null, nombre: string) => {
      const hasProfs = office ? await this.deps.availability.officeHasProfessionals(office) : false;
      if (hasProfs) {
        const assigned = await this.deps.availability.pickProfessional(office, start, end);
        return assigned ? { office, oficina: nombre, assigned } : null;
      }
      const ok = await this.deps.availability.hasCapacity(accountId, nombre, start, end);
      return ok ? { office, oficina: nombre, assigned: null } : null;
    };

    const office = await this.deps.availability.getOffice(accountId, oficina);
    const direct = await tryOffice(office, oficina);
    if (direct) return direct;
    if (office?.modalidad !== 'video') return null;

    try {
      const candidatas = (await this.deps.availability.listOffices(accountId))
        .filter((o: any) => o.nombre !== office.nombre && (o.modalidad === 'video' || o.modalidad === 'ambas'));
      for (const alt of candidatas) {
        const r = await tryOffice(alt, alt.nombre);
        if (r) return r;
      }
    } catch { /* fallback best-effort: sin listado, se responde sin cupo */ }
    return null;
  }

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
          // Feriado (prod 2026-07-07): el LLM agendaba citas en feriados pasando una
          // fecha directa (sin pasar por freeSlots, que sí los filtra). Rechazar acá
          // cubre TODA reserva por tool, venga de donde venga la fecha.
          if (isHolidayARInstant(args.start_time)) {
            return { ok: false, error: 'Esa fecha es feriado y el estudio no atiende. Ofrecé horarios del siguiente día hábil (usá check_availability).' };
          }
          // Anti-duplicado (prod 2026-07-07): un cambio de horario tras agendar arrancaba
          // un booking NUEVO y quedaban DOS citas vivas (la vieja moría como no-show
          // falso). Si el contacto YA tiene una cita futura activa, esto es una
          // REPROGRAMACIÓN de esa cita — nunca una segunda cita.
          try {
            const todas = await this.deps.appointments.list(ctx.accountId);
            const nowMs = Date.now();
            const vigente = (todas as any[])
              .filter((x) => x.phone === ctx.phone
                && (x.status === 'pendiente' || x.status === 'confirmada')
                && x.start_time && new Date(x.start_time).getTime() > nowMs)
              .sort((x, y) => new Date(x.start_time).getTime() - new Date(y.start_time).getTime())[0];
            if (vigente) {
              return await this.execute('reschedule_appointment',
                { appointment_id: vigente.id, start_time: args.start_time, end_time: args.end_time, oficina: args.oficina },
                ctx);
            }
          } catch { /* best-effort: si falla la lectura, se agenda normal */ }
          const pool = await this.resolvePool(ctx.accountId, args.oficina, args.start_time, args.end_time);
          if (!pool) return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          const { office, oficina: oficinaFinal, assigned } = pool;
          // Enriquecimiento pre-INSERT (Capacidad 2): ficha estructurada + resumen
          // natural, en el MISMO registro. Best-effort: si falla, se agenda igual.
          let resumen_ia: string | null = null;
          let perfil_json: Record<string, any> | null = null;
          // telefono real: en FB/IG ctx.phone es el id de la red (PSID/IGSID), NO un teléfono.
          // El BookingFlow lo pide al usuario y lo pasa en args.telefono. WhatsApp: ctx.phone ya
          // es el número. El fallback a ctx.phone SOLO si valida como teléfono: en prod quedaban
          // citas con telefono = PSID y el recordatorio salía a un id de red (2026-07-16).
          const telefono = (args?.telefono && String(args.telefono).trim())
            || (validarTelefonoAR(ctx.phone).valido ? ctx.phone : null);
          if (this.deps.buildFicha && ctx.conversation) {
            try {
              const modalidad = office?.modalidad === 'video' ? 'video' : 'presencial';
              const ficha = await this.deps.buildFicha(ctx.conversation, { telefono, modalidad, zona: ctx.zona });
              resumen_ia = ficha.resumen_ia || null;
              perfil_json = ficha.perfil ?? null;
            } catch { /* sin ficha: la cita se crea igual */ }
          }
          // Copiar la calificación del ÁREA ACTUAL y VIGENTE (dato ya validado) a columnas
          // estructuradas de la cita, para que recepción tenga edad/nacionalidad/insalubres/aportes
          // y sepa si cobrar. SOLO el área de esta cita y dentro del TTL: nunca copia el
          // "pago" de una jubilación vieja a una consulta laboral gratis, ni datos vencidos.
          let intake: any = {};
          if (this.deps.getCalificacion) {
            try {
              const picked = await this.deps.getCalificacion(ctx.accountId, ctx.phone, ctx.area ?? null);
              if (picked) {
                const d = picked.entry.datos || {};
                const r = picked.entry.resultado;
                intake = {
                  area: picked.area,
                  edad: d.edad ?? null,
                  nacionalidad: d.nacionalidad ?? null,
                  insalubres: (d.insalubres === true || d.insalubres === 'true') ? true : (d.insalubres === false ? false : null),
                  aportes_aprox: d.aportes_aprox ?? null,
                  a_confirmar: (Array.isArray(d.a_confirmar) && d.a_confirmar.length) ? d.a_confirmar.map(String) : null,
                  tipo_consulta: r === 'pago' ? 'pago' : (r === 'gratis' ? 'gratis' : null),
                  monto_a_cobrar: r === 'pago' ? MONTO_CONSULTA_PAGA : 0,
                };
              }
            } catch { /* best-effort: la cita se crea igual */ }
          }
          // Marca "a confirmar" en la ficha (jsonb, sin migración): si la calificación vigente
          // trae temas pendientes, quedan en perfil_json.a_confirmar para que el abogado verifique.
          if (Array.isArray(intake.a_confirmar) && intake.a_confirmar.length) {
            perfil_json = { ...(perfil_json || {}), a_confirmar: intake.a_confirmar };
          }
          // El LLM a veces pasa el PSID del contacto como "nombre" (prod 2026-07-16:
          // citas a nombre de "25516497748025583"). Preferir el nombre real de la ficha.
          const nombreFinal = !esPsid(args?.nombre) ? args.nombre
            : (perfil_json?.nombre && !esPsid(perfil_json.nombre) ? perfil_json.nombre : 'Sin nombre');
          const appt = await this.deps.appointments.create({
            account_id: ctx.accountId, phone: ctx.phone, telefono,
            nombre: nombreFinal, resumen: args.resumen ?? '', status: 'pendiente',
            start_time: args.start_time, end_time: args.end_time, oficina: oficinaFinal,
            assigned_profile_id: assigned,
            resumen_ia, perfil_json,
            // Calificación (validada) manda sobre la ficha IA para edad/nacionalidad/insalubres/aportes;
            // la ficha (perfil) aporta dni/zona (y edad si la calificación no la tiene).
            edad: intake.edad ?? perfil_json?.edad ?? null,
            dni: perfil_json?.dni ?? null,
            zona: perfil_json?.zona ?? ctx.zona ?? null,
            nacionalidad: intake.nacionalidad ?? perfil_json?.nacionalidad ?? null,
            insalubres: intake.insalubres ?? (typeof perfil_json?.insalubres === 'boolean' ? perfil_json.insalubres : null),
            aportes_aprox: intake.aportes_aprox ?? perfil_json?.anios_aporte ?? null,
            area: intake.area ?? null,
            tipo_consulta: intake.tipo_consulta ?? null,
            monto_a_cobrar: intake.monto_a_cobrar ?? 0,
          } as any);
          return { ok: true, data: { appointment_id: appt.id, oficina: oficinaFinal, modalidad: office?.modalidad, direccion: office?.direccion ?? undefined, video_link: office?.video_link ?? undefined } };
        }
        case 'reschedule_appointment': {
          const appt = await this.deps.appointments.getById(args.appointment_id);
          if (!appt || appt.account_id !== ctx.accountId || appt.phone !== ctx.phone) {
            return { ok: false, error: 'No encuentro esa cita a tu nombre.' };
          }
          // Backstop anti-alucinación: el LLM a veces INVENTA la fecha (bug real en prod:
          // una reprogramación quedó guardada en 2023-07-07, año pasado). Rechazar toda
          // fecha inválida o en el pasado — la reprogramación debe usar un slot REAL.
          const startMs = new Date(args.start_time).getTime();
          if (!args.start_time || Number.isNaN(startMs) || startMs < Date.now()) {
            return { ok: false, error: 'Ese horario no es válido (fecha pasada). Ofrecé un horario disponible real con el flujo de reprogramación.' };
          }
          // Mismo guard de feriados que book_appointment: una reprogramación tampoco
          // puede caer en un día que el estudio no atiende.
          if (isHolidayARInstant(args.start_time)) {
            return { ok: false, error: 'Esa fecha es feriado y el estudio no atiende. Ofrecé horarios del siguiente día hábil (usá check_availability).' };
          }
          // Permite cambiar de SEDE: si viene args.oficina, valida cupo en la nueva.
          // Video sin cupo → resolvePool prueba los otros pools de video (mismo horario).
          const targetOficina = (args.oficina ?? appt.oficina ?? '') as string;
          const pool = await this.resolvePool(ctx.accountId, targetOficina, args.start_time, args.end_time);
          if (!pool) return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          const { office, oficina: oficinaFinal, assigned } = pool;
          await this.deps.appointments.update(args.appointment_id, { start_time: args.start_time, end_time: args.end_time, oficina: oficinaFinal, assigned_profile_id: assigned });
          return { ok: true, data: { oficina: oficinaFinal, direccion: office?.direccion ?? undefined, video_link: (office as any)?.video_link ?? undefined, modalidad: office?.modalidad } };
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
          if (Array.isArray(args.a_confirmar) && args.a_confirmar.length) datos.a_confirmar = args.a_confirmar.map(String);
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
