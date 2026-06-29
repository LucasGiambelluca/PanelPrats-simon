// ─── Comprensión "adulto mayor" ───────────────────────────────────────────────
// Batería de frases reales como las diría una persona mayor: indicaciones vagas,
// sin números exactos, con rodeos. Verifica que el "empleado" entienda sin fricción.
// Todo offline y determinístico (OptionResolver + ZoneResolver).

import { describe, it, expect } from 'vitest';
import { resolveOption, type OfferedOption } from '../OptionResolver';
import { matchZone, DEFAULT_GAZETTEER } from '../ZoneResolver';

const horarios: OfferedOption[] = [
  { index: 1, label: 'mar 01/07 09:30 hs', value: 'slot-mañana-temprano' },
  { index: 2, label: 'mar 01/07 11:00 hs', value: 'slot-mañana' },
  { index: 3, label: 'mié 02/07 16:00 hs', value: 'slot-tarde' },
];

const modalidades: OfferedOption[] = [
  { index: 1, label: 'En la oficina de CABA — presencial', value: 'CABA' },
  { index: 2, label: 'En la oficina de Quilmes — presencial', value: 'Quilmes' },
  { index: 3, label: 'Por videollamada', value: 'Videollamada' },
];

describe('Empleado entiende al adulto mayor — elección de horario', () => {
  const casos: Array<[string, string]> = [
    ['deme el primerito', 'slot-mañana-temprano'],
    ['el de más temprano', 'slot-mañana-temprano'],
    ['mejor a la tardecita', 'slot-tarde'],
    ['el último que me dijo', 'slot-tarde'],
    ['el del medio', 'slot-mañana'],
    ['mañana a la mañana mejor', 'slot-mañana-temprano'], // primero de los de la mañana
    ['el segundo', 'slot-mañana'],
    ['el tercero por favor', 'slot-tarde'],
    ['cualquiera me viene bien, lo que tenga más a mano', 'slot-mañana-temprano'],
  ];
  for (const [frase, esperado] of casos) {
    it(`"${frase}" → ${esperado}`, () => {
      expect(resolveOption({ userText: frase, offered: horarios }).matchedValue).toBe(esperado);
    });
  }
});

describe('Empleado entiende al adulto mayor — elección de modalidad', () => {
  const casos: Array<[string, string]> = [
    ['prefiero por la computadora, la videollamada esa', 'Videollamada'],
    ['no, mejor me acerco a Quilmes', 'Quilmes'],
    ['voy en persona', 'CABA'],          // primera presencial
    ['el tercero, el de la pantalla', 'Videollamada'],
  ];
  for (const [frase, esperado] of casos) {
    it(`"${frase}" → ${esperado}`, () => {
      expect(resolveOption({ userText: frase, offered: modalidades }).matchedValue).toBe(esperado);
    });
  }

  it('cuando NO entiende, no inventa (deja que el agente repregunte)', () => {
    expect(resolveOption({ userText: 'mmm no sé, lo que usted diga m\'hija', offered: modalidades }).matchedValue).toBeNull();
  });
});

describe('Empleado ubica la zona aunque la persona no sea precisa', () => {
  const casos: Array<[string, string | null]> = [
    ['y... yo vivo por Lanús, cerca de la estación', 'Quilmes'],
    ['soy de Ramitos, Ramos Mejía digo', 'Haedo'],
    ['estoy en pleno centro, en el microcentro', 'CABA'],
    ['ando por San Isidro', 'CABA'],
    ['vivo en Berazategui hace años', 'Quilmes'],
  ];
  for (const [frase, esperado] of casos) {
    it(`"${frase}" → ${esperado ?? 'pregunta'}`, () => {
      const r = matchZone(frase, DEFAULT_GAZETTEER);
      expect(r.oficina_sugerida).toBe(esperado);
      expect(r.siempre_ofrecer_video).toBe(true);
    });
  }

  it('"soy del conurbano nomás" → pregunta cuál zona, no adivina', () => {
    const r = matchZone('soy del conurbano nomás', DEFAULT_GAZETTEER);
    expect(r.oficina_sugerida).toBeNull();
    expect(r.necesita_aclaracion).toBe(true);
  });

  it('"vivo lejos, en Mar del Plata" → ofrece videollamada directo', () => {
    const r = matchZone('vivo lejos, en Mar del Plata', DEFAULT_GAZETTEER);
    expect(r.oficina_sugerida).toBeNull();
    expect(r.necesita_aclaracion).toBe(false); // no la marea: video y listo
  });
});
