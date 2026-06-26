import { supabase } from '../../../config/supabase';
import type { BrainDb, BrainFaq, BrainZona, AccountField } from './types';

// Impl real de BrainDb. El "estudio" = todas las cuentas (app de un solo estudio,
// igual que accounts.routes GET que hace select('*') sin filtrar por user_id).
export class SupabaseBrainDb implements BrainDb {
  async listAccountIds(): Promise<string[]> {
    const { data } = await supabase.from('accounts').select('id');
    return ((data ?? []) as any[]).map((a) => a.id);
  }
  async getField(accountId: string, field: AccountField): Promise<string | null> {
    const { data } = await supabase.from('accounts').select(field).eq('id', accountId).maybeSingle();
    return (data as any)?.[field] ?? null;
  }
  async setField(accountId: string, field: AccountField, value: string): Promise<void> {
    await supabase.from('accounts').update({ [field]: value }).eq('id', accountId);
  }
  async listFaqs(accountId: string): Promise<BrainFaq[]> {
    const { data } = await supabase.from('account_faqs').select('id, pregunta, respuesta, tags').eq('account_id', accountId);
    return ((data ?? []) as any[]).map((f) => ({ id: f.id, pregunta: f.pregunta, respuesta: f.respuesta, tags: f.tags ?? [] }));
  }
  async upsertFaq(accountId: string, faq: { pregunta: string; respuesta: string; tags: string[] }): Promise<void> {
    const { data } = await supabase.from('account_faqs').select('id').eq('account_id', accountId).eq('pregunta', faq.pregunta).maybeSingle();
    if (data?.id) await supabase.from('account_faqs').update({ respuesta: faq.respuesta, tags: faq.tags }).eq('id', data.id);
    else await supabase.from('account_faqs').insert({ account_id: accountId, pregunta: faq.pregunta, respuesta: faq.respuesta, tags: faq.tags });
  }
  async editFaq(accountId: string, pregunta: string, patch: { respuesta?: string; pregunta?: string; tags?: string[] }): Promise<void> {
    const upd: any = {};
    if (patch.respuesta !== undefined) upd.respuesta = patch.respuesta;
    if (patch.pregunta !== undefined) upd.pregunta = patch.pregunta;
    if (patch.tags !== undefined) upd.tags = patch.tags;
    if (Object.keys(upd).length === 0) return;
    await supabase.from('account_faqs').update(upd).eq('account_id', accountId).eq('pregunta', pregunta);
  }
  async removeFaq(accountId: string, pregunta: string): Promise<void> {
    await supabase.from('account_faqs').delete().eq('account_id', accountId).eq('pregunta', pregunta);
  }
  async listZonas(accountId: string): Promise<BrainZona[]> {
    const { data } = await supabase.from('zone_gazetteer').select('id, alias_norm, oficina').eq('account_id', accountId);
    return ((data ?? []) as any[]).map((z) => ({ id: String(z.id), alias: z.alias_norm, oficina: z.oficina }));
  }
  async upsertZona(accountId: string, aliasNorm: string, alias: string, oficina: string): Promise<void> {
    await supabase.from('zone_gazetteer').upsert({ account_id: accountId, alias, alias_norm: aliasNorm, oficina }, { onConflict: 'account_id,alias_norm' });
  }
  async removeZona(accountId: string, aliasNorm: string): Promise<void> {
    await supabase.from('zone_gazetteer').delete().eq('account_id', accountId).eq('alias_norm', aliasNorm);
  }
}
