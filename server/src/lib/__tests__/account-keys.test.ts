import { describe, it, expect } from 'vitest';
import { checkpointKey, sessionId, authDir } from '../account-keys';

describe('account-keys', () => {
  it('checkpointKey namespacea por cuenta y teléfono', () => {
    expect(checkpointKey('acc1', '549111222333')).toBe('checkpoint:acc1:549111222333');
  });

  it('sessionId usa prefijo 1to1 para chats individuales', () => {
    expect(sessionId('acc1', '549111222333', '549111222333@s.whatsapp.net'))
      .toBe('acc1:1to1:549111222333');
  });

  it('sessionId usa prefijo group para grupos', () => {
    expect(sessionId('acc1', '549111222333', '12036304@g.us'))
      .toBe('acc1:group:12036304@g.us');
  });

  it('authDir aísla la carpeta de credenciales por cuenta', () => {
    expect(authDir('/data/auth', 'acc1')).toBe('/data/auth/acc1');
  });
});
