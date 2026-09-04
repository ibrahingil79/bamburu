// ════════════════════════════════════════════════════════════════════════════════════════════════
// IMPORTADOR DE CSV — LA PANTALLA Y LA API (ficha H)
//
// DÓNDE VIVE Y POR QUÉ: cuelga de `/admin/migracion/importar`, es decir, DENTRO de la migración
// asistida. No es un capricho de URL — es H3 hecho colocación: quien entra a «Trae tus datos» ve
// las DOS vías (la que hace el equipo y la que puede hacer él) en la misma pantalla y elige. Un
// importador en otra punta del menú compite con la asistida en vez de complementarla, y además
// habría metido mano en la ficha B (dar entrada propia en el menú a la asistida), que está
// pendiente y no es esta tarea.
//
// LOS TRES PASOS, Y EL ORDEN NO ES NEGOCIABLE:
//   1. SUBIR   — el fichero se lee EN EL NAVEGADOR y se manda como texto. No se guarda en disco.
//   2. REVISAR — `/analizar` devuelve el mapeo propuesto y el veredicto fila a fila. NO ESCRIBE
//                NADA. El dueño corrige qué columna va a qué campo y vuelve a mirar las veces que
//                quiera. Cancelar aquí no deja rastro porque no hay rastro que dejar.
//   3. CONFIRMAR — `/importar` vuelve a analizar en el servidor y mete las buenas en UNA
//                transacción.
//
// EL VEREDICTO DEL NAVEGADOR NO VALE NADA. `/importar` no acepta «estas filas son buenas»: acepta
// el fichero y el mapeo, y decide él. Si aceptara la lista, cualquiera podría colar una fila que la
// vista previa había marcado en rojo.
//
// PERMISOS. La pantalla exige `company.read`, que es EXACTAMENTE el mismo candado que
// `/admin/migracion`, del que cuelga: cambiar de sitio no abre ni cierra puertas. Escribir exige
// además el permiso de alta de lo que se escribe (`clients.create` / `products.create`), que es el
// mismo que pide el formulario. Quien no puede crear un cliente a mano tampoco lo crea por CSV.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can } from '../layout.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { jsonForScript } from '../../../core/escape.js';
import { TIPOS, MAX_BYTES, MAX_FILAS, analizar, importar, deshacer, historial } from '../importador.js';

// Margen sobre el tope del fichero: el texto viaja dentro de un JSON, y el escapado de JSON puede
// engordarlo (cada comilla y cada salto de línea pasan a dos caracteres). Cortar justo en el tope
// rechazaría ficheros que sí caben.
const TOPE_CUERPO = MAX_BYTES * 2 + 64 * 1024;

export function createImportadorRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // Portero de tipo: existe + el usuario puede dar de alta ESO. Devuelve el error ya formado para
  // que las tres rutas de escritura lo apliquen igual y no se desincronicen.
  function porteroTipo(c, tipo) {
    if (!TIPOS[tipo]) return { error: 'No sé importar eso.', status: 400 };
    if (!can(c, TIPOS[tipo].perm)) return { error: 'No tienes permiso para dar de alta ' + TIPOS[tipo].label.toLowerCase() + '.', status: 403 };
    return null;
  }

  function leerCuerpo(body) {
    const tipo  = String(body.tipo || '').trim();
    const texto = String(body.texto == null ? '' : body.texto);
    const nombre = String(body.nombre || '').trim().slice(0, 200);
    const banda = String(body.banda || '').trim().slice(0, 40);
    let mapeo = null;
    if (body.mapeo && typeof body.mapeo === 'object' && !Array.isArray(body.mapeo)) mapeo = body.mapeo;
    return { tipo, texto, nombre, banda, mapeo };
  }

  // ── PASO 2 · LA VISTA PREVIA. NO ESCRIBE NADA. ────────────────────────────────────────────────
  // Pide el permiso de ALTA aunque no escriba: enseña, fila a fila, si un NIF ya existe en la base
  // y a qué cliente pertenece. Eso es leer la agenda de clientes por una rendija, y quien no puede
  // darlos de alta no tiene por qué asomarse.
  api.post('/analizar',
    bodyLimit({ maxSize: TOPE_CUERPO, onError: c => c.json({ error: 'El fichero es demasiado grande. El máximo son ' + Math.round(MAX_BYTES / 1024 / 1024) + ' MB.' }, 413) }),
    async c => {
      try {
        const { tipo, texto, banda, mapeo } = leerCuerpo(await c.req.json());
        const no = porteroTipo(c, tipo); if (no) return c.json({ error: no.error }, no.status);
        if (!texto.trim()) return c.json({ error: 'El fichero está vacío.' }, 400);
        if (Buffer.byteLength(texto, 'utf8') > MAX_BYTES) return c.json({ error: 'El fichero supera los ' + Math.round(MAX_BYTES / 1024 / 1024) + ' MB.' }, 413);
        return c.json({ ok: true, ...analizar(db, { tipo, texto, mapeo, bandaDefecto: banda }) });
      } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
    });

  // ── PASO 3 · CONFIRMAR ────────────────────────────────────────────────────────────────────────
  api.post('/importar',
    bodyLimit({ maxSize: TOPE_CUERPO, onError: c => c.json({ error: 'El fichero es demasiado grande.' }, 413) }),
    async c => {
      try {
        const { tipo, texto, nombre, banda, mapeo } = leerCuerpo(await c.req.json());
        const no = porteroTipo(c, tipo); if (no) return c.json({ error: no.error }, no.status);
        if (!texto.trim()) return c.json({ error: 'El fichero está vacío.' }, 400);
        if (Buffer.byteLength(texto, 'utf8') > MAX_BYTES) return c.json({ error: 'El fichero supera los ' + Math.round(MAX_BYTES / 1024 / 1024) + ' MB.' }, 413);

        const r = importar(db, { tipo, texto, mapeo, bandaDefecto: banda, nombre, session: c.get('session') });
        // La entidad es lo que se da de alta (cliente o producto), no un invento nuevo: `ENTITY` es
        // una lista cerrada y meter ahí una etiqueta que no existe ensucia el historial de Actividad.
        // El id del lote va en el texto porque NO es el id de un cliente ni de un producto.
        logActivity(db, c.get('session'), 'import', TIPOS[tipo].entidad, null,
          'Importó ' + r.creadas + ' ' + tipo + ' desde CSV (importación #' + r.lote_id + ')'
          + (r.omitidas ? ' · ' + r.omitidas + ' filas omitidas por errores' : ''));
        return c.json({ ok: true, ...r });
      } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
    });

  // ── DESHACER (H2) — archiva lo que entró en ese lote. No borra. ───────────────────────────────
  api.post('/:id/deshacer', async c => {
    try {
      const id = Number(c.req.param('id'));
      const lote = db.prepare('SELECT tipo FROM importaciones WHERE id=?').get(id);
      if (!lote) return c.json({ error: 'Esa importación no existe.' }, 404);
      const no = porteroTipo(c, lote.tipo); if (no) return c.json({ error: no.error }, no.status);
      const r = deshacer(db, id);
      logActivity(db, c.get('session'), 'import_undo', TIPOS[lote.tipo].entidad, null,
        'Deshizo la importación #' + id + ': ' + r.archivadas + ' fichas archivadas');
      return c.json({ ok: true, ...r });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.get('/historial', requirePerm('company.read'), c => {
    try { return c.json(historial(db, 20)); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── LA PANTALLA ───────────────────────────────────────────────────────────────────────────────
  views.get('/', requirePerm('company.read'), c => {
    const puede = {};
    for (const k of Object.keys(TIPOS)) puede[k] = can(c, TIPOS[k].perm);
    const alguno = Object.values(puede).some(Boolean);

    const content = `
    <style>
      .imp-wrap{max-width:960px}
      .imp-caja{background:var(--bg2);border:1px solid var(--border2);border-radius:14px;padding:1.2rem 1.3rem;margin-bottom:1rem}
      .imp-caja h3{margin:0 0 .3rem;font-size:1rem}
      .imp-caja p{margin:0 0 .9rem;color:var(--text2);font-size:.86rem;line-height:1.5}
      .imp-ops{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem}
      .imp-op{display:flex;flex-direction:column;gap:.15rem;text-align:left;font-family:inherit;cursor:pointer;min-width:0;
        border:2px solid var(--border2);background:var(--bg2);border-radius:12px;padding:.75rem .9rem}
      .imp-op[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
      .imp-op[disabled]{opacity:.45;cursor:not-allowed}
      .imp-op .n{font-weight:700;font-size:.92rem;color:var(--text)}
      .imp-op[aria-pressed="true"] .n{color:var(--accent)}
      .imp-op .d{font-size:.76rem;color:var(--text3)}
      .imp-nota{font-size:.8rem;color:var(--text2);background:var(--bg3);border-radius:10px;padding:.7rem .85rem;line-height:1.5}
      .imp-drop{border:2px dashed var(--border2);border-radius:12px;padding:1.1rem;text-align:center;color:var(--text2);font-size:.85rem;display:block;cursor:pointer}
      .imp-drop.tiene{border-color:var(--accent);color:var(--accent)}
      .imp-barra{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:.9rem}
      .imp-res{display:flex;gap:1.2rem;flex-wrap:wrap;align-items:baseline;margin-bottom:.8rem}
      .imp-res b{font-size:1.5rem;display:block;line-height:1.1}
      .imp-res span{font-size:.76rem;color:var(--text3)}
      .imp-ok b{color:var(--ok)} .imp-mal b{color:var(--danger)}
      .imp-map{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.55rem}
      .imp-map label{display:block;font-size:.76rem;color:var(--text3);margin-bottom:.15rem}
      .imp-map .ob{color:var(--err)}
      .imp-tabla-caja{overflow-x:auto;border:1px solid var(--border2);border-radius:12px}
      table.imp-tabla{border-collapse:collapse;width:100%;font-size:.8rem;white-space:nowrap}
      table.imp-tabla th{text-align:left;padding:.5rem .6rem;background:var(--bg3);color:var(--text3);font-weight:600;position:sticky;top:0}
      table.imp-tabla td{padding:.45rem .6rem;border-top:1px solid var(--border)}
      table.imp-tabla tr.mala td{background:var(--danger-s)}
      table.imp-tabla td.err{white-space:normal;color:var(--danger);font-size:.76rem;line-height:1.45}
      table.imp-tabla td.avi{white-space:normal;color:var(--text3);font-size:.76rem;line-height:1.45}
      .imp-fila-n{color:var(--text3);font-variant-numeric:tabular-nums}
      @media(max-width:520px){ .imp-caja{padding:.9rem} }
    </style>

    <div class="ph"><div>
      <div style="font-size:.75rem;color:var(--text3)"><a href="/admin" style="color:inherit">Inicio</a> ›
        <a href="/admin/migracion" style="color:inherit">Trae tus datos</a> ›</div>
      <h2 style="margin:0">Importar desde un CSV</h2>
    </div></div>

    <div class="imp-wrap">

      <div class="imp-caja">
        <h3>Nada entra hasta que lo confirmes</h3>
        <p>Sube tu fichero y te enseño <strong>qué columna va a qué campo</strong> y <strong>qué filas
           van a fallar</strong>, con el motivo de cada una, <strong>antes</strong> de guardar nada. Si
           cancelas, no ha entrado nada, porque hasta ese momento no se ha escrito nada.</p>
        <div class="imp-nota"><strong>Las facturas no entran por aquí.</strong> Una factura tiene número
          y cadena legal, y las que ya emitió tu programa anterior no se pueden volver a emitir en
          Bamburu sin declararlas dos veces. Para traerlas,
          <a href="/admin/migracion">pídenos la migración</a>: las pasa una persona del equipo, a mano
          y gratis.</div>
      </div>

      ${alguno ? '' : `<div class="imp-caja"><h3>No tienes permiso para importar</h3>
        <p>Importar da de alta clientes, productos o proveedores, así que hace falta el mismo permiso que para
           crearlos a mano. Pídeselo a quien administre tu Bamburu.</p></div>`}

      <div id="impPaso1" style="${alguno ? '' : 'display:none'}">
        <div class="imp-caja">
          <h3>¿Qué quieres importar?</h3>
          <div class="imp-ops" id="impTipo"></div>
        </div>

        <div class="imp-caja">
          <h3>Tu fichero</h3>
          <p>Un CSV exportado de tu programa o guardado desde Excel. Hasta
             ${Math.round(MAX_BYTES / 1024 / 1024)} MB y ${MAX_FILAS} filas. Reconozco el separador solo
             (punto y coma, coma o tabulador) y las comillas.</p>
          <label class="imp-drop" id="impDrop" for="impFichero">
            <i class="ti ti-file-spreadsheet"></i> <span id="impDropTxt">Elige tu fichero CSV…</span>
          </label>
          <input type="file" id="impFichero" accept=".csv,.txt,text/csv,text/plain" style="display:none">
          <div class="imp-barra">
            <button type="button" class="btn btn-primary" id="impVer">Ver la vista previa</button>
            <span style="font-size:.8rem;color:var(--text3)">Esto no guarda nada.</span>
          </div>
        </div>
      </div>

      <div id="impPaso2" style="display:none">
        <div class="imp-caja">
          <h3>Esto es lo que va a pasar</h3>
          <div class="imp-res" id="impResumen"></div>
          <div id="impAvisoFichero"></div>
        </div>

        <div class="imp-caja">
          <h3>Qué columna va a qué campo</h3>
          <p>Lo he cuadrado solo mirando los nombres de tus columnas. Cambia lo que no cuadre: la vista
             previa se rehace al momento.</p>
          <div class="imp-map" id="impMapeo"></div>
          <div id="impBandaCaja" style="display:none;margin-top:.9rem">
            <div class="imp-nota">Tu fichero no trae una columna de IVA. Elige qué banda se aplica a
              <strong>todos</strong> los productos de esta importación — o mapea arriba la columna que la
              traiga. <div style="margin-top:.5rem"><select class="form-control" id="impBanda" style="max-width:280px"></select></div></div>
          </div>
          <div id="impSinUsar" style="margin-top:.8rem"></div>
        </div>

        <div class="imp-caja">
          <h3>Fila a fila</h3>
          <p id="impVistaNota"></p>
          <div class="imp-tabla-caja"><table class="imp-tabla" id="impTabla"></table></div>
          <div class="imp-barra">
            <button type="button" class="btn btn-primary" id="impImportar"></button>
            <button type="button" class="btn btn-ghost" id="impCancelar">Cancelar</button>
            <span id="impCancelarNota" style="font-size:.8rem;color:var(--text3)">Cancelar no deja nada: todavía no se ha guardado nada.</span>
          </div>
        </div>
      </div>

      <div id="impPaso3"></div>

      <div class="imp-caja" id="impHistCaja" style="display:none">
        <h3>Lo que ya has importado</h3>
        <p><strong>Deshacer archiva</strong> las fichas que entraron en esa importación; no las borra
           —en Bamburu no se destruye nada—, así que dejan de salir en los listados pero siguen ahí. Lo
           que ya hayas hecho con ellas (una factura, un movimiento de stock) no se toca.</p>
        <div id="impHist"></div>
      </div>
    </div>

    <script nonce="${c.get('cspNonce')}">
    (function(){
      var TIPOS  = ${jsonForScript(Object.keys(TIPOS).map(k => ({ key: k, label: TIPOS[k].label, puede: !!puede[k] })))};
      var MAXB   = ${MAX_BYTES};
      var estado = { tipo: null, nombre: '', texto: '', juego: '', previa: null, ultimoLote: null };

      var $ = function(id){ return document.getElementById(id); };
      function muestra(id, si){ $(id).style.display = si ? '' : 'none'; }

      // ── El fichero se lee AQUÍ, y el juego de caracteres importa ────────────────────────────
      // Excel en español guarda en Windows-1252 más veces que en UTF-8. Si se lee como UTF-8, un
      // acento se convierte en el carácter de reemplazo y el cliente entra como "Mart?nez" para
      // siempre. Se lee en UTF-8, y si aparece ese carácter se relee en Windows-1252 y se DICE
      // cuál se usó, para que se pueda comprobar en la vista previa.
      // El tercer argumento, el de fallo, NO es opcional por gusto: sin él, quien elige un fichero
      // que el navegador no puede leer se queda con el botón deshabilitado en «Leyendo…» PARA
      // SIEMPRE, y la única salida es recargar. Se veía el aviso y el mando quedaba muerto
      // detrás. (23 ago 2026. Y ojo: aquí dentro no se escriben acentos graves ni escapes, que
      // esto vive en una plantilla del servidor y un solo acento grave la parte entera.)
      function leeFichero(file, cb, alFallar){
        var fr = new FileReader();
        var falla = function(){
          toast('No he podido leer el fichero. Vuelve a elegirlo o pruébalo guardado como CSV UTF-8.','err');
          if (alFallar) alFallar();
        };
        fr.onerror = falla;
        fr.onload = function(){
          var t = String(fr.result || '');
          if (t.indexOf('\\uFFFD') === -1) { cb(t, 'UTF-8'); return; }
          var fr2 = new FileReader();
          fr2.onerror = function(){ cb(t, 'UTF-8'); };
          fr2.onload = function(){ cb(String(fr2.result || ''), 'Windows-1252'); };
          fr2.readAsText(file, 'windows-1252');
        };
        fr.readAsText(file, 'utf-8');
      }

      function pintaTipos(){
        $('impTipo').innerHTML = TIPOS.map(function(t){
          return '<button type="button" class="imp-op" data-tipo="' + escHtml(t.key) + '"'
            + (t.puede ? '' : ' disabled title="No tienes permiso para dar de alta esto"')
            + ' aria-pressed="' + (estado.tipo === t.key) + '">'
            + '<span class="n">' + escHtml(t.label) + '</span>'
            + '<span class="d">' + (t.puede ? 'Listo para importar' : 'Sin permiso') + '</span></button>';
        }).join('');
      }
      pintaTipos();

      document.addEventListener('click', function(e){
        var t = e.target.closest('[data-tipo]');
        if (t && !t.disabled) { estado.tipo = t.getAttribute('data-tipo'); pintaTipos(); return; }
        var d = e.target.closest('[data-deshacer]');
        if (d) { deshacer(d.getAttribute('data-deshacer'), d); return; }
      });

      $('impFichero').addEventListener('change', function(){
        var f = this.files && this.files[0];
        $('impDropTxt').textContent = f ? f.name : 'Elige tu fichero CSV…';
        $('impDrop').classList.toggle('tiene', !!f);
      });

      $('impVer').addEventListener('click', function(){
        if (!estado.tipo) { toast('Dime primero qué quieres importar','err'); return; }
        var f = $('impFichero').files[0];
        if (!f) { toast('Elige tu fichero CSV','err'); return; }
        if (f.size > MAXB) { toast('El fichero supera el máximo','err'); return; }
        var btn = this; btn.disabled = true; btn.textContent = 'Leyendo…';
        var suelta = function(){ btn.disabled = false; btn.textContent = 'Ver la vista previa'; };
        leeFichero(f, function(texto, juego){
          estado.nombre = f.name; estado.texto = texto; estado.juego = juego;
          analiza(null, '').finally(suelta);
        }, suelta);
      });

      function analiza(mapeo, banda){
        return fetch('/api/erp/importar/analizar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
          body: JSON.stringify({ tipo: estado.tipo, texto: estado.texto, mapeo: mapeo, banda: banda })
        }).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; }); })
          .then(function(j){ estado.previa = j; pintaPrevia(); })
          .catch(function(e){ toast(e.message, 'err'); });
      }

      function pintaPrevia(){
        var p = estado.previa, r = p.resumen;
        muestra('impPaso1', false); muestra('impPaso2', true);
        $('impPaso3').innerHTML = '';

        $('impResumen').innerHTML =
            '<div><b>' + r.total + '</b><span>filas en tu fichero</span></div>'
          + '<div class="imp-ok"><b>' + r.buenas + '</b><span>van a entrar</span></div>'
          + '<div class="imp-mal"><b>' + r.malas + '</b><span>fallan y NO entran</span></div>';

        $('impAvisoFichero').innerHTML = '<div class="imp-nota">Separador detectado: <strong>'
          + escHtml(p.sep === '\\t' ? 'tabulador' : p.sep) + '</strong> · Texto leído como <strong>'
          + escHtml(estado.juego) + '</strong>. Los números salen ya interpretados: si ves un '
          + 'precio que no es el que esperabas, cámbialo en tu fichero y vuelve a subirlo.</div>';

        // ── El mapeo: un desplegable por campo, con las columnas del fichero ──────────────────
        $('impMapeo').innerHTML = p.campos.map(function(c){
          var ops = ['<option value="">— no traer —</option>'].concat(p.headers.map(function(h, i){
            return '<option value="' + i + '"' + (p.mapeo[c.key] === i ? ' selected' : '') + '>'
              + escHtml(h || ('Columna ' + (i + 1))) + '</option>';
          })).join('');
          return '<div><label>' + escHtml(c.label) + (c.obligatorio ? ' <span class="ob">*</span>' : '')
            + (c.ayuda ? ' <i class="ti ti-info-circle" title="' + escHtml(c.ayuda) + '"></i>' : '') + '</label>'
            + '<select class="form-control" data-campo="' + escHtml(c.key) + '">' + ops + '</select></div>';
        }).join('');

        var necesitaBanda = estado.tipo === 'productos' && p.mapeo.tax_band == null;
        muestra('impBandaCaja', necesitaBanda);
        if (necesitaBanda) {
          $('impBanda').innerHTML = ['<option value="">— elige la banda —</option>'].concat(p.bandas.map(function(b){
            return '<option value="' + escHtml(b.code) + '"' + (p.bandaDefecto === b.code ? ' selected' : '') + '>'
              + escHtml(b.label) + ' · ' + b.rate + '%</option>';
          })).join('');
        }

        $('impSinUsar').innerHTML = r.columnasSinUsar.length
          ? '<div class="imp-nota">Columnas de tu fichero que <strong>no</strong> se van a traer: '
            + r.columnasSinUsar.map(function(x){ return escHtml(x); }).join(' · ') + '</div>'
          : '';

        pintaTabla();

        $('impVistaNota').textContent = r.recortada
          ? ('Tu fichero trae ' + r.total + ' filas. Aquí se pintan ' + r.mostradas + ': TODAS las que '
             + 'fallan y el resto hasta llenar. Se han comprobado las ' + r.total + '.')
          : 'Estos son los valores exactos que se van a guardar.';

        var b = $('impImportar');
        b.disabled = r.buenas === 0;
        b.textContent = r.buenas === 0
          ? 'No hay ninguna fila que se pueda importar'
          : (r.buenas === 1 ? 'Importar la fila correcta' : 'Importar las ' + r.buenas + ' filas correctas')
            + (r.malas
                ? (r.malas === 1 ? ' (la fila con error se queda fuera)' : ' (las ' + r.malas + ' con error se quedan fuera)')
                : '');
      }

      function pintaTabla(){
        var p = estado.previa;
        var cols = p.campos.filter(function(c){ return p.mapeo[c.key] != null || c.obligatorio; });
        var cab = '<tr><th>Fila</th><th>Estado</th>'
          + cols.map(function(c){ return '<th>' + escHtml(c.label) + '</th>'; }).join('') + '</tr>';
        var cuerpo = p.filas.map(function(f){
          var malo = f.errores.length > 0;
          var fila = '<tr' + (malo ? ' class="mala"' : '') + '>'
            + '<td class="imp-fila-n">' + f.n + '</td>'
            + '<td>' + (malo ? '<span class="badge b-red">Falla</span>' : '<span class="badge b-green">Entra</span>') + '</td>'
            + cols.map(function(c){
                var v = f.datos[c.key];
                return '<td>' + escHtml(v === null || v === undefined || v === '' ? '—' : String(v)) + '</td>';
              }).join('') + '</tr>';
          if (malo) fila += '<tr class="mala"><td></td><td colspan="' + (cols.length + 1) + '" class="err">'
            + f.errores.map(function(x){ return escHtml(x); }).join('<br>') + '</td></tr>';
          else if (f.avisos.length) fila += '<tr><td></td><td colspan="' + (cols.length + 1) + '" class="avi">'
            + f.avisos.map(function(x){ return escHtml(x); }).join('<br>') + '</td></tr>';
          return fila;
        }).join('');
        $('impTabla').innerHTML = cab + cuerpo;
      }

      // Cambiar un desplegable del mapeo (o la banda) rehace la vista previa entera en el servidor.
      // Recalcular en el navegador sería escribir una segunda copia de las reglas.
      document.addEventListener('change', function(e){
        if (e.target.matches('[data-campo]')) {
          var mapeo = {};
          Array.prototype.forEach.call(document.querySelectorAll('[data-campo]'), function(s){
            mapeo[s.getAttribute('data-campo')] = s.value === '' ? null : Number(s.value);
          });
          analiza(mapeo, $('impBanda') ? $('impBanda').value : '');
          return;
        }
        if (e.target.id === 'impBanda') { analiza(estado.previa ? estado.previa.mapeo : null, e.target.value); }
      });

      $('impCancelar').addEventListener('click', function(){
        estado.previa = null; estado.texto = ''; estado.nombre = '';
        $('impFichero').value = ''; $('impDropTxt').textContent = 'Elige tu fichero CSV…';
        $('impDrop').classList.remove('tiene');
        muestra('impPaso2', false); muestra('impPaso1', true);
        toast('Cancelado. No ha entrado nada.');
      });

      $('impImportar').addEventListener('click', function(){
        var btn = this, txt = btn.textContent;
        btn.disabled = true; btn.textContent = 'Importando…';
        fetch('/api/erp/importar/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
          body: JSON.stringify({ tipo: estado.tipo, texto: estado.texto, nombre: estado.nombre,
                                 mapeo: estado.previa.mapeo, banda: $('impBanda') ? $('impBanda').value : '' })
        }).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; }); })
          .then(function(j){
            estado.ultimoLote = j.lote_id;
            muestra('impPaso2', false);
            $('impPaso3').innerHTML =
              '<div class="imp-caja" style="border-color:var(--ok)">'
              + '<h3 style="color:var(--ok)">Importado</h3>'
              + '<p>Han entrado <strong>' + j.creadas + '</strong> fichas'
              + (j.omitidas ? ' y se han quedado fuera <strong>' + j.omitidas + '</strong> filas con error, las que viste marcadas.' : '.')
              + '</p>'
              + '<div class="imp-barra">'
              + '<a class="btn btn-secondary" href="' + ({clientes:'/admin/clients',productos:'/admin/products',proveedores:'/admin/suppliers'}[estado.tipo] || '/admin') + '">Ver lo importado</a>'
              + '<button type="button" class="btn btn-ghost" data-deshacer="' + j.lote_id + '">Deshacer esta importación</button>'
              + '<button type="button" class="btn btn-ghost" id="impOtra">Importar otro fichero</button>'
              + '</div></div>';
            $('impOtra').addEventListener('click', function(){
              estado.texto = ''; estado.previa = null; $('impFichero').value = '';
              $('impDropTxt').textContent = 'Elige tu fichero CSV…'; $('impDrop').classList.remove('tiene');
              $('impPaso3').innerHTML = ''; muestra('impPaso1', true);
            });
            $('impPaso3').scrollIntoView({ block: 'center', behavior: 'smooth' });
            cargaHistorial();
          })
          .catch(function(e){ toast(e.message, 'err'); })
          .finally(function(){ btn.disabled = false; btn.textContent = txt; });
      });

      // ASYNC, y esto se me olvidó el 23 ago al quitar las ventanitas (punto 7): un await
      // abajo en una función normal es un ERROR DE SINTAXIS, y un error de sintaxis mata el bloque
      // ENTERO de JavaScript de la pantalla, no solo esta función. La pantalla del importador
      // estuvo muerta hasta que el gate del punto 14 la abrió en un navegador. Ni node --check
      // ni el lint de plantillas lo cazan: solo un navegador. Por eso nace lint-js-servido.mjs.
      async function deshacer(id, btn){
        if (!await window.confirmarEnPagina({titulo:'Deshacer la importación',texto:'Se ARCHIVAN las fichas que entraron en ella. No se borra nada, y lo archivado se puede volver a activar una a una.',aceptar:'Sí, deshacerla'})) return;
        btn.disabled = true;
        fetch('/api/erp/importar/' + encodeURIComponent(id) + '/deshacer', {
          method: 'POST', headers: { 'x-csrf-token': window.CSRF_TOKEN }
        }).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; }); })
          .then(function(j){ toast('Archivadas ' + j.archivadas + ' fichas de ' + j.total + '.'); $('impPaso3').innerHTML = ''; cargaHistorial(); })
          .catch(function(e){ btn.disabled = false; toast(e.message, 'err'); });
      }

      function cargaHistorial(){
        fetch('/api/erp/importar/historial').then(function(r){ return r.json(); }).then(function(xs){
          if (!Array.isArray(xs) || !xs.length) { muestra('impHistCaja', false); return; }
          muestra('impHistCaja', true);
          $('impHist').innerHTML = xs.map(function(x){
            var etq = ({clientes:'Clientes',productos:'Productos',proveedores:'Proveedores'})[x.tipo] || x.tipo;
            return '<div style="display:flex;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap">'
              + '<span style="flex:1;min-width:180px;font-size:.86rem">' + escHtml(etq)
              + (x.fichero ? ' · ' + escHtml(x.fichero) : '')
              + ' · <strong>' + x.filas_creadas + '</strong> fichas'
              + (x.filas_omitidas ? ' · ' + x.filas_omitidas + ' omitidas' : '') + '</span>'
              + '<span style="color:var(--text3);font-size:.75rem;white-space:nowrap">' + escHtml(String(x.created_at || '').slice(0, 16)) + '</span>'
              + (x.deshecha_at
                  ? '<span class="badge b-gray">Deshecha</span>'
                  : '<button type="button" class="btn btn-ghost btn-sm" data-deshacer="' + x.id + '">Deshacer</button>')
              + '</div>';
          }).join('');
        }).catch(function(){});
      }
      cargaHistorial();
    })();
    </script>`;

    return c.html(adminLayout('Importar desde un CSV', content, 'settings', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
