import { describe, it, expect, vi } from 'vitest';

// Mock supabase: account_faqs devuelve filas controladas.
const faqRows: any[] = [];
vi.mock('../../../../config/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: faqRows, error: null }) }),
    }),
  },
}));

import { KnowledgeBase } from '../KnowledgeBase';

describe('KnowledgeBase.search', () => {
  it('encuentra una FAQ por keyword y devuelve el snippet', async () => {
    faqRows.length = 0;
    faqRows.push({ pregunta: '¿Atienden moratoria previsional?', respuesta: 'Sí, gestionamos moratoria.', tags: ['moratoria'] });
    const kb = new KnowledgeBase();
    const res = await kb.search('acc1', 'me conviene la moratoria?');
    expect(res.encontrado).toBe(true);
    expect(res.snippets.join(' ')).toContain('moratoria');
  });

  it('devuelve encontrado:false cuando nada matchea (grounding estricto)', async () => {
    faqRows.length = 0;
    faqRows.push({ pregunta: '¿Dónde están?', respuesta: 'En CABA.', tags: ['ubicacion'] });
    const kb = new KnowledgeBase();
    const res = await kb.search('acc1', 'cuánto cobra el bono de criptomonedas');
    expect(res.encontrado).toBe(false);
    expect(res.snippets).toEqual([]);
  });

  it('matchea por tag aunque el tag tenga mayúscula/acento', async () => {
    faqRows.length = 0;
    faqRows.push({ pregunta: '¿Requisitos?', respuesta: 'Te los detallo en la consulta.', tags: ['Jubilación'] });
    const kb = new KnowledgeBase();
    const res = await kb.search('acc1', 'consulta sobre jubilacion');
    expect(res.encontrado).toBe(true);
  });
});
