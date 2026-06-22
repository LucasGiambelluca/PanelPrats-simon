import { supabase } from '../../../config/supabase';

export interface KnowledgeHit { encontrado: boolean; snippets: string[]; }

// Normaliza y tokeniza para matching por keyword (sin acentos, minúsculas).
function tokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9áéíóúñ ]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4); // palabras cortas no aportan señal
}

export class KnowledgeBase {
  /**
   * Recupera FAQs relevantes de la cuenta por solapamiento de keywords.
   * Grounding estricto: si nada supera el umbral, devuelve encontrado:false.
   */
  async search(accountId: string, query: string): Promise<KnowledgeHit> {
    const { data } = await supabase.from('account_faqs').select('pregunta, respuesta, tags').eq('account_id', accountId);
    const rows = (data ?? []) as Array<{ pregunta: string; respuesta: string; tags: string[] }>;
    const q = new Set(tokens(query));
    if (q.size === 0 || rows.length === 0) return { encontrado: false, snippets: [] };

    const scored = rows
      .map((r) => {
        const hay = new Set([...tokens(r.pregunta), ...(r.tags ?? [])]);
        let score = 0;
        for (const t of q) if (hay.has(t)) score++;
        return { r, score };
      })
      .filter((s) => s.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) return { encontrado: false, snippets: [] };
    return { encontrado: true, snippets: scored.map((s) => `${s.r.pregunta} → ${s.r.respuesta}`) };
  }
}
