import type { BrainDb, BrainState } from './types';

/** Snapshot del cerebro: lee de la primera cuenta (el fan-out las mantiene idénticas). */
export async function getBrainState(db: BrainDb): Promise<BrainState> {
  const ids = await db.listAccountIds();
  const ref = ids[0];
  if (!ref) return { tono: null, datos: null, procedimientos: null, faqs: [], zonas: [], lineas: 0 };
  const [tono, datos, procedimientos, faqs, zonas] = await Promise.all([
    db.getField(ref, 'agent_persona'),
    db.getField(ref, 'business_context'),
    db.getField(ref, 'agent_procedures'),
    db.listFaqs(ref),
    db.listZonas(ref),
  ]);
  return { tono, datos, procedimientos, faqs, zonas, lineas: ids.length };
}
