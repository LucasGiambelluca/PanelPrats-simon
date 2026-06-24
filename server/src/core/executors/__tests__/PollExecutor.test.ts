import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PollExecutor } from '../PollExecutor';

describe('PollExecutor — texto sin números', () => {
  const OLD = process.env;
  beforeEach(() => { process.env = { ...OLD }; delete process.env.WHATSAPP_CLOUD_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; });
  afterEach(() => { process.env = OLD; });

  it('fallback de texto usa viñetas y NO pide número', async () => {
    const r = await new PollExecutor().execute(
      { question: '¿En qué te ayudo?', options: ['Jubilación', 'Despido'] }, { phone: '1' } as any, {},
    );
    const txt = (r.messages[0] as any).text as string;
    expect(txt).not.toMatch(/\*\d+\.\*/);          // sin "*1.*"
    expect(txt).not.toMatch(/número/i);             // sin "Respondé con el número"
    expect(txt).toContain('•');                     // viñetas
    expect(txt).toContain('Jubilación');
  });

  it('emite payload interactivo: botones (≤3) con id = idx+1', async () => {
    const r = await new PollExecutor().execute(
      { question: '¿En qué te ayudo?', options: ['Jubilación', 'Despido'] }, { phone: '1' } as any, {},
    );
    const i = (r.messages[0] as any).interactive;
    expect(i.type).toBe('button');
    expect(i.action.buttons.map((b: any) => b.reply.id)).toEqual(['1', '2']);
    expect(i.action.buttons[0].reply.title).toBe('Jubilación');
  });

  it('emite lista (>3 opciones) con filas id = idx+1', async () => {
    const r = await new PollExecutor().execute(
      { question: 'Elegí', options: ['a', 'b', 'c', 'd'] }, { phone: '1' } as any, {},
    );
    const i = (r.messages[0] as any).interactive;
    expect(i.type).toBe('list');
    expect(i.action.sections[0].rows.map((row: any) => row.id)).toEqual(['1', '2', '3', '4']);
  });
});
