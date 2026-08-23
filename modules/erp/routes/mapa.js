// ════════════════════════════════════════════════════════════════════════════════════════════════
// LAS TESELAS DEL MAPA, SERVIDAS POR NOSOTROS (bloque F)
//
// POR QUÉ ESTA RUTA EXISTE EN VEZ DE APUNTAR AL SERVIDOR DE OPENSTREETMAP. Porque la ficha de un
// cliente no puede depender de un tercero cada vez que se abre. Con esto, el navegador solo habla
// con Bamburu: la primera ficha de un barrio hace que el SERVIDOR baje esas imágenes una vez y las
// guarde en disco; a partir de ahí salen de aquí y openstreetmap.org no vuelve a enterarse de nada
// —ni de qué cliente se mira, ni de quién lo mira, ni de cuándo—. Es además lo que deja `connect-src
// 'self'` intacto y evita meter un dominio ajeno en la CSP.
//
// LA VALIDACIÓN NO ES DECORATIVA: z/x/y llegan de la calle y componen una URL de salida. Se
// convierten a ENTEROS y se comprueban contra el rango real del nivel de zoom (`coordenadaDeTesela`)
// ANTES de tocar la red o el disco. Lo que se concatena son los números ya validados, nunca el texto
// recibido — sin eso, esta ruta sería un mandadero para pedir cualquier cosa a cualquier sitio, y la
// caché, un sitio donde escribir ficheros con el nombre que quisiera quien llama.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { safeError } from '../../../core/errors.js';
import { tesela, sugerir } from '../mapa-cliente.js';

export function createMapaRoutes(db) {
  const api = new Hono();

  // El candado es `clients.read` porque hoy el único sitio que pinta mapa es la ficha de cliente:
  // quien no puede abrir un cliente tampoco tiene por qué poder tirar de nuestra caché de imágenes.
  api.get('/tesela/:z/:x/:y', requirePerm('clients.read'), async c => {
    try {
      const buf = await tesela(c.req.param('z'), c.req.param('x'), c.req.param('y'));
      // Sin tesela NO se inventa nada ni se avisa de nada: un 404 hace que el mapa deje ese hueco en
      // gris y siga funcionando. Es el mismo criterio del encargo — mejor callar que enseñar basura.
      if (!buf) return c.body(null, 404);
      return new Response(buf, {
        headers: {
          'Content-Type': 'image/png',
          // Un mes y `immutable`: la tesela z/x/y de un barrio no cambia de un día para otro, y con
          // esto abrir la misma ficha dos veces cuesta CERO peticiones (importa: el freno general de
          // index.js es de 600/min por IP y un mapa son ~8 imágenes).
          // `private` y no `public` a propósito: la respuesta va detrás de una sesión y no tiene por
          // qué quedarse en ninguna caché compartida del camino.
          'Cache-Control': 'private, max-age=2592000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── SUGERENCIAS DE DIRECCIÓN, MIENTRAS SE ESCRIBE ──────────────────────────────────────────
  // Pasa por aquí y no por el navegador por tres motivos, y ninguno es de estilo: la CSP del panel
  // lleva `connect-src 'self'` (una llamada directa desde la página la bloquearía el navegador), el
  // buscador de fuera no tiene por qué saber a quién está fichando este negocio, y la caché del
  // servidor sirve para TODOS los usuarios en vez de una por pestaña.
  // Nunca devuelve error al que escribe: si el servicio no contesta, la lista viene vacía y el campo
  // se comporta como el de siempre. Escribir una dirección no puede romperse porque falle un tercero.
  api.get('/sugerencias', requirePerm('clients.read'), async c => {
    try {
      // El país del NEGOCIO ordena la lista (no la recorta). Si no está configurado, no hay sesgo.
      let pais = '';
      try { pais = db.prepare('SELECT country FROM company_config WHERE id=1').get()?.country || ''; } catch {}
      return c.json({ sugerencias: await sugerir(c.req.query('q') || '', pais) });
    } catch { return c.json({ sugerencias: [] }); }
  });

  return { api };
}
