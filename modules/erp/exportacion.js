// exportacion.js — «Llévate todo lo tuyo»: la copia completa de un negocio, en un solo ZIP.
//
// Tarea `suscripcion-datos-tras-el-corte` (2 sep 2026). Cortado el uso, el cliente tiene 90 días
// para descargarse **todo**, él solo y sin pedir permiso.
//
// POR QUÉ VIVE EN `modules/erp/` Y NO EN `core/`. Necesita `buildInvoicePaper`, que es del ERP. Un
// `core/` que importe de `modules/` invierte la dependencia y deja el núcleo colgando de una
// pantalla; ya se decidió así con el formato del dinero.
//
// FORMATOS QUE SE ABREN SIN SER INFORMÁTICO, que es el criterio y no una preferencia:
//   · **CSV con BOM y punto y coma.** El BOM es lo que hace que Excel abra los acentos bien en vez de
//     `AdriÃ¡n`; el punto y coma es el separador que Excel espera en España. Con coma y sin BOM, el
//     fichero «se abre» y sale ilegible en una sola columna — que es peor que no abrirse, porque
//     parece que funciona.
//   · **Las facturas en PDF**, generadas por el MISMO camino que usa el botón «Descargar PDF» del
//     producto (`buildInvoicePaper` → `printableShell` → Chromium). No se reimplementa: un PDF de
//     export distinto del que ve el cliente sería otro documento.
//
// SE PREPARA EN SEGUNDO PLANO, y la razón está medida: el negocio más grande de este servidor tiene
// **939 facturas**, y cada PDF pasa por Chromium. Eso son minutos, no segundos. Una petición HTTP que
// tarda minutos se corta por el camino y deja al cliente con medio fichero — o con nada y sin saber
// por qué.
//
// EL PAQUETE SE COMPRUEBA A SÍ MISMO ANTES DE ENTREGARSE. Se cuentan las filas de cada tabla en la
// base y se contrastan con las escritas, y **el ZIP se vuelve a leer entero verificando el CRC de
// cada fichero**. Si algo no cuadra, no se entrega: se falla en voz alta. Una descarga a medias que
// parece entera es el peor fallo posible de esta tarea, y este proyecto ya tiene escrito lo que pasa
// cuando una comprobación dice que todo está bien sin serlo.

import { mkdirSync, writeFileSync, statSync } from 'fs';
import path from 'path';
import { crearZip, verificarZip } from '../../core/zip.js';
import { buildInvoicePaper } from './routes/invoices.js';
import { printableShell } from './layout.js';
import { renderPdfFromHtml } from '../../core/pdf.js';

export const DIRECTORIO = path.join(process.cwd(), 'data', 'exportaciones');

// Cuántas facturas se convierten a PDF a la vez. Medido en este servidor: **2,2 s por PDF** en
// serie, o sea 34 minutos para las 939 del negocio más grande. `renderPdfFromHtml` abre y cierra su
// propia pestaña, así que admite paralelo sin tocarlo.
//
// TRES Y NO DIEZ, y el número tiene motivo: al otro lado de ese Chromium está el producto de los
// demás negocios, que también lo usa para sus PDFs. Una exportación no puede comerse la máquina.
export const PDFS_A_LA_VEZ = 3;

// UNA exportación a la vez en todo el servidor. Sin esto, tres negocios pidiendo su copia el mismo
// día lanzan nueve Chromium en paralelo y tumban el producto para todos. Quien llega y lo encuentra
// ocupado no falla: espera su turno.
let enCurso = Promise.resolve();
function enFila(fn) {
  const mio = enCurso.then(fn, fn);
  enCurso = mio.then(() => {}, () => {});
  return mio;
}

// ── LO QUE NO SE EMPAQUETA, Y POR QUÉ ────────────────────────────────────────────────────────────
// No es un recorte del criterio: son **credenciales**, no datos del negocio. Una sesión abierta o el
// hash de una contraseña dentro de un ZIP que el cliente se manda por correo a su gestor es una
// llave de su casa viajando en un sobre.
//
// ⚠️ Y LO QUE IMPORTA TANTO COMO EXCLUIRLAS: **se dicen**. Van nombradas en el LEEME y en el
// manifiesto, con su motivo. Una omisión silenciosa es exactamente la «descarga a medias que parece
// entera» que esta tarea existe para impedir.
export const TABLAS_FUERA = {
  admin_sessions: 'sesiones abiertas: son llaves de entrada, no datos del negocio',
  admin_recovery_codes: 'códigos de rescate del acceso en dos pasos',
  customer_sessions: 'sesiones abiertas de clientes del portal',
};
export const COLUMNAS_FUERA = {
  admin_users: { password_hash: 'contraseña', totp_secret: 'secreto del acceso en dos pasos' },
};

// Los nombres de carpeta que ve una persona. Lo que no esté aquí va a «Otros datos» con el nombre
// de su tabla: **todo se exporta**, tenga o no un nombre bonito.
const AREAS = [
  ['Clientes',            ['clients', 'client_contacts', 'client_activities', 'client_groups', 'client_geo', 'client_group_members']],
  ['Facturas y ventas',   ['invoices', 'invoice_items', 'invoice_payments', 'quotes', 'quote_items', 'customer_orders', 'customer_order_items', 'albaranes', 'albaran_items', 'recurrentes']],
  ['Compras y gastos',    ['suppliers', 'purchases', 'purchase_items', 'supplier_invoices', 'purchase_orders', 'purchase_order_items', 'supplier_returns', 'pagos']],
  ['Catálogo',            ['products', 'categories', 'tags', 'product_tags']],
  ['Inventario',          ['stock', 'stock_moves', 'warehouses', 'stock_transfers', 'lotes']],
  ['Agenda y citas',      ['citas', 'cita_servicios', 'cita_avisos', 'agenda_bloqueos', 'recursos', 'cita_pub_personas']],
  ['Proyectos y tiempo',  ['proyectos', 'tiempo_registros', 'fichajes']],
  ['Contabilidad',        ['bank_movements', 'bank_reconciliations', 'asientos', 'asiento_lineas']],
  ['Mi negocio',          ['company_config', 'admin_users', 'permissions', 'user_permissions']],
];

const areaDe = (tabla) => (AREAS.find(([, ts]) => ts.includes(tabla)) || ['Otros datos'])[0];

/** Una celda de CSV, escapada como manda el formato: comillas dobladas y el campo entrecomillado. */
function celda(v) {
  if (v === null || v === undefined) return '';
  if (Buffer.isBuffer(v)) return `(dato binario, ${v.length} bytes)`;
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Una tabla entera a CSV. Devuelve `{ csv, filas }` — las filas se usan para el contraste. */
export function tablaACsv(db, tabla) {
  const fuera = COLUMNAS_FUERA[tabla] || {};
  const cols = db.prepare(`PRAGMA table_info("${tabla}")`).all()
    .map(c => c.name).filter(n => !fuera[n]);
  const filas = db.prepare(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM "${tabla}"`).all();
  const lineas = [cols.join(';'), ...filas.map(f => cols.map(c => celda(f[c])).join(';'))];
  // El BOM va delante del todo: es lo que le dice a Excel «esto es UTF-8».
  return { csv: '﻿' + lineas.join('\r\n') + '\r\n', filas: filas.length, columnasFuera: Object.keys(fuera) };
}

/**
 * Construye el paquete completo. Devuelve `{ ok, ruta, bytes, resumen, error }`.
 * NUNCA lanza: lo llama una preparación en segundo plano que no puede morirse en silencio.
 *
 * `alProgresar` recibe un texto por paso, para que el registro cuente qué está haciendo — una
 * preparación de minutos que no dice nada es indistinguible de una colgada.
 */
export async function exportarNegocio(tenant, db, opciones = {}) {
  // En fila: una exportación a la vez en todo el servidor.
  return enFila(() => construirPaquete(tenant, db, opciones));
}

async function construirPaquete(tenant, db, { alProgresar = () => {}, conFacturas = true } = {}) {
  try {
    const entradas = [];
    const cuentaEsperada = {};
    const cuentaEscrita = {};

    const tablas = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(r => r.name);

    alProgresar(`${tablas.length} tablas`);
    for (const t of tablas) {
      const enLaBase = db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
      if (TABLAS_FUERA[t]) { cuentaEsperada[t] = { fuera: true, motivo: TABLAS_FUERA[t], filas: enLaBase }; continue; }
      cuentaEsperada[t] = { fuera: false, filas: enLaBase };
      const { csv, filas } = tablaACsv(db, t);
      cuentaEscrita[t] = filas;
      entradas.push({ nombre: `${areaDe(t)}/${t}.csv`, contenido: csv });
    }

    // ── Las facturas, en PDF, por el mismo camino que el botón del producto ──────────────────────
    let pdfs = 0, pdfsFallidos = [];
    if (conFacturas) {
      let facturas = [];
      try { facturas = db.prepare('SELECT * FROM invoices ORDER BY id').all(); } catch { facturas = []; }
      alProgresar(`${facturas.length} facturas a PDF, de ${PDFS_A_LA_VEZ} en ${PDFS_A_LA_VEZ}`);
      const unaFactura = async (inv) => {
        try {
          const paper = await buildInvoicePaper(db, inv);
          const pdf = await renderPdfFromHtml(printableShell(paper, { title: 'Factura ' + inv.invoice_number }));
          const nombre = ('Factura-' + (inv.invoice_number || inv.id) + '.pdf').replace(/[\/\\]/g, '-');
          entradas.push({ nombre: `Facturas en PDF/${nombre}`, contenido: pdf });
          pdfs += 1;
          if (pdfs % 50 === 0) alProgresar(`  ${pdfs}/${facturas.length} PDF`);
        } catch (e) {
          // Un PDF que falla NO tumba la descarga entera — pero **se nombra**, en el LEEME y en el
          // manifiesto. La factura sigue estando en el CSV: no se pierde el dato, se pierde su hoja.
          pdfsFallidos.push({ factura: inv.invoice_number || inv.id, motivo: e.message });
        }
      };
      for (let i = 0; i < facturas.length; i += PDFS_A_LA_VEZ) {
        await Promise.all(facturas.slice(i, i + PDFS_A_LA_VEZ).map(unaFactura));
      }
    }

    // ── El LEEME, que es lo que abre una persona primero ─────────────────────────────────────────
    const hoy = new Date().toISOString().slice(0, 10);
    const totalFilas = Object.values(cuentaEscrita).reduce((a, b) => a + b, 0);
    entradas.push({ nombre: 'LEEME.txt', contenido: [
      `TUS DATOS DE BAMBURU — ${tenant.name}`,
      `Generado el ${hoy}`,
      ``,
      `QUÉ HAY AQUÍ DENTRO`,
      `  · Una carpeta por área (Clientes, Facturas y ventas, Catálogo…), y dentro un fichero .csv`,
      `    por cada tabla de tus datos. En total ${Object.keys(cuentaEscrita).length} ficheros y`,
      `    ${totalFilas} filas.`,
      `  · «Facturas en PDF»: ${pdfs} facturas, tal y como las descargas desde Bamburu.`,
      `  · «manifiesto.csv»: el recuento de cada fichero, para que puedas comprobarlo tú.`,
      ``,
      `CÓMO SE ABREN LOS .CSV`,
      `  Con doble clic se abren en Excel, en Numbers o en LibreOffice. Están guardados para que los`,
      `  acentos y las eñes salgan bien y las columnas se separen solas.`,
      ``,
      `LO QUE NO ESTÁ AQUÍ, Y POR QUÉ`,
      ...Object.entries(TABLAS_FUERA).map(([t, m]) => `  · ${t}: ${m}.`),
      ...Object.entries(COLUMNAS_FUERA).flatMap(([t, cols]) =>
        Object.entries(cols).map(([c, m]) => `  · ${t}, columna «${c}»: ${m}.`)),
      `  Son claves de acceso, no datos de tu negocio. Todo lo demás está.`,
      ...(pdfsFallidos.length ? [``, `FACTURAS SIN PDF (${pdfsFallidos.length}) — sus datos SÍ están en el CSV:`,
        ...pdfsFallidos.slice(0, 20).map(f => `  · ${f.factura}: ${f.motivo}`)] : []),
      ``,
      `TUS DATOS SIGUEN EN BAMBURU. Esta copia no los quita de ningún sitio.`,
    ].join('\n') });

    entradas.push({ nombre: 'manifiesto.csv', contenido: '﻿' + [
      'tabla;filas_en_bamburu;filas_en_esta_copia;incluida;motivo_si_no',
      ...Object.entries(cuentaEsperada).map(([t, v]) => v.fuera
        ? `${t};${v.filas};0;no;${v.motivo}`
        : `${t};${v.filas};${cuentaEscrita[t]};sí;`),
    ].join('\r\n') + '\r\n' });

    // ── LA COMPROBACIÓN: que lo empaquetado sea lo que hay ───────────────────────────────────────
    const descuadres = Object.entries(cuentaEsperada)
      .filter(([t, v]) => !v.fuera && cuentaEscrita[t] !== v.filas)
      .map(([t, v]) => `${t}: la base tiene ${v.filas} y se han escrito ${cuentaEscrita[t]}`);
    if (descuadres.length) {
      return { ok: false, error: `El paquete no cuadra con la base y NO se entrega:\n  ${descuadres.join('\n  ')}` };
    }

    alProgresar('comprimiendo');
    const zip = crearZip(entradas);

    // Y que el ZIP se pueda ABRIR de verdad: se relee entero y se comprueba el CRC de cada fichero.
    // Escribir bytes y dar por hecho que forman un ZIP válido es justo la clase de verde que miente.
    const v = verificarZip(zip);
    if (!v.ok) return { ok: false, error: `El paquete no se puede abrir y NO se entrega: ${v.error}` };
    if (v.entradas !== entradas.length) {
      return { ok: false, error: `El paquete dice tener ${v.entradas} ficheros y se metieron ${entradas.length}.` };
    }

    mkdirSync(DIRECTORIO, { recursive: true, mode: 0o700 });
    const ruta = path.join(DIRECTORIO, `bamburu-${tenant.slug}-${hoy}.zip`);
    writeFileSync(ruta, zip, { mode: 0o600 });

    return { ok: true, ruta, bytes: statSync(ruta).size, error: null,
             resumen: { tablas: Object.keys(cuentaEscrita).length, filas: totalFilas, pdfs,
                        pdfs_fallidos: pdfsFallidos.length, ficheros: entradas.length } };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
