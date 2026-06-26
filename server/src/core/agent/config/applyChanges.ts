import type { Change, BrainDb, ApplyResult } from './types';
import { norm } from '../context/normalize';

async function forEachAccount(db: BrainDb, fn: (id: string) => Promise<void>): Promise<void> {
  const ids = await db.listAccountIds();
  for (const id of ids) await fn(id);
}

async function applyOne(change: Change, db: BrainDb): Promise<void> {
  switch (change.type) {
    case 'set_tono':
      return forEachAccount(db, (id) => db.setField(id, 'agent_persona', change.texto));
    case 'set_datos':
    case 'set_procedimientos': {
      const field = change.type === 'set_datos' ? 'business_context' : 'agent_procedures';
      return forEachAccount(db, async (id) => {
        let value = change.texto;
        if (change.modo === 'agregar') {
          const prev = (await db.getField(id, field)) ?? '';
          value = prev.trim() ? `${prev.trim()}\n${change.texto}` : change.texto;
        }
        await db.setField(id, field, value);
      });
    }
    case 'add_faq':
      return forEachAccount(db, (id) => db.upsertFaq(id, { pregunta: change.pregunta, respuesta: change.respuesta, tags: change.tags ?? [] }));
    case 'edit_faq':
      return forEachAccount(db, (id) => db.editFaq(id, change.pregunta, { respuesta: change.nueva_respuesta, pregunta: change.nueva_pregunta, tags: change.tags }));
    case 'remove_faq':
      return forEachAccount(db, (id) => db.removeFaq(id, change.pregunta));
    case 'add_zona':
      return forEachAccount(db, (id) => db.upsertZona(id, norm(change.localidad), change.localidad, change.oficina));
    case 'remove_zona':
      return forEachAccount(db, (id) => db.removeZona(id, norm(change.localidad)));
    default:
      throw new Error(`tipo de cambio desconocido: ${(change as any).type}`);
  }
}

/** Aplica cada Change fan-out a todas las cuentas. Un cambio que falla no corta los demás. */
export async function applyChanges(changes: Change[], db: BrainDb): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const change of changes) {
    try { await applyOne(change, db); out.push({ change, ok: true }); }
    catch (e: any) { out.push({ change, ok: false, error: String(e?.message ?? e) }); }
  }
  return out;
}
