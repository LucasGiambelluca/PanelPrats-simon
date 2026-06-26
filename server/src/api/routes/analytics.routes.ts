import { Router } from 'express';
import { AppointmentService } from '../../services/AppointmentService';
import { supabase } from '../../config/supabase';

/**
 * Analíticas de recepción para el admin (réplica de lo que la planilla calcula a mano).
 * Solo admin: se monta detrás de requireRole('admin').
 *
 * GET /api/analytics/intake?from=ISO&to=ISO&account_id=...
 *   - from/to: filtran por created_at (default: sin límite).
 *   - account_id: una línea; ausente o 'all' = todas las cuentas del estudio.
 */
export function analyticsRouter(): Router {
  const r = Router();

  r.get('/intake', async (req, res) => {
    try {
      const accountId = req.query.account_id as string | undefined;
      const from = req.query.from ? new Date(String(req.query.from)).getTime() : -Infinity;
      const to = req.query.to ? new Date(String(req.query.to)).getTime() : Infinity;

      const all = await AppointmentService.list(
        accountId && accountId !== 'all' ? accountId : undefined,
      );
      const rows = all.filter((a) => {
        const t = new Date(a.created_at).getTime();
        return Number.isFinite(t) && t >= from && t <= to;
      });

      // Mapa id→nombre de empleadas/abogadas para etiquetar los rankings.
      const names = await loadProfileNames();

      const total = rows.length;
      const ganados = rows.filter((a) => a.resultado === 'si').length;

      const porResultado = countBy(rows, (a) => a.resultado);
      const porCanal = countBy(rows, (a) => a.canal_origen);
      const porMotivo = countBy(rows, (a) => a.motivo);
      const porMes = countByWithConversion(rows, (a) => a.created_at.slice(0, 7)); // YYYY-MM
      const porEmpleada = rankWithConversion(rows, (a) => a.atendido_por, names);
      const porAbogada = rankWithConversion(rows, (a) => a.assigned_profile_id, names);

      res.json({
        total,
        conversion: total ? ganados / total : 0,
        porResultado,
        porCanal,
        porMotivo,
        porMes,
        porEmpleada,
        porAbogada,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}

// ---- helpers ----

function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || 'sin_dato';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// Igual que countBy pero arma { total, conversion } por bucket, ordenado por clave.
function countByWithConversion<T extends { resultado?: any }>(
  rows: T[],
  key: (r: T) => string | null | undefined,
): Array<{ bucket: string; total: number; conversion: number }> {
  const acc: Record<string, { total: number; si: number }> = {};
  for (const r of rows) {
    const k = key(r) || 'sin_dato';
    acc[k] = acc[k] || { total: 0, si: 0 };
    acc[k].total += 1;
    if (r.resultado === 'si') acc[k].si += 1;
  }
  return Object.entries(acc)
    .map(([bucket, v]) => ({ bucket, total: v.total, conversion: v.total ? v.si / v.total : 0 }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// Ranking por persona (id→nombre) con total y conversión, ordenado desc por total.
function rankWithConversion<T extends { resultado?: any }>(
  rows: T[],
  key: (r: T) => string | null | undefined,
  names: Map<string, string>,
): Array<{ id: string; name: string; total: number; conversion: number }> {
  const acc: Record<string, { total: number; si: number }> = {};
  for (const r of rows) {
    const k = key(r) || 'sin_asignar';
    acc[k] = acc[k] || { total: 0, si: 0 };
    acc[k].total += 1;
    if (r.resultado === 'si') acc[k].si += 1;
  }
  return Object.entries(acc)
    .map(([id, v]) => ({
      id,
      name: id === 'sin_asignar' ? 'Sin asignar / bot' : names.get(id) || id,
      total: v.total,
      conversion: v.total ? v.si / v.total : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

async function loadProfileNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await supabase.from('profiles').select('id, name');
    for (const p of data || []) map.set(p.id, p.name || '(sin nombre)');
  } catch {
    // sin profiles configurados / supabase apagado → rankings caen al id crudo.
  }
  return map;
}
