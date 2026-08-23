// ════════════════════════════════════════════════════════════════════════════════════════════════
// IMPORTADOR DE CSV — EL MOTOR (ficha H · H1 y H2)
//
// COMPLEMENTA LA MIGRACIÓN ASISTIDA, NO LA SUSTITUYE (H3). La asistida sigue exactamente donde
// estaba (`/admin/migracion`), con su formulario, su correo al equipo y su tabla: sigue siendo la
// vía por defecto y la ÚNICA para facturas. Esto es el atajo para quien prefiere hacerlo él y solo
// trae clientes o productos.
//
// LAS DOS PROMESAS QUE DEFINEN ESTE FICHERO:
//
//   1. LOS FALLOS SE VEN ANTES, NO DESPUÉS. Analizar NO escribe nada: parsea, mapea, normaliza y
//      valida CADA fila con EL MISMO esquema y LAS MISMAS guardas que usa el formulario de verdad
//      (`clientSchema`/`productSchema`, `fiscalIdConflict`, las bandas de IVA de `core/vat-bands`).
//      Si la pantalla dice que la fila 3 falla, es porque el validador real la ha rechazado ya —
//      no porque aquí se haya escrito una segunda copia de las reglas que mañana se desincroniza.
//
//   2. O ENTRA TODO O NO ENTRA NADA. `importar()` vuelve a analizar desde el fichero (nunca se fía
//      del veredicto que trae el navegador) y mete las filas buenas dentro de UNA transacción. Si
//      algo revienta a mitad, better-sqlite3 deshace la transacción entera: no quedan medias
//      fichas, ni medio lote, ni medio contador de códigos internos gastado.
//
// UNA SOLA PASADA DE VALIDACIÓN, Y ESTO IMPORTA: `pasada()` es la única que sabe leer una fila, y
// la usan TANTO la vista previa COMO la escritura. La vista previa recorta lo que PINTA, nunca lo
// que valida. Que el que enseña y el que escribe compartan función es lo que hace que la promesa 1
// sea cierta y no una coincidencia.
//
// LO QUE NO HACE, Y ES A PROPÓSITO: **facturas**. Ver la nota larga al final del fichero.
//
// ESCRITURA: pasa por `createClientSvc` / `createProductSvc`, que son los servicios compartidos
// (patrón T5). Aquí NO hay un INSERT propio de cliente ni de producto. Un importador que escribe
// por su cuenta es un segundo camino de alta que se salta las guardas del primero.
import { clientSchema, productSchema } from './schemas.js';
import { createClientSvc, fiscalIdConflict } from './routes/clients.js';
import { createProductSvc } from './routes/products.js';
import { getVatBands } from '../../core/vat-bands.js';

// Topes. El fichero entero viaja en memoria y las filas se validan una a una contra la BD, así que
// el tope no es decorativo. Un CSV de 2000 clientes son ~200 KB: quien traiga más, lo parte en dos.
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_FILAS = 2000;
// Cuántas filas se DEVUELVEN para pintar. Se validan TODAS (el resumen cuenta todas); lo que se
// recorta es lo que viaja al navegador, y las que fallan tienen prioridad absoluta: son las que hay
// que ver. El recorte se dice en pantalla, nunca se calla — una lista recortada en silencio se lee
// como "no hay más", que es la mentira más barata de cometer.
export const MAX_FILAS_VISTA = 300;

export const TIPOS = {
  clientes:  { label: 'Clientes',              perm: 'clients.create',  entidad: 'client'  },
  productos: { label: 'Productos y servicios', perm: 'products.create', entidad: 'product' },
};

// ── NORMALIZACIÓN DE TEXTO PARA COMPARAR ────────────────────────────────────────────────────────
// Minúsculas, sin acentos, sin puntuación. 'C.P.' y 'Código Postal' tienen que poder compararse con
// lo mismo, o el automapeo no acierta ni una en un fichero español.
const norm = s => String(s == null ? '' : s)
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Valores que significan "vacío" en una exportación real. Un guion en la columna de email no es un
// email: es la forma que tiene una hoja de cálculo de decir que ahí no hay nada.
const VACIOS = new Set(['', '-', '--', 'n a', 'na', 'null', 'none', 'nulo', 'sin', 'ninguno']);
const limpio = v => {
  const s = String(v == null ? '' : v).trim();
  return VACIOS.has(norm(s)) ? '' : s;
};

// ── NÚMEROS DE UNA HOJA DE CÁLCULO ESPAÑOLA ─────────────────────────────────────────────────────
// "1.234,56 €" → 1234.56 · "1234.56" → 1234.56 · "1,50" → 1.5 · "(12,30)" → -12.3
// LA REGLA AMBIGUA, DICHA EN VOZ ALTA: si SOLO hay una coma, se lee como separador DECIMAL, que es
// lo español. Así "1,234" son 1,234 y no mil doscientos treinta y cuatro. Por eso la vista previa
// enseña el número YA INTERPRETADO y no el texto del fichero: si la lectura no es la que el dueño
// esperaba, la ve antes de confirmar en vez de descubrirla dentro de una factura.
export function aNumero(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return null;
  s = s.replace(/[€$£%\s\u00a0]/g, '');
  if (!s) return null;
  const negParen = /^\(.*\)$/.test(s);
  if (negParen) s = s.slice(1, -1);
  const punto = s.lastIndexOf('.'), coma = s.lastIndexOf(',');
  if (punto >= 0 && coma >= 0) {
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0) {
    s = (s.split(',').length - 1) > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negParen ? -n : n;
}

// ── LISTAS CERRADAS: del castellano de la hoja al valor del esquema ─────────────────────────────
// Si el valor no está en la tabla NO se adivina y NO se cae a un defecto silencioso: la fila da
// error diciendo qué se aceptaba. Un defecto silencioso aquí convierte a una empresa en particular
// sin que se entere nadie, y eso sale luego en el IRPF de una factura.
const mapa = obj => { const m = new Map(); for (const k of Object.keys(obj)) m.set(norm(k), obj[k]); return m; };

const TIPO_CLIENTE = mapa({
  particular: 'particular', particulares: 'particular', persona: 'particular', 'persona fisica': 'particular',
  individual: 'particular', autonomo: 'particular', consumidor: 'particular', b2c: 'particular',
  empresa: 'empresa', empresas: 'empresa', company: 'empresa', sociedad: 'empresa',
  'persona juridica': 'empresa', juridica: 'empresa', business: 'empresa', b2b: 'empresa',
});
const FORMA_PAGO = mapa({
  transferencia: 'transferencia', transfer: 'transferencia', 'bank transfer': 'transferencia', banco: 'transferencia',
  efectivo: 'efectivo', cash: 'efectivo', metalico: 'efectivo', contado: 'efectivo',
  tarjeta: 'tarjeta', card: 'tarjeta', 'credit card': 'tarjeta', visa: 'tarjeta',
  domiciliacion: 'domiciliacion', domiciliado: 'domiciliacion', recibo: 'domiciliacion',
  sepa: 'domiciliacion', 'direct debit': 'domiciliacion',
});
const TIPO_PRODUCTO = mapa({
  physical: 'physical', fisico: 'physical', producto: 'physical', productos: 'physical', bien: 'physical',
  articulo: 'physical', material: 'physical', product: 'physical', goods: 'physical', almacenable: 'physical',
  service: 'service', servicio: 'service', servicios: 'service', 'mano de obra': 'service', hora: 'service', horas: 'service',
  digital: 'digital', descargable: 'digital', download: 'digital', 'archivo digital': 'digital',
});
const ESTADO_PRODUCTO = mapa({
  active: 'active', activo: 'active', activa: 'active', publicado: 'active', visible: 'active',
  si: 'active', s: 'active', 1: 'active', true: 'active', alta: 'active',
  draft: 'draft', borrador: 'draft', oculto: 'draft', no: 'draft', n: 'draft', 0: 'draft', false: 'draft',
  archived: 'archived', archivado: 'archived', archivada: 'archived', inactivo: 'archived',
  baja: 'archived', descatalogado: 'archived',
});

// ── QUÉ CAMPOS SE PUEDEN TRAER, Y CON QUÉ NOMBRES LOS LLAMA CADA PROGRAMA ────────────────────────
// `alias` es SOLO para acertar el automapeo. El dueño puede corregir cualquier columna a mano en la
// vista previa, así que un alias que falte es una molestia, nunca un muro.
export const CAMPOS = {
  clientes: [
    { key: 'name', label: 'Nombre', obligatorio: true, ayuda: 'Nombre o razón social',
      alias: ['nombre', 'cliente', 'razon social', 'nombre fiscal', 'nombre completo', 'denominacion', 'name', 'customer', 'client', 'contacto'] },
    { key: 'fiscal_id', label: 'NIF / CIF', ayuda: 'Sin duplicados: si ya existe un cliente con ese NIF, la fila falla',
      alias: ['nif', 'cif', 'dni', 'nif cif', 'documento', 'identificacion fiscal', 'tax id', 'vat', 'vat number'] },
    { key: 'email', label: 'Email',
      alias: ['email', 'correo', 'e mail', 'mail', 'correo electronico', 'email 1'] },
    { key: 'phone', label: 'Teléfono',
      alias: ['telefono', 'tel', 'tlf', 'movil', 'phone', 'mobile', 'telefono 1'] },
    { key: 'address', label: 'Dirección',
      alias: ['direccion', 'domicilio', 'calle', 'address', 'address 1', 'via'] },
    { key: 'postal_code', label: 'Código postal',
      alias: ['cp', 'c p', 'codigo postal', 'zip', 'zip code', 'postcode', 'postal code'] },
    { key: 'city', label: 'Ciudad',
      alias: ['ciudad', 'localidad', 'poblacion', 'municipio', 'city', 'town'] },
    { key: 'province', label: 'Provincia',
      alias: ['provincia', 'province', 'state', 'region'] },
    { key: 'country', label: 'País',
      alias: ['pais', 'country', 'nacion'] },
    { key: 'client_type', label: 'Tipo', ayuda: 'particular o empresa (si no viene, particular)',
      alias: ['tipo', 'tipo de cliente', 'tipo cliente', 'client type', 'customer type'] },
    { key: 'payment_term_days', label: 'Días de pago', ayuda: 'Número de días de vencimiento',
      alias: ['dias de pago', 'vencimiento', 'plazo', 'plazo de pago', 'dias vencimiento', 'payment terms', 'terms'] },
    { key: 'payment_method', label: 'Forma de pago', ayuda: 'transferencia, efectivo, tarjeta o domiciliación',
      alias: ['forma de pago', 'metodo de pago', 'payment method'] },
    { key: 'notes', label: 'Notas',
      alias: ['notas', 'observaciones', 'comentarios', 'notes', 'nota', 'comment'] },
  ],
  productos: [
    { key: 'name', label: 'Nombre', obligatorio: true,
      alias: ['nombre', 'producto', 'articulo', 'concepto', 'titulo', 'name', 'title', 'item'] },
    { key: 'sku', label: 'Referencia (SKU)', obligatorio: true, ayuda: 'Bamburu la exige, igual que el formulario de producto',
      alias: ['sku', 'referencia', 'ref', 'codigo', 'codigo articulo', 'code', 'reference', 'item code', 'barcode', 'ean'] },
    { key: 'price', label: 'Precio', obligatorio: true, ayuda: 'Sin IVA. Se admite 1.234,56 y 1234.56',
      alias: ['precio', 'pvp', 'precio venta', 'precio unitario', 'precio de venta', 'importe', 'price', 'unit price', 'sale price'] },
    { key: 'tax_band', label: 'IVA', obligatorio: true, ayuda: 'El % (21, 10, 4, 0) o el nombre de la banda',
      alias: ['iva', 'tipo iva', 'porcentaje iva', 'impuesto', 'tax', 'vat', 'tax rate', 'banda iva'] },
    { key: 'type', label: 'Tipo', ayuda: 'producto, servicio o digital (si no viene, producto)',
      alias: ['tipo', 'tipo de producto', 'clase', 'type', 'product type'] },
    { key: 'description', label: 'Descripción',
      alias: ['descripcion', 'description', 'detalle', 'observaciones'] },
    { key: 'stock', label: 'Stock inicial', ayuda: 'Solo para productos físicos. Entero',
      alias: ['stock', 'existencias', 'cantidad', 'unidades', 'qty', 'quantity', 'inventario'] },
    { key: 'compare_price', label: 'Precio anterior',
      alias: ['precio anterior', 'pvp anterior', 'precio comparacion', 'compare price', 'precio tachado'] },
    { key: 'status', label: 'Estado', ayuda: 'activo, borrador o archivado (si no viene, activo)',
      alias: ['estado', 'status', 'activo', 'publicado', 'situacion'] },
  ],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL LECTOR DE CSV
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Comillas con "" dentro, separadores y saltos de línea DENTRO de un campo entrecomillado, BOM de
// Excel, CRLF y CR sueltos. Un `split(',')` se come vivo al primer cliente que se llame
// "Martínez, S.L." — y eso no sale al probar, sale en producción.

// Cuenta apariciones de `sep` FUERA de comillas. Sirve para adivinar el separador mirando solo la
// cabecera; contar por dentro haría ganar a la coma en cuanto una dirección lleve una.
function contarFuera(linea, sep) {
  let n = 0, dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') { if (dentro && linea[i + 1] === '"') i++; else dentro = !dentro; continue; }
    if (!dentro && ch === sep) n++;
  }
  return n;
}

// Primera línea REAL: la cabecera puede llevar un salto de línea dentro de un campo entrecomillado.
function primeraLinea(t) {
  let dentro = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '"') { if (dentro && t[i + 1] === '"') i++; else dentro = !dentro; continue; }
    if (!dentro && ch === '\n') return t.slice(0, i);
  }
  return t;
}

// Español → punto y coma (es lo que escribe Excel con configuración regional española). Por eso el
// desempate cae en ';' y no en ','.
export const SEPARADORES = [';', ',', '\t', '|'];
export function detectarSeparador(texto) {
  const cab = primeraLinea(texto);
  let mejor = ';', max = 0;
  for (const s of SEPARADORES) {
    const n = contarFuera(cab, s);
    if (n > max) { max = n; mejor = s; }
  }
  return mejor;
}

export function parseCSV(texto, sepForzado = null) {
  let t = String(texto == null ? '' : texto);
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);          // BOM de Excel
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sep = sepForzado || detectarSeparador(t);

  const filas = [];
  let campo = '', fila = [], dentro = false, empezado = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (dentro) {
      if (ch === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else dentro = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"' && !empezado) { dentro = true; empezado = true; continue; }
    if (ch === sep)  { fila.push(campo); campo = ''; empezado = false; continue; }
    if (ch === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; empezado = false; continue; }
    campo += ch; empezado = true;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }

  // Fuera las filas totalmente en blanco (Excel deja una al final casi siempre).
  const utiles = filas.filter(f => f.some(v => String(v).trim() !== ''));
  if (!utiles.length) return { sep, headers: [], filas: [] };
  return { sep, headers: utiles[0].map(h => String(h).trim()), filas: utiles.slice(1) };
}

// ── AUTOMAPEO ───────────────────────────────────────────────────────────────────────────────────
// Dos pasadas. La primera exige coincidencia EXACTA (normalizada); la segunda admite que la
// cabecera CONTENGA el alias, y solo para los campos que se quedaron sin nada. El orden importa:
// sin la primera pasada, "Precio" se lo llevaría "Precio anterior" en un fichero que traiga las dos.
export function automapear(headers, tipo) {
  const campos = CAMPOS[tipo] || [];
  const hs = headers.map(norm);
  const usadas = new Set();
  const mapeo = {};
  for (const c of campos) mapeo[c.key] = null;

  for (const c of campos) {
    const claves = [norm(c.key), norm(c.label), ...(c.alias || []).map(norm)];
    const i = hs.findIndex((h, idx) => h && !usadas.has(idx) && claves.includes(h));
    if (i >= 0) { mapeo[c.key] = i; usadas.add(i); }
  }
  for (const c of campos) {
    if (mapeo[c.key] != null) continue;
    const claves = [norm(c.key), norm(c.label), ...(c.alias || []).map(norm)].filter(x => x.length >= 3);
    const i = hs.findIndex((h, idx) => h && !usadas.has(idx) && claves.some(k => h.includes(k)));
    if (i >= 0) { mapeo[c.key] = i; usadas.add(i); }
  }
  return mapeo;
}

// Deja el mapeo que llega del navegador en forma canónica: solo claves conocidas, solo índices que
// existen de verdad en el fichero, y sin dos campos comiendo de la misma columna. Nunca se confía
// en la forma del objeto que manda un cliente.
export function saneaMapeo(tipo, headers, propuesto) {
  const campos = CAMPOS[tipo] || [];
  const out = {};
  const usadas = new Set();
  for (const c of campos) {
    const v = propuesto ? propuesto[c.key] : undefined;
    const i = (v === null || v === undefined || v === '') ? null : Number(v);
    if (i == null || !Number.isInteger(i) || i < 0 || i >= headers.length || usadas.has(i)) { out[c.key] = null; continue; }
    out[c.key] = i; usadas.add(i);
  }
  return out;
}

// ── TRADUCCIÓN DE LOS ERRORES DE ZOD ────────────────────────────────────────────────────────────
// Zod habla en inglés y de sí mismo ("String must contain at least 1 character(s)"). Quien lee esta
// pantalla es el dueño del negocio con su fichero delante: tiene que leer QUÉ columna y QUÉ pasa.
// La regla la sigue poniendo el esquema; aquí solo se traduce su veredicto, no se decide nada.
function mensajeZod(issue, campos) {
  const key = issue.path && issue.path.length ? String(issue.path[0]) : '';
  const c = campos.find(x => x.key === key);
  const etiqueta = c ? c.label : (key || 'Dato');
  if (issue.code === 'too_small')  return etiqueta + ': falta (es obligatorio)';
  if (issue.code === 'too_big')    return etiqueta + ': demasiado largo';
  if (issue.code === 'invalid_string' && issue.validation === 'email') return etiqueta + ': no es un email válido';
  if (issue.code === 'invalid_enum_value') return etiqueta + ': valor no reconocido';
  if (issue.code === 'invalid_type') return etiqueta + ': valor no válido';
  return etiqueta + ': ' + issue.message;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LEER UNA FILA
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Devuelve { datos, errores, avisos, mal }. `datos` es lo que se le pasa al servicio de alta TAL
// CUAL, y es también lo que se pinta: si la pantalla enseña 1234.56, es exactamente el número que
// se va a guardar. `mal` son las claves de campo que ya tienen error propio, para que el mensaje
// bueno gane al genérico de Zod cuando los dos hablan de lo mismo.
function celda(fila, idx) { return idx == null ? '' : limpio(fila[idx]); }

function leerCliente(cruda, mapeo) {
  const errores = [], avisos = [], mal = new Set();
  const g = k => celda(cruda, mapeo[k]);
  const datos = {
    name: g('name'), fiscal_id: g('fiscal_id').toUpperCase(), email: g('email').toLowerCase(),
    phone: g('phone'), address: g('address'), postal_code: g('postal_code'),
    city: g('city'), province: g('province'), country: g('country'), notes: g('notes'),
    client_type: 'particular', payment_term_days: 0, payment_method: '',
  };

  const tc = g('client_type');
  if (tc) {
    const v = TIPO_CLIENTE.get(norm(tc));
    if (v) datos.client_type = v;
    else { errores.push('Tipo: no se entiende «' + tc + '» (se admite particular o empresa)'); mal.add('client_type'); }
  }

  const fp = g('payment_method');
  if (fp) {
    const v = FORMA_PAGO.get(norm(fp));
    if (v) datos.payment_method = v;
    else { errores.push('Forma de pago: no se entiende «' + fp + '» (transferencia, efectivo, tarjeta o domiciliación)'); mal.add('payment_method'); }
  }

  const dp = g('payment_term_days');
  if (dp) {
    const n = aNumero(dp);
    if (n == null || Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
      errores.push('Días de pago: «' + dp + '» no es un número entero de días'); mal.add('payment_term_days');
    } else datos.payment_term_days = n;
  }

  return { datos, errores, avisos, mal };
}

function leerProducto(cruda, mapeo, ctx) {
  const errores = [], avisos = [], mal = new Set();
  const g = k => celda(cruda, mapeo[k]);
  const datos = {
    name: g('name'), sku: g('sku'), description: g('description'),
    price: 0, compare_price: null, tax_band: '', type: 'physical', status: 'active', stock: 0,
  };

  const pr = g('price');
  if (!pr) { errores.push('Precio: falta (es obligatorio)'); mal.add('price'); }
  else {
    const n = aNumero(pr);
    if (n == null || Number.isNaN(n)) { errores.push('Precio: «' + pr + '» no es un número'); mal.add('price'); }
    else if (n < 0) { errores.push('Precio: no puede ser negativo'); mal.add('price'); }
    else datos.price = n;
  }

  const cp = g('compare_price');
  if (cp) {
    const n = aNumero(cp);
    if (n == null || Number.isNaN(n) || n < 0) { errores.push('Precio anterior: «' + cp + '» no es un número válido'); mal.add('compare_price'); }
    else datos.compare_price = n;
  }

  // IVA. Se admite el % (21, 10, 4, 0) o el nombre de la banda. Si la columna no viene, entra la
  // banda que el dueño haya ELEGIDO para toda la importación en la pantalla — elegir NO es un
  // defecto silencioso: se ve, se cambia y se confirma antes de que entre nada. Sin elección y sin
  // columna, la fila falla: la banda es obligatoria en el formulario y aquí no se ablanda.
  const iva = g('tax_band');
  if (iva) {
    const porNombre = ctx.bandas.find(b => norm(b.code) === norm(iva) || norm(b.label) === norm(iva));
    if (porNombre) datos.tax_band = porNombre.code;
    else {
      const n = aNumero(iva);
      const porTipo = (n != null && !Number.isNaN(n)) ? ctx.bandas.find(b => Number(b.rate) === n) : null;
      if (porTipo) datos.tax_band = porTipo.code;
      else {
        errores.push('IVA: «' + iva + '» no es una banda de tu país (' + ctx.bandas.map(b => b.rate + '%').join(', ') + ')');
        mal.add('tax_band');
      }
    }
  } else if (ctx.bandaDefecto) {
    datos.tax_band = ctx.bandaDefecto;
  } else {
    errores.push('IVA: falta. Mapea la columna del IVA, o elige arriba la banda para todo el fichero');
    mal.add('tax_band');
  }

  const tp = g('type');
  if (tp) {
    const v = TIPO_PRODUCTO.get(norm(tp));
    if (v) datos.type = v;
    else { errores.push('Tipo: no se entiende «' + tp + '» (producto, servicio o digital)'); mal.add('type'); }
  }

  const st = g('status');
  if (st) {
    const v = ESTADO_PRODUCTO.get(norm(st));
    if (v) datos.status = v;
    else { errores.push('Estado: no se entiende «' + st + '» (activo, borrador o archivado)'); mal.add('status'); }
  }

  const sk = g('stock');
  if (sk) {
    const n = aNumero(sk);
    if (n == null || Number.isNaN(n) || !Number.isInteger(n) || n < 0) {
      errores.push('Stock: «' + sk + '» no es un número entero de unidades'); mal.add('stock');
    } else datos.stock = n;
  }
  // Sin ruido: el stock inicial de un servicio o un digital lo ignora `createProductSvc`, así que se
  // AVISA en vez de rechazar. La fila entra; lo que no entra es el stock, y se dice.
  if (datos.stock > 0 && datos.type !== 'physical') {
    avisos.push('El stock inicial se ignora: solo los productos físicos lo llevan');
  }

  return { datos, errores, avisos, mal };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA PASADA — ÚNICA. La usan la vista previa Y la escritura, sin recorte ninguno.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function pasada(db, { tipo, texto, mapeo: mapeoPedido = null, bandaDefecto = '' }) {
  if (!TIPOS[tipo]) { const e = new Error('Tipo de importación desconocido'); e.status = 400; throw e; }
  const campos = CAMPOS[tipo];

  const { sep, headers, filas } = parseCSV(texto);
  if (!headers.length) { const e = new Error('El fichero no tiene ninguna columna. ¿Seguro que es un CSV?'); e.status = 400; throw e; }
  if (!filas.length)   { const e = new Error('El fichero solo tiene la fila de cabeceras: no hay datos que importar.'); e.status = 400; throw e; }
  if (filas.length > MAX_FILAS) {
    const e = new Error('El fichero trae ' + filas.length + ' filas y el máximo son ' + MAX_FILAS + '. Pártelo en varios ficheros.');
    e.status = 400; throw e;
  }

  const mapeo = mapeoPedido ? saneaMapeo(tipo, headers, mapeoPedido) : automapear(headers, tipo);

  const cfg = db.prepare('SELECT country, tax_rate FROM company_config WHERE id=1').get() || {};
  const bandas = getVatBands((cfg.country || 'ES').toUpperCase(), cfg.tax_rate != null ? cfg.tax_rate : 21);
  const bandaOk = bandas.find(b => b.code === bandaDefecto) ? bandaDefecto : '';
  const ctx = { bandas, bandaDefecto: bandaOk };

  const esquema = tipo === 'clientes' ? clientSchema : productSchema;
  const leer    = tipo === 'clientes' ? leerCliente : leerProducto;

  // Duplicados DENTRO del propio fichero. El choque contra la BD lo canta `fiscalIdConflict`, pero
  // dos filas con el mismo NIF en el mismo CSV no chocan con nada hasta que la primera ya ha
  // entrado — y entonces revienta a mitad. Se caza aquí, antes de tocar la base.
  const nifsVistos = new Map(), skusVistos = new Map();
  const analizadas = [];

  filas.forEach((cruda, i) => {
    const n = i + 2;                       // +2: la fila 1 es la cabecera, y las hojas cuentan desde 1
    const { datos, errores, avisos, mal } = leer(cruda, mapeo, ctx);

    // EL VALIDADOR DE VERDAD, el mismo del formulario. Solo aporta lo que no se haya dicho ya mejor.
    const res = esquema.safeParse(datos);
    if (!res.success) {
      for (const issue of res.error.issues) {
        const key = issue.path && issue.path.length ? String(issue.path[0]) : '';
        if (mal.has(key)) continue;
        const m = mensajeZod(issue, campos);
        if (!errores.includes(m)) errores.push(m);
      }
    }

    if (tipo === 'clientes' && datos.fiscal_id) {
      const clave = datos.fiscal_id.toUpperCase();
      const antes = nifsVistos.get(clave);
      if (antes) errores.push('NIF ' + clave + ': repetido en este fichero (ya sale en la fila ' + antes + ')');
      else {
        nifsVistos.set(clave, n);
        const choque = fiscalIdConflict(db, clave);
        if (choque) errores.push('NIF ' + clave + ': ya lo tiene «' + choque.name + '», que ya está en Bamburu');
      }
    }
    if (tipo === 'productos' && datos.sku) {
      const clave = datos.sku.toUpperCase();
      const antes = skusVistos.get(clave);
      if (antes) avisos.push('La referencia ' + datos.sku + ' se repite (fila ' + antes + '): entrarán como dos productos distintos');
      else {
        skusVistos.set(clave, n);
        const ya = db.prepare("SELECT name FROM products WHERE UPPER(TRIM(sku))=? AND status<>'archived' LIMIT 1").get(clave);
        if (ya) avisos.push('Ya hay un producto con la referencia ' + datos.sku + ' («' + ya.name + '»): este entraría aparte');
      }
    }

    analizadas.push({ n, datos, errores, avisos });
  });

  return { tipo, sep, headers, mapeo, bandas, bandaDefecto: bandaOk, campos, analizadas };
}

// ── ANALIZAR — LA VISTA PREVIA. NO ESCRIBE NADA. ────────────────────────────────────────────────
export function analizar(db, args) {
  const p = pasada(db, args || {});
  const buenas = p.analizadas.filter(f => !f.errores.length).length;
  const malas  = p.analizadas.length - buenas;

  // El recorte para pintar: primero TODAS las que fallan, luego las buenas hasta llenar el hueco.
  let vista = p.analizadas;
  if (p.analizadas.length > MAX_FILAS_VISTA) {
    const conError = p.analizadas.filter(f => f.errores.length).slice(0, MAX_FILAS_VISTA);
    const resto = p.analizadas.filter(f => !f.errores.length).slice(0, Math.max(0, MAX_FILAS_VISTA - conError.length));
    vista = conError.concat(resto).sort((a, b) => a.n - b.n);
  }

  const usadas = new Set(Object.values(p.mapeo).filter(v => v != null));
  const columnasSinUsar = p.headers.map((h, i) => ({ h, i })).filter(x => !usadas.has(x.i) && x.h).map(x => x.h);

  return {
    tipo: p.tipo, sep: p.sep, headers: p.headers, mapeo: p.mapeo, bandaDefecto: p.bandaDefecto,
    bandas: p.bandas.map(b => ({ code: b.code, label: b.label, rate: b.rate })),
    campos: p.campos.map(c => ({ key: c.key, label: c.label, obligatorio: !!c.obligatorio, ayuda: c.ayuda || '' })),
    filas: vista,
    resumen: {
      total: p.analizadas.length, buenas, malas,
      mostradas: vista.length, recortada: vista.length < p.analizadas.length,
      columnasSinUsar,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// IMPORTAR — O ENTRA TODO O NO ENTRA NADA
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Vuelve a leer DESDE EL FICHERO. No se fía del veredicto del navegador ni de una lista de filas
// buenas que llegue por la red: entre la vista previa y el "confirmar" pueden haber pasado cosas
// —otro usuario dando de alta ese mismo NIF, por ejemplo— y el que manda es el estado de AHORA.
export function importar(db, { tipo, texto, mapeo = null, bandaDefecto = '', nombre = '', session = null } = {}) {
  const p = pasada(db, { tipo, texto, mapeo, bandaDefecto });
  const buenas = p.analizadas.filter(f => !f.errores.length);
  const malas  = p.analizadas.filter(f => f.errores.length);

  if (!buenas.length) {
    const e = new Error('Ninguna fila del fichero se puede importar. No ha entrado nada.');
    e.status = 400; throw e;
  }

  const crea = tipo === 'clientes' ? createClientSvc : createProductSvc;
  const entidad = TIPOS[tipo].entidad;

  const trabajo = db.transaction(() => {
    const lote = db.prepare(
      `INSERT INTO importaciones (tipo, fichero, filas_total, filas_creadas, filas_omitidas, user_id, user_name)
       VALUES (?,?,?,?,?,?,?)`
    ).run(tipo, String(nombre || '').slice(0, 200), p.analizadas.length, 0, malas.length,
          session && session.userId ? session.userId : null,
          session && session.userName ? String(session.userName).slice(0, 120) : '');
    const loteId = lote.lastInsertRowid;

    const insItem = db.prepare('INSERT INTO importacion_items (importacion_id, entidad, entidad_id) VALUES (?,?,?)');
    let creadas = 0;
    for (const f of buenas) {
      // Si esto lanza, la transacción entera se deshace: ni una ficha, ni el lote, ni el contador
      // de códigos internos. El "o todo o nada" del encargo no es una promesa de palabra: es la
      // transacción de SQLite, y se comprueba en el gate provocando un fallo a mitad a propósito.
      let r;
      try {
        r = crea(db, f.datos);
      } catch (err) {
        const e = new Error('Fila ' + f.n + ': ' + ((err && err.message) || 'no se pudo crear') +
                            '. NO HA ENTRADO NADA: la importación se ha deshecho entera.');
        e.status = (err && err.status === 409) ? 409 : 400;
        throw e;
      }
      insItem.run(loteId, entidad, r.id);
      creadas++;
    }
    db.prepare('UPDATE importaciones SET filas_creadas=? WHERE id=?').run(creadas, loteId);
    return { loteId, creadas };
  });

  const out = trabajo();
  return {
    lote_id: out.loteId, tipo, creadas: out.creadas,
    omitidas: malas.length, total: p.analizadas.length,
    filas_omitidas: malas.map(f => ({ n: f.n, errores: f.errores })),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DESHACER (H2) — ARCHIVA, NO BORRA
// ════════════════════════════════════════════════════════════════════════════════════════════════
// La regla permanente del proyecto es que nada se destruye. Deshacer una importación NO borra las
// fichas: las ARCHIVA, exactamente igual que el botón de archivar de cada pantalla (clientes
// `active=0`, productos `status='archived'`). La pantalla lo dice con esas palabras, porque
// «deshacer» suena a que desaparece, y no desaparece.
//
// LO QUE NO DESHACE, Y HAY QUE DECIRLO: si a un cliente importado ya le has facturado, la factura
// se queda —es un documento legal— y el cliente archivado sigue enlazado desde ella. Igual con el
// stock de apertura de un producto: su movimiento sigue en el kardex.
export function deshacer(db, loteId) {
  const lote = db.prepare('SELECT * FROM importaciones WHERE id=?').get(loteId);
  if (!lote) { const e = new Error('Esa importación no existe'); e.status = 404; throw e; }
  if (lote.deshecha_at) { const e = new Error('Esa importación ya estaba deshecha'); e.status = 409; throw e; }

  const items = db.prepare('SELECT entidad, entidad_id FROM importacion_items WHERE importacion_id=?').all(loteId);
  const trabajo = db.transaction(() => {
    let n = 0;
    for (const it of items) {
      if (it.entidad === 'client')  n += db.prepare('UPDATE clients  SET active=0          WHERE id=? AND active=1').run(it.entidad_id).changes;
      if (it.entidad === 'product') n += db.prepare("UPDATE products SET status='archived' WHERE id=? AND status<>'archived'").run(it.entidad_id).changes;
    }
    db.prepare("UPDATE importaciones SET deshecha_at=datetime('now') WHERE id=?").run(loteId);
    return n;
  });
  const archivadas = trabajo();
  return { id: Number(loteId), archivadas, total: items.length };
}

export function historial(db, limite = 20) {
  const lim = Math.min(Math.max(Number(limite) || 20, 1), 100);
  return db.prepare(
    `SELECT id, tipo, fichero, filas_total, filas_creadas, filas_omitidas, user_name, created_at, deshecha_at
       FROM importaciones ORDER BY id DESC LIMIT ?`).all(lim);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POR QUÉ AQUÍ NO HAY FACTURAS
// ════════════════════════════════════════════════════════════════════════════════════════════════
// La ficha H pedía clientes, productos Y facturas. Clientes y productos están. Las facturas NO, y
// no es que faltara tiempo: es que meterlas exigiría un CAMINO DE EMISIÓN NUEVO, y eso se para y se
// pregunta antes de construirlo.
//
// El único camino vivo de emisión es `createInvoice` (`routes/invoices.js`) — `generateInvoice`
// está retirado con un 410 — y hace SIEMPRE tres cosas que una factura importada no tolera:
//   1. Le asigna un correlativo NUEVO del año EN CURSO (`getNextSeq`), así que el número original
//      que traiga el fichero (una FAC-2024-0012 de Holded) se pierde — y el número es justo lo que
//      identifica a esa factura ante Hacienda y ante el cliente que la recibió.
//   2. Registra un ALTA en la cadena legal (`recordVerifactuAlta`) con la marca de tiempo de AHORA
//      (`genTimestampMadrid`). `verifactu.js:12` ya lo dice con todas las letras: las facturas
//      anteriores NO se registran retroactivamente, porque no tenemos su FechaHoraHusoGenRegistro
//      real y backdatearla falsearía la huella.
//   3. La encola para remitirla a la AEAT (`encolarSiProcede`): declararía por segunda vez facturas
//      que el programa anterior YA declaró.
//
// Saltarse cualquiera de los tres es abrir una segunda puerta de emisión al lado de la única que
// hay. Mientras eso no lo decida el dueño, las facturas siguen yendo por la migración asistida,
// donde las mira una persona.
