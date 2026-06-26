import { describe, it, expect } from 'vitest';
import { applyChanges } from '../applyChanges';
import type { BrainDb, BrainFaq, BrainZona, AccountField } from '../types';

function fakeDb(accountIds = ['a1', 'a2']): BrainDb & { fields: Record<string, any>; faqs: Record<string, BrainFaq[]>; zonas: Record<string, BrainZona[]> } {
  const fields: Record<string, any> = {};
  const faqs: Record<string, BrainFaq[]> = { a1: [], a2: [] };
  const zonas: Record<string, BrainZona[]> = { a1: [], a2: [] };
  return {
    fields, faqs, zonas,
    async listAccountIds() { return accountIds; },
    async getField(id: string, f: AccountField) { return fields[`${id}:${f}`] ?? null; },
    async setField(id: string, f: AccountField, v: string) { fields[`${id}:${f}`] = v; },
    async upsertFaq(id, faq) {
      const list = faqs[id]; const ex = list.find((x) => x.pregunta === faq.pregunta);
      if (ex) { ex.respuesta = faq.respuesta; ex.tags = faq.tags; }
      else list.push({ id: `${id}-${list.length}`, ...faq });
    },
    async editFaq(id, pregunta, patch) {
      const ex = faqs[id].find((x) => x.pregunta === pregunta); if (!ex) return;
      if (patch.respuesta !== undefined) ex.respuesta = patch.respuesta;
      if (patch.pregunta !== undefined) ex.pregunta = patch.pregunta;
      if (patch.tags !== undefined) ex.tags = patch.tags;
    },
    async removeFaq(id, pregunta) { faqs[id] = faqs[id].filter((x) => x.pregunta !== pregunta); },
    async upsertZona(id, aliasNorm, alias, oficina) {
      const ex = zonas[id].find((z) => z.alias === aliasNorm);
      if (!ex) zonas[id].push({ id: `${id}-z${zonas[id].length}`, alias: aliasNorm, oficina });
    },
    async removeZona(id, aliasNorm) { zonas[id] = zonas[id].filter((z) => z.alias !== aliasNorm); },
    async listFaqs(id) { return faqs[id]; },
    async listZonas(id) { return zonas[id]; },
  };
}

describe('applyChanges — fan-out a todas las cuentas', () => {
  it('set_tono escribe agent_persona en TODAS las cuentas', async () => {
    const db = fakeDb();
    const res = await applyChanges([{ type: 'set_tono', texto: 'cálido' }], db);
    expect(res[0].ok).toBe(true);
    expect(db.fields['a1:agent_persona']).toBe('cálido');
    expect(db.fields['a2:agent_persona']).toBe('cálido');
  });

  it('set_datos modo agregar concatena al valor previo', async () => {
    const db = fakeDb();
    db.fields['a1:business_context'] = 'Horario L-V.';
    db.fields['a2:business_context'] = 'Horario L-V.';
    await applyChanges([{ type: 'set_datos', texto: 'Consulta $29.000.', modo: 'agregar' }], db);
    expect(db.fields['a1:business_context']).toContain('Horario L-V.');
    expect(db.fields['a1:business_context']).toContain('Consulta $29.000.');
  });

  it('add_faq es idempotente (no duplica por pregunta)', async () => {
    const db = fakeDb();
    const ch = { type: 'add_faq' as const, pregunta: '¿Precio?', respuesta: '$29.000', tags: ['precio'] };
    await applyChanges([ch], db);
    await applyChanges([ch], db);
    expect(db.faqs.a1).toHaveLength(1);
    expect(db.faqs.a2).toHaveLength(1);
  });

  it('add_zona normaliza la localidad e inserta en todas', async () => {
    const db = fakeDb();
    await applyChanges([{ type: 'add_zona', localidad: 'Lanús', oficina: 'Quilmes' }], db);
    expect(db.zonas.a1[0].alias).toBe('lanus');   // normalizado
    expect(db.zonas.a2[0].oficina).toBe('Quilmes');
  });

  it('remove_faq borra por pregunta en todas', async () => {
    const db = fakeDb();
    await applyChanges([{ type: 'add_faq', pregunta: 'X', respuesta: 'y' }], db);
    await applyChanges([{ type: 'remove_faq', pregunta: 'X' }], db);
    expect(db.faqs.a1).toHaveLength(0);
  });

  it('un tipo desconocido devuelve ok:false sin romper los demás', async () => {
    const db = fakeDb();
    const res = await applyChanges([{ type: 'set_tono', texto: 't' }, { type: 'wat' } as any], db);
    expect(res[0].ok).toBe(true);
    expect(res[1].ok).toBe(false);
  });
});
