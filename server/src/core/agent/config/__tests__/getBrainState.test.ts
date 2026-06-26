import { describe, it, expect } from 'vitest';
import { getBrainState } from '../getBrainState';
import type { BrainDb } from '../types';

const db: BrainDb = {
  async listAccountIds() { return ['a1', 'a2', 'a3']; },
  async getField(id, f) { return id === 'a1' && f === 'agent_persona' ? 'cálido' : id === 'a1' && f === 'business_context' ? 'L-V 9-18' : null; },
  async setField() {}, async upsertFaq() {}, async editFaq() {}, async removeFaq() {}, async upsertZona() {}, async removeZona() {},
  async listFaqs(id) { return id === 'a1' ? [{ id: 'f1', pregunta: '¿precio?', respuesta: '$29.000', tags: [] }] : []; },
  async listZonas(id) { return id === 'a1' ? [{ id: 'z1', alias: 'lanus', oficina: 'Quilmes' }] : []; },
};

it('arma el snapshot desde la cuenta de referencia + cuenta las líneas', async () => {
  const s = await getBrainState(db);
  expect(s.tono).toBe('cálido');
  expect(s.datos).toBe('L-V 9-18');
  expect(s.faqs).toHaveLength(1);
  expect(s.zonas[0].oficina).toBe('Quilmes');
  expect(s.lineas).toBe(3);
});

it('sin cuentas → estado vacío, lineas 0', async () => {
  const empty: BrainDb = { ...db, listAccountIds: async () => [] };
  const s = await getBrainState(empty);
  expect(s.lineas).toBe(0);
  expect(s.faqs).toEqual([]);
});
