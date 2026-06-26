// ─── BookingService ───────────────────────────────────────────────────────────
// Orquesta el BookingFlow determinístico con estado en Redis + deps reales
// (zona, disponibilidad, agendado). El LLM solo dispara start(); de ahí en más
// advance() conduce cada paso. El agendado real se delega a la MISMA función
// book_appointment del ToolRegistry (capacidad, profesional, ficha IA) → sin duplicar.

import { startBooking, advanceBooking, type BookingDeps, type BookingState } from './BookingFlow';
import { BookingStateStore } from './BookingStateStore';

export interface BookingServiceDeps {
  store: BookingStateStore;
  suggestOffice: (accountId: string, text: string) => Promise<{ oficina_sugerida: any; necesita_aclaracion: boolean; pregunta_aclaracion?: string }>;
  listOffices: (accountId: string) => Promise<Array<{ nombre: string; modalidad: string }>>;
  freeSlots: (accountId: string, oficina: string, opts?: { desde?: Date; max?: number }) => Promise<Array<{ start: string; end: string }>>;
  // Agenda reusando book_appointment del ToolRegistry. Throw si no hay cupo.
  book: (accountId: string, phone: string, conversation: string, zona: string | null, b: { nombre: string; start: string; end: string; oficina: string; profileId?: string | null }) => Promise<{ direccion?: string | null; video_link?: string | null; modalidad?: string }>;
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
      freeSlots: async (oficina, opts) => (await this.deps.freeSlots(accountId, oficina, opts)).map((s) => ({ start: s.start, end: s.end, oficina })),
      book: (b) => this.deps.book(accountId, phone, conversation, getState()?.zona ?? null, b),
    };
  }

  async isActive(accountId: string, phone: string): Promise<boolean> {
    const s = await this.deps.store.get(accountId, phone);
    return !!s && s.stage !== 'done';
  }

  async start(accountId: string, phone: string, args: { modalidad?: 'presencial' | 'video'; zona?: string; nombre?: string }, conversation: string): Promise<{ messages: string[]; active: boolean }> {
    let current: BookingState | undefined;
    const step = await startBooking(args, this.buildDeps(accountId, phone, conversation, () => current));
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
