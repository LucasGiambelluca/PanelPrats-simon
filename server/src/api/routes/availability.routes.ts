import { Router } from 'express';
import { AvailabilityService } from '../../services/AvailabilityService';
import { supabase } from '../../config/supabase';

// Lectura de oficinas + profesionales + slots libres para el modal de agendado
// manual del inbox. A diferencia de /api/offices y /api/professionals (admin-only),
// estos endpoints son accesibles por empleadas (authContext) — recepción agenda
// desde el chat sin ser admin.
export function availabilityRouter(): Router {
  const r = Router();
  const svc = new AvailabilityService();

  // Oficinas activas con sus profesionales asignados (id + nombre).
  r.get('/offices', async (req, res) => {
    try {
      const accountId = String(req.query.account_id || '');
      const offices = await svc.listOffices(accountId);
      const { data: links } = await supabase
        .from('office_professionals')
        .select('office_id, profile_id, activa');
      const { data: profs } = await supabase.from('profiles').select('id, name, active');
      const nameOf = new Map((profs ?? []).map((p: any) => [p.id, p.name ?? 'Profesional']));
      const activeProf = new Set((profs ?? []).filter((p: any) => p.active !== false).map((p: any) => p.id));
      const out = offices.map((o) => ({
        id: o.id,
        nombre: o.nombre,
        modalidad: o.modalidad,
        profesionales: (links ?? [])
          .filter((l: any) => l.office_id === o.id && l.activa && activeProf.has(l.profile_id))
          .map((l: any) => ({ id: l.profile_id, name: nameOf.get(l.profile_id) || 'Profesional' })),
      }));
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'error' });
    }
  });

  // Slots libres de una oficina. Si viene `profesional`, sólo los slots donde ese
  // profesional está disponible.
  r.get('/slots', async (req, res) => {
    try {
      const accountId = String(req.query.account_id || '');
      const oficina = String(req.query.oficina || '');
      const profesional = req.query.profesional ? String(req.query.profesional) : null;
      // `date` (YYYY-MM-DD) = un día concreto del selector de fecha. AR es UTC-3 todo
      // el año (sin DST) → la ventana del día se acota con offset fijo -03:00.
      const date = req.query.date ? String(req.query.date) : null;
      const window = date
        ? { desde: `${date}T00:00:00.000-03:00`, hasta: `${date}T23:59:59.999-03:00` }
        : {};
      const max = Math.min(Number(req.query.max) || (date ? 48 : 12), 96);
      if (!oficina) return res.status(400).json({ error: 'falta oficina' });

      if (!profesional) {
        const slots = await svc.freeSlots(accountId, oficina, { ...window, max });
        return res.json(slots);
      }

      // Filtrado por profesional: generamos candidatos amplios y nos quedamos con
      // los slots donde ese profesional aparece como disponible.
      const office = await svc.getOffice(accountId, oficina);
      if (!office) return res.json([]);
      const candidatos = await svc.freeSlots(accountId, oficina, { ...window, max: max * 4 });
      const out: Array<{ start: string; end: string }> = [];
      for (const s of candidatos) {
        if (out.length >= max) break;
        const avail = await svc.availableProfessionals(office, s.start, s.end);
        if (avail.includes(profesional)) out.push(s);
      }
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'error' });
    }
  });

  return r;
}
