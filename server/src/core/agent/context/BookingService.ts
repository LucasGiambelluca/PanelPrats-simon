// ─── BookingService ───────────────────────────────────────────────────────────
// Orquesta el BookingFlow determinístico con estado en Redis + deps reales
// (zona, disponibilidad, agendado). El LLM solo dispara start(); de ahí en más
// advance() conduce cada paso. El agendado real se delega a la MISMA función
// book_appointment del ToolRegistry (capacidad, profesional, ficha IA) → sin duplicar.

import { startBooking, startReschedule, advanceBooking, type BookingDeps, type BookingState } from './BookingFlow';
import { BookingStateStore } from './BookingStateStore';
import { norm } from './normalize';

// Deriva la ETIQUETA de zona visible al cliente desde el nombre interno de la agenda
// ("SERENA QUILMES" → "Quilmes", "... MORÓN" → "Moron"). Comparamos con norm() (sin
// acentos). Si NO reconocemos la zona devolvemos null: el nombre interno JAMÁS se
// muestra al cliente (en ese caso el flujo cae a la dirección o a un genérico).
function zonaFromNombre(nombre: string): string | null {
  const t = norm(nombre);
  for (const z of ['caba', 'quilmes', 'haedo', 'lomas', 'avellaneda', 'moron', 'lanus']) {
    if (t.includes(z)) return z === 'caba' ? 'CABA' : z.charAt(0).toUpperCase() + z.slice(1);
  }
  return null;
}

export interface BookingServiceDeps {
  store: BookingStateStore;
  suggestOffice: (accountId: string, text: string) => Promise<{ oficina_sugerida: any; necesita_aclaracion: boolean; pregunta_aclaracion?: string }>;
  listOffices: (accountId: string) => Promise<Array<{ nombre: string; modalidad: string; direccion?: string | null }>>;
  freeSlots: (accountId: string, oficina: string, opts?: { desde?: Date; max?: number }) => Promise<Array<{ start: string; end: string }>>;
  // Agenda reusando book_appointment del ToolRegistry. Throw si no hay cupo.
  // b.telefono: número real dado en el chat (FB/IG); si falta, el caller usa el id de canal.
  book: (accountId: string, phone: string, conversation: string, zona: string | null, b: { nombre: string; start: string; end: string; oficina: string; profileId?: string | null; telefono?: string }) => Promise<{ direccion?: string | null; video_link?: string | null; modalidad?: string }>;
  // Reprograma una cita existente reusando reschedule_appointment del ToolRegistry
  // (ownership + cupo + backstop de fecha). Throw si no se pudo.
  reschedule: (accountId: string, phone: string, conversation: string, b: { apptId: string; start: string; end: string; oficina: string; profileId?: string | null }) => Promise<{ direccion?: string | null; video_link?: string | null; modalidad?: string }>;
}

export class BookingService {
  constructor(private deps: BookingServiceDeps) {}

  private buildDeps(accountId: string, phone: string, conversation: string, getState: () => BookingState | undefined): BookingDeps {
    return {
      suggestOffice: async (t) => {
        const z = await this.deps.suggestOffice(accountId, t);
        return { oficina_sugerida: z.oficina_sugerida ?? null, necesita_aclaracion: z.necesita_aclaracion, pregunta_aclaracion: z.pregunta_aclaracion };
      },
      videoOfficeName: async () => {
        const offs = await this.deps.listOffices(accountId);
        const v = offs.find((o) => o.modalidad === 'video') ?? offs.find((o) => o.modalidad === 'ambas');
        return v?.nombre ?? null;
      },
      defaultOffice: async () => {
        const offs = await this.deps.listOffices(accountId);
        const p = offs.find((o) => o.modalidad === 'presencial') ?? offs.find((o) => o.modalidad === 'ambas') ?? offs[0];
        return p?.nombre ?? null;
      },
      presencialOffices: async () => {
        const offs = await this.deps.listOffices(accountId);
        return offs
          .filter((o) => o.modalidad === 'presencial' || o.modalidad === 'ambas')
          .map((o) => ({ nombreInterno: o.nombre, zona: zonaFromNombre(o.nombre), direccion: o.direccion ?? null }));
      },
      freeSlots: async (oficina, opts) => (await this.deps.freeSlots(accountId, oficina, opts)).map((s) => ({ start: s.start, end: s.end, oficina })),
      book: (b) => this.deps.book(accountId, phone, conversation, getState()?.zona ?? null, b),
      reschedule: (b) => this.deps.reschedule(accountId, phone, conversation, b),
    };
  }

  async isActive(accountId: string, phone: string): Promise<boolean> {
    const s = await this.deps.store.get(accountId, phone);
    return !!s && s.stage !== 'done';
  }

  async start(accountId: string, phone: string, args: { modalidad?: 'presencial' | 'video'; zona?: string; nombre?: string; telefonoSugerido?: string; needsPhone?: boolean }, conversation: string): Promise<{ messages: string[]; active: boolean }> {
    let current: BookingState | undefined;
    const step = await startBooking(args, this.buildDeps(accountId, phone, conversation, () => current));
    current = step.state;
    await this.persist(accountId, phone, step.active, step.state);
    return { messages: step.messages, active: step.active };
  }

  async startReschedule(accountId: string, phone: string, args: { apptId: string; modalidad?: 'presencial' | 'video'; oficina?: string; needsPhone?: boolean; nombre?: string; telefono?: string }, conversation: string, initialText?: string): Promise<{ messages: string[]; active: boolean }> {
    let current: BookingState | undefined;
    const step = await startReschedule(args, this.buildDeps(accountId, phone, conversation, () => current), initialText);
    current = step.state;
    await this.persist(accountId, phone, step.active, step.state);
    return { messages: step.messages, active: step.active };
  }

  async advance(accountId: string, phone: string, text: string, conversation: string): Promise<{ messages: string[]; active: boolean }> {
    const state = await this.deps.store.get(accountId, phone);
    if (!state) return { messages: [], active: false };
    let current: BookingState | undefined = state;
    const step = await advanceBooking(state, text, this.buildDeps(accountId, phone, conversation, () => current));
    current = step.state;
    await this.persist(accountId, phone, step.active, step.state);
    return { messages: step.messages, active: step.active };
  }

  private async persist(accountId: string, phone: string, active: boolean, state: BookingState): Promise<void> {
    if (active) await this.deps.store.set(accountId, phone, state);
    else await this.deps.store.clear(accountId, phone);
  }
}
