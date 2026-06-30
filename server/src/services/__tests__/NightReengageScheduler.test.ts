import { describe, it, expect, vi } from 'vitest';
import { NightReengageScheduler } from '../NightReengageScheduler';

const arLocal = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h + 3, mi));

function makeDeps(over: any = {}) {
  return {
    listEnabledAccounts: over.listEnabledAccounts ?? vi.fn().mockResolvedValue([
      { id: 'acc1', reengage_text: '¡Buen día! ¿Seguimos?' },
    ]),
    listConversations: over.listConversations ?? vi.fn().mockResolvedValue([
      { id: 'c1', account_id: 'acc1', phone: '5491111', status: 'BOT', last_message_at: arLocal(2026, 7, 1, 23).toISOString(), reengaged_for: null, close_reason: null },
    ]),
    lastInboundAt: over.lastInboundAt ?? vi.fn().mockResolvedValue(arLocal(2026, 7, 1, 23)),
    isConnected: over.isConnected ?? vi.fn().mockReturnValue(true),
    sendMessage: over.sendMessage ?? vi.fn().mockResolvedValue(undefined),
    markReengaged: over.markReengaged ?? vi.fn().mockResolvedValue(undefined),
    isOptedOut: over.isOptedOut ?? vi.fn().mockResolvedValue(false),
    now: over.now ?? (() => arLocal(2026, 7, 2, 9, 30)),
  };
}

describe('NightReengageScheduler.tick', () => {
  it('manda el texto de la cuenta y marca reengaged_for', async () => {
    const deps = makeDeps();
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).toHaveBeenCalledWith('acc1', '5491111', '¡Buen día! ¿Seguimos?');
    expect(deps.markReengaged).toHaveBeenCalledWith('c1', arLocal(2026, 7, 1, 23).toISOString());
  });

  it('usa el texto default si la cuenta no tiene reengage_text', async () => {
    const deps = makeDeps({ listEnabledAccounts: vi.fn().mockResolvedValue([{ id: 'acc1', reengage_text: null }]) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).toHaveBeenCalledWith('acc1', '5491111', expect.stringContaining('Buen día'));
  });

  it('no manda si la cuenta está desconectada', async () => {
    const deps = makeDeps({ isConnected: vi.fn().mockReturnValue(false) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('no manda si shouldReengage es false (de madrugada)', async () => {
    const deps = makeDeps({ now: () => arLocal(2026, 7, 2, 3) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('no repite si ya se re-enganchó para ese last_message_at', async () => {
    const deps = makeDeps({ listConversations: vi.fn().mockResolvedValue([
      { id: 'c1', account_id: 'acc1', phone: '5491111', status: 'BOT', last_message_at: arLocal(2026, 7, 1, 23).toISOString(), reengaged_for: arLocal(2026, 7, 1, 23).toISOString(), close_reason: null },
    ]) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('opt-out respetado en re-enganche — contacto con isOptedOut=true NO recibe sendMessage', async () => {
    const deps = makeDeps({ isOptedOut: vi.fn().mockResolvedValue(true) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('conversación cerrada con close_reason=opt_out NO recibe sendMessage', async () => {
    const deps = makeDeps({ listConversations: vi.fn().mockResolvedValue([
      { id: 'c1', account_id: 'acc1', phone: '5491111', status: 'BOT', last_message_at: arLocal(2026, 7, 1, 23).toISOString(), reengaged_for: null, close_reason: 'opt_out' },
    ]) });
    await new NightReengageScheduler(deps as any).tick();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});
