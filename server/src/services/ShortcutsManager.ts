// src/services/ShortcutsManager.ts
//
// STUB GENÉRICO (Plan 2, Task 3): el ShortcutsManager original resolvía atajos
// de botones acoplados a comercio (view_order, track_order, order_issue, rate_*,
// handover) consultando tablas como `orders`, `flow_executions`,
// `whatsapp_conversations` y `customer_issues`. Para el panel multicuenta genérico
// no portamos esas dependencias de comercio. Mantenemos SOLO la firma que el
// engine necesita —`handle(id, phone)`— que ahora devuelve `null` (= "no es un
// atajo conocido, seguir el flujo normal"). Los atajos específicos se reintroducen
// cuando exista una fuente de datos genérica por `account_id` (planes posteriores).

import { logger } from '../utils/logger';

export class ShortcutsManager {
  /**
   * Procesa IDs de botones globales que no pertenecen a un nodo específico.
   * Retorna una lista de mensajes si el ID fue manejado, o null si no.
   *
   * Stub genérico: siempre devuelve `null` (sin atajos de comercio).
   */
  static async handle(id: string, phone: string): Promise<any[] | null> {
    const rawId = id || '';
    const normalizedId = rawId
      .replace(/[\*_]/g, '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    logger.debug(`[ShortcutsManager] (stub) shortcut ignorado: RAW="${rawId}" NORMALIZED="${normalizedId}" for ${phone}`);

    // Sin atajos de comercio: el flujo continúa normalmente.
    return null;
  }
}
