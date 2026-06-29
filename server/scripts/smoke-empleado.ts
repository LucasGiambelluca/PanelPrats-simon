// Smoke de las 4 capacidades "empleado" SIN LLM: ejercita los servicios
// determinísticos + persistencia real (Supabase/Redis) para validar migraciones
// 0024-0026 y el wiring. El camino LLM se prueba aparte (requiere key con saldo).
import 'dotenv/config';
import { ZoneResolver } from '../src/core/agent/context/ZoneResolver';
import { OfferedOptionsStore } from '../src/core/agent/context/OfferedOptionsStore';
import { resolveOption } from '../src/core/agent/context/OptionResolver';
import { sanitizeFicha } from '../src/core/agent/context/ReceptionFichaBuilder';
import { ContactMemory } from '../src/core/agent/runtime/ContactMemory';
import { AppointmentService } from '../src/services/AppointmentService';

const ACC = process.env.SMOKE_ACCOUNT_ID || 'fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982';
const PHONE = '549110000SMOKE';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

(async () => {
  // ── Cap 3: geo-routing (lee zone_gazetteer real + cae al default) ──
  const zone = new ZoneResolver();
  const z1 = await zone.suggest(ACC, 'soy de Lanús, cerca de la estación');
  check('Cap3 geo: "Lanús" → Quilmes', z1.oficina_sugerida === 'Quilmes', JSON.stringify(z1));
  const z2 = await zone.suggest(ACC, 'soy del conurbano nomás');
  check('Cap3 geo: vago → pregunta', z2.necesita_aclaracion === true && z2.oficina_sugerida === null);
  const z3 = await zone.suggest(ACC, 'vivo en Mar del Plata');
  check('Cap3 geo: fuera de cobertura → video, sin marear', z3.oficina_sugerida === null && z3.necesita_aclaracion === false);

  // ── Cap 4: comprensión + persistencia de lo ofrecido (Redis real) ──
  const store = new OfferedOptionsStore();
  const offered = [
    { index: 1, label: 'mar 01/07 09:30 hs', value: 'v1' },
    { index: 2, label: 'mar 01/07 11:00 hs', value: 'v2' },
    { index: 3, label: 'mié 02/07 16:00 hs', value: 'v3' },
  ];
  await store.set(ACC, PHONE, offered);
  const got = await store.get(ACC, PHONE);
  check('Cap4 store: round-trip Redis', got.length === 3, `len=${got.length} (0 si Redis off)`);
  check('Cap4 resolve: "deme el primerito" → v1', resolveOption({ userText: 'deme el primerito', offered }).matchedValue === 'v1');
  check('Cap4 resolve: "a la tardecita" → v3', resolveOption({ userText: 'a la tardecita', offered }).matchedValue === 'v3');
  check('Cap4 resolve: "no sé" → null (no inventa)', resolveOption({ userText: 'no sé', offered }).matchedValue === null);

  // ── Cap 1: continuidad (escribe/lee columnas 0024) ──
  const mem = new ContactMemory();
  await mem.saveThread(ACC, PHONE, { lastTopic: 'jubilacion', currentThread: { paso: 'eligiendo_horario' } });
  const ext = await mem.loadExtended(ACC, PHONE);
  check('Cap1 memoria: last_topic persistido (0024)', ext.lastTopic === 'jubilacion');
  check('Cap1 memoria: last_interaction_at seteado', ext.lastInteractionAt instanceof Date);
  check('Cap1 memoria: current_thread persistido', ext.currentThread?.paso === 'eligiendo_horario');

  // ── Cap 2: ficha saneada + persistencia 0025 ──
  const ficha = sanitizeFicha(
    { nombre: 'Juan', edad: '62', dni: '20.345.678', motivo: 'jubilacion', anios_aporte: '30', resumen_ia: 'Juan, 62, 30 años de aportes.' },
    { telefono: PHONE, modalidad: 'video', zona: 'Quilmes' });
  check('Cap2 ficha: edad/dni saneados, telefono server-side', ficha.edad === 62 && ficha.dni === '20345678' && ficha.telefono === PHONE);

  const future = new Date(Date.now() + 40 * 86400000).toISOString();
  let createdId: string | null = null;
  try {
    const appt = await AppointmentService.create({
      account_id: ACC, phone: PHONE, telefono: PHONE, nombre: 'SMOKE Juan',
      resumen: 'smoke', status: 'pendiente', start_time: future,
      end_time: new Date(Date.parse(future) + 3600000).toISOString(),
      oficina: 'Videollamada SMOKE', assigned_profile_id: null,
      resumen_ia: ficha.resumen_ia, perfil_json: ficha,
    } as any);
    createdId = appt.id;
    const back = await AppointmentService.getById(appt.id);
    check('Cap2 persist: resumen_ia + perfil_json en la cita (0025)',
      !!back?.resumen_ia && (back as any)?.perfil_json?.edad === 62, JSON.stringify({ resumen_ia: back?.resumen_ia, perfil: (back as any)?.perfil_json }));
  } catch (e: any) {
    check('Cap2 persist', false, e?.message);
  } finally {
    if (createdId) { await AppointmentService.delete(createdId); console.log('🧹 cita de prueba eliminada'); }
  }

  console.log(`\n— ${pass} OK / ${fail} fallos —`);
  process.exit(fail ? 1 : 0);
})();
