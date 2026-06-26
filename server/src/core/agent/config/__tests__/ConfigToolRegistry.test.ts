import { describe, it, expect } from 'vitest';
import { ConfigToolRegistry } from '../ConfigToolRegistry';

const reg = new ConfigToolRegistry();

describe('ConfigToolRegistry', () => {
  it('expone los esquemas de tools', () => {
    const names = reg.schemas().map((s: any) => s.function.name).sort();
    expect(names).toEqual([
      'add_faq', 'add_zona', 'edit_faq', 'remove_faq', 'remove_zona',
      'set_datos', 'set_procedimientos', 'set_tono',
    ]);
  });

  it('set_tono → Change set_tono', () => {
    expect(reg.toChange('set_tono', { texto: 'cálido' })).toEqual({ type: 'set_tono', texto: 'cálido' });
  });

  it('set_datos default modo=agregar', () => {
    expect(reg.toChange('set_datos', { texto: 'x' })).toMatchObject({ type: 'set_datos', modo: 'agregar' });
  });

  it('add_zona valida la oficina (rechaza inválida)', () => {
    expect(reg.toChange('add_zona', { localidad: 'Lanús', oficina: 'CABA' })).toMatchObject({ type: 'add_zona', oficina: 'CABA' });
    expect(reg.toChange('add_zona', { localidad: 'X', oficina: 'Marte' })).toBeNull();
  });

  it('add_faq sin respuesta → null', () => {
    expect(reg.toChange('add_faq', { pregunta: '¿precio?' })).toBeNull();
    expect(reg.toChange('add_faq', { pregunta: '¿precio?', respuesta: '$29.000' })).toMatchObject({ type: 'add_faq' });
  });

  it('tool desconocida → null', () => {
    expect(reg.toChange('hack', {})).toBeNull();
  });
});
