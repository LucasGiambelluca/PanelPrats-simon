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
    const txt = r.messages[0] as string;
    expect(txt).not.toMatch(/\*\d+\.\*/);          // sin "*1.*"
    expect(txt).not.toMatch(/número/i);             // sin "Respondé con el número"
    expect(txt).toContain('•');                     // viñetas
    expect(txt).toContain('Jubilación');
  });
});
