import { Hono } from 'hono';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { reverseMovement } from '../stock.js';
import { ENTITY } from '../../../core/activity-entities.js';

// Pilar 3 · Paso 1 — operaciones sobre el libro de movimientos a nivel global.
// El ajuste por producto vive en /api/erp/products/:id/stock/adjust; aquí la reversión.
export function createStockRoutes(db) {
  const api = new Hono();

  // POST /api/erp/stock/movements/:id/reverse — crea el movimiento que revierte al
  // original (opuesto, reverses_movement_id). Doble seguro: 400 si ya está revertido.
  api.post('/movements/:id/reverse', requirePerm('inventory.edit'), c => {
    try {
      const res = reverseMovement(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Revirtió movimiento de stock', ENTITY.STOCK_MOVEMENT, res.movement_id, `revierte #${res.reverses}`);
      return c.json(res);
    } catch (e) { return c.json({ error: e.message }, e.status || 400); }
  });

  return { api };
}
