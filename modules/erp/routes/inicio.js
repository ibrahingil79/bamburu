// INICIO PERSONALIZABLE — rutas. Escalera · paso 6.
// La puerta de datos del Inicio componible: resuelve el layout de este usuario (cascada usuario >
// empresa > fábrica), sirve la paleta de bloques que PUEDE colocar y guarda su capa (o el default de
// empresa, si es el dueño). SOLO LECTURA sobre datos de negocio: aquí solo se guarda la COLOCACIÓN.
//
// PERMISOS heredados: `can()` decide qué áreas ve; `sanear` omite los bloques que no puede ver (ni los
// del default del dueño se cuelan) y `chequearPaneles` da 403 si intenta COLOCAR un panel de un área que
// no ve. El default de EMPRESA solo lo edita el dueño (403 para el resto).
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { can, fuentesPermitidas } from '../layout.js';
import { listarPaneles } from '../constructor-analitica.js';
import * as IL from '../inicio-layout.js';

export function createInicioRoutes(db) {
  const api = new Hono();
  const puedeDe = c => (p) => can(c, p);
  const esDuenyo = c => c.get('session')?.role === 'owner';
  const symbol = () => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
  const mapPaneles = userId => new Map(listarPaneles(db, userId).map(p => [p.id, p]));

  // 403 si el layout intenta COLOCAR un panel que este usuario no ve (defensa en profundidad: la paleta
  // ya no se lo ofrece, pero forzarlo por la API tampoco cuela).
  function chequearPaneles(blocks, userId, puede) {
    const visibles = new Set(IL.bloquesDisponibles(db, userId, puede).paneles.map(p => p.refId));
    for (const b of blocks) if (b.tipo === 'panel' && !visibles.has(b.refId)) {
      const e = new Error('No puedes colocar en tu Inicio un panel de un área que no ves'); e.status = 403; throw e;
    }
  }

  // El layout que debe pintar el Inicio, SANEADO por permiso. Por defecto el RESUELTO para este usuario
  // (cascada usuario > empresa > fábrica). `?scope=empresa` (solo dueño) devuelve el default de empresa
  // para editarlo, en vez de la capa personal del dueño.
  api.get('/layout', c => {
    try {
      const userId = c.get('session')?.userId;
      const puede = puedeDe(c);
      const panelesById = mapPaneles(userId);
      if (c.req.query('scope') === 'empresa') {
        if (!esDuenyo(c)) { const e = new Error('Solo el dueño'); e.status = 403; throw e; }
        const guardado = IL.getLayout(db, 'empresa');
        const blocks = IL.sanear(guardado || IL.FABRICA, { puede, panelesById });
        return c.json({ blocks, origen: guardado ? 'empresa' : 'fabrica', editandoEmpresa: true,
                        esDuenyo: true, empresaExiste: !!guardado });
      }
      const res = IL.resolver(db, userId);
      const blocks = IL.sanear(res.blocks, { puede, panelesById });
      return c.json({ blocks, origen: res.origen, tieneCapaPropia: res.tieneCapaPropia,
                      esDuenyo: esDuenyo(c), empresaExiste: !!IL.getLayout(db, 'empresa') });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // La PALETA: nativos permitidos + los paneles guardados que este usuario puede ver.
  api.get('/bloques', c => {
    try { return c.json(IL.bloquesDisponibles(db, c.get('session')?.userId, puedeDe(c))); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Datos de los bloques nativos (KPIs + avisos), filtrados por permiso (misma lógica que el Inicio).
  api.get('/datos', c => {
    try {
      return c.json(IL.datosNativos(db, { puede: puedeDe(c), userId: c.get('session')?.userId,
                                          fuentes: fuentesPermitidas(c), sym: symbol() }));
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Guardar MI capa (usuario:<id>).
  api.put('/layout', async c => {
    try {
      const userId = c.get('session')?.userId;
      const blocks = IL.normalizar((await c.req.json().catch(() => ({}))).blocks);
      chequearPaneles(blocks, userId, puedeDe(c));
      IL.setLayout(db, 'usuario:' + userId, blocks, userId);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Guardar el DEFAULT DE EMPRESA (solo el dueño).
  api.put('/empresa', async c => {
    try {
      if (!esDuenyo(c)) { const e = new Error('Solo el dueño edita el Inicio de la empresa'); e.status = 403; throw e; }
      const userId = c.get('session')?.userId;
      const blocks = IL.normalizar((await c.req.json().catch(() => ({}))).blocks);
      chequearPaneles(blocks, userId, puedeDe(c));
      IL.setLayout(db, 'empresa', blocks, userId);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Reset MI capa → vuelvo al default de empresa (o al de fábrica).
  api.delete('/layout', c => {
    try { IL.delLayout(db, 'usuario:' + c.get('session')?.userId); return c.json({ ok: true }); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Reset el DEFAULT DE EMPRESA → vuelve al de fábrica (solo el dueño).
  api.delete('/empresa', c => {
    try {
      if (!esDuenyo(c)) { const e = new Error('Solo el dueño'); e.status = 403; throw e; }
      IL.delLayout(db, 'empresa'); return c.json({ ok: true });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  return { api };
}
