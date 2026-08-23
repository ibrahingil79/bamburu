// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL CUADRO DE MANDO DEL DÍA — la composición del Inicio. Tarea TRANSVERSAL (el puntero del 8 NO se mueve).
//
// QUÉ ES ESTO Y QUÉ NO ES. Esto NO es un motor: es un CAMARERO. No calcula ni una cifra; llama a los
// motores que ya existen, cada uno con su regla ya escrita y probada, y coloca lo que devuelven en
// secciones. Si una cifra no tiene motor, aquí sale `null` y la pantalla pinta «—». Nunca un 0.
//
// LA REGLA QUE MANDA: **ningún cálculo nuevo.** Cada número de abajo lleva al lado el motor del que
// sale, y ese motor es EXACTAMENTE el de la pantalla de origen:
//   · Ventas del mes ....... `ventasResumen`  (ventas-metrics) — el mismo del informe de ventas.
//   · Pendiente de cobro ... `openDebts`      (cobros)          — el mismo de la torre de Cobros.
//   · Margen ............... `margenResumen` → `margen()`       — EL MOTOR ÚNICO, con su base.
//   · Clientes nuevos ...... `clientesNuevosPorMes`             — el mismo del informe de clientes.
//   · Rankings ............. `margenPorProducto` · `ventasPorCliente`.
//   · Oportunidades ........ `pipelineByStage` (crm)            — el mismo del embudo.
//   · Hoy .................. `datosHoy` → `agendaData` + `ocupacionDia`.
//   · DISA decide .......... `detectar` → `narrar` → `priorizar` — el vigía, su voz y su orden.
//
// EL IVA, DICHO EN VOZ ALTA. El titular de «Ventas del mes» va SIN IVA (base), porque así lo decidió
// el dueño para los informes: el IVA es de Hacienda, no del negocio — y así cuadra al céntimo con el
// informe de ventas. La cifra CON IVA viaja al lado (`total`) para que las dos se puedan reconciliar
// de un vistazo, y porque el ÚNICO motor de serie diaria que existe (`ventasPorDia`) devuelve el
// total con IVA. Se etiqueta; no se disimula.
//
// PERMISOS POR LISTA BLANCA. Cada sección declara los permisos que EXIGE, todos. La composición
// (`cuadro`) solo calcula las secciones que este usuario puede ver: lo que no puede ver NO SE
// CALCULA, así que no puede viajar. Y forzar la ruta de una sección sin sus permisos da 403.
import { hoyLocal } from './avisos.js';
import { ventasResumen, ventasPorDia, margenResumen, margenPorProducto,
         ventasPorCliente, clientesNuevosPorMes, clientesNuevosPorTramo } from './ventas-metrics.js';
import { openDebts, deudaAFecha } from './cobros.js';
import { fechaEs } from './voz.js';   // 23/08/2026, no 2026-08-23: una fecha en una frase se dice, no se guarda
import { modoDeEmpresa, titularDe, MODOS } from './margen.js';
import { pipelineByStage } from './crm.js';
import { detectar } from './vigia.js';
import { priorizar } from './prioridad.js';
import { cruzar } from './constructor-analitica.js';
import { usaAgenda } from './vigia-agenda.js';
import { datosHoy } from './inicio-layout.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── EL SUELO DE LOS RANKINGS ────────────────────────────────────────────────────────────────────
// «Lo que menos vendes» y «lo que menos te deja» son afirmaciones fuertes, y sin suelo son mentira:
// un producto creado ayer y vendido una vez saldría SIEMPRE el último, y el dueño acabaría mirando
// una lista que solo dice «lo que acabas de dar de alta». Así que para entrar en el ranking hay que
// haber vendido un mínimo en el periodo — y la pantalla DICE cuál es ese mínimo, porque un filtro
// que no se ve es un filtro en el que no se puede confiar.
//
// Vive aquí, con nombre, para que cambiarlo sea leer una línea (mismo patrón que FACTOR_RITMO en
// ventas-metrics o CAIDA_MARGEN_PCT en el vigía).
export const SUELO_UNIDADES = 3;
export const SUELO_TEXTO = 'al menos ' + SUELO_UNIDADES + ' unidades vendidas en el periodo';

// ── EL PERIODO: el mes en curso y el MISMO tramo del mes anterior ───────────────────────────────
// Comparar el mes a medias contra el mes anterior ENTERO diría que siempre vas peor. Se compara el
// día 1..N contra el día 1..N del mes anterior; si ese día no existe allí (el 31 en un mes de 30),
// se recorta al último día de ese mes y el periodo lo dice.
const mesDe = iso => String(iso).slice(0, 7);
function mesAnterior(mes) {
  const [y, m] = String(mes).split('-').map(Number);
  const idx = y * 12 + (m - 1) - 1;
  return Math.floor(idx / 12) + '-' + String(idx % 12 + 1).padStart(2, '0');
}
function ultimoDiaDe(mes) {
  const [y, m] = String(mes).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);   // día 0 del mes siguiente = último de este
}
export function periodoDe(hoy) {
  const mes = mesDe(hoy);
  const mesAnt = mesAnterior(mes);
  const dia = String(hoy).slice(8, 10);
  const candidato = mesAnt + '-' + dia;
  const ultAnt = ultimoDiaDe(mesAnt);
  const finAnt = candidato <= ultAnt ? candidato : ultAnt;
  return {
    hoy, mes, ini: mes + '-01', fin: hoy,
    mesAnt, iniAnt: mesAnt + '-01', finAnt, ultAnt,
    recortado: candidato > ultAnt,        // el día equivalente no existía en el mes anterior
  };
}

// ── LA COMPARACIÓN ──────────────────────────────────────────────────────────────────────────────
// `dir` dice qué significa subir: en ventas subir es bueno; en deuda, malo. Sin cifra anterior no
// hay comparación (`hay:false` → la pantalla pinta «—»); con un anterior de CERO no hay porcentaje
// que dar (dividir entre 0), así que viaja el salto en absoluto y `pct:null`. Nunca un ∞ ni un 0
// disfrazado de dato.
export function comparar(actual, anterior, dir = 'sube_bien') {
  if (actual == null || anterior == null) return { hay: false, pct: null, delta: null, tono: 'neutro', anterior: anterior ?? null };
  const delta = r2(actual - anterior);
  const pct = anterior !== 0 ? r2((actual - anterior) / Math.abs(anterior) * 100) : null;
  const mejor = dir === 'sube_bien' ? delta > 0 : delta < 0;
  return { hay: true, anterior: r2(anterior), delta, pct, tono: delta === 0 ? 'neutro' : (mejor ? 'bien' : 'mal') };
}

// ── DÓNDE SE RESUELVE CADA DECISIÓN DEL VIGÍA ───────────────────────────────────────────────────
// El vigía dice QUÉ pasa y la voz dice QUÉ conviene hacer; faltaba DÓNDE se hace. No se declara una
// lista a mano de rutas —caducaría el día que alguien mueva una pantalla—: se propone un destino por
// área y se le pregunta a la aplicación si esa ruta existe (`rutaExiste`), con el vigía de respaldo.
// Es la misma defensa del panel de arranque: ni un botón a un 404.
function destinoDe(a, rutaExiste) {
  const cid = a.ref && a.ref.client_id;
  const cand = [];
  if (a.detector === 'deuda_vencida') cand.push({ href: '/admin/cobros', cta: 'Ir a Cobros' });
  else if (a.detector === 'pago_vence_pronto') cand.push({ href: '/admin/pagos', cta: 'Ir a Pagos' });
  else if (a.area === 'agenda') cand.push({ href: '/admin/citas' + (a.fecha ? '?fecha=' + a.fecha : ''), prueba: '/admin/citas', cta: 'Abrir la agenda' });
  else if (a.area === 'clientes' && cid) cand.push({ href: '/admin/clients/' + cid, prueba: '/admin/clients/:id{[0-9]+}', cta: 'Ver la ficha' });
  else if (a.area === 'clientes') cand.push({ href: '/admin/clients', cta: 'Ver clientes' });
  else if (a.area === 'ventas' || a.area === 'plan') cand.push({ href: '/admin/analytics', cta: 'Ver la analítica' });
  else if (a.area === 'compras') cand.push({ href: '/admin/pagos', cta: 'Ir a Pagos' });
  cand.push({ href: '/admin/vigia', cta: 'Verlo en el vigía' });
  for (const d of cand) if (rutaExiste(d.prueba || d.href.split('?')[0])) return { href: d.href, cta: d.cta };
  return { href: '/admin/vigia', cta: 'Verlo en el vigía' };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LAS SECCIONES — lista blanca. `perms` se exige ENTERA (todos, no cualquiera).
// `aplica` separa «no tienes permiso» de «esto aquí no aplica»: son dos motivos distintos de no
// verlo, y confundirlos hace que un negocio sin agenda parezca un negocio sin permisos.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const SECCIONES = {

  // ── HOY ───────────────────────────────────────────────────────────────────────────────────────
  // Cero cifra propia: `datosHoy` come de `agendaData` (la MISMA función que sirve la vista día) y
  // de `ocupacionDia` (de donde come el detector de huecos del vigía).
  hoy: {
    perms: ['citas.read'],
    aplica: db => { try { return usaAgenda(db); } catch { return false; } },
    datos: (db, { puede, per }) => datosHoy(db, { puede, fecha: per.hoy }),
  },

  // ── VENTAS DEL MES ────────────────────────────────────────────────────────────────────────────
  // Titular SIN IVA (base) — cuadra al céntimo con el informe de ventas. El total CON IVA viaja al
  // lado porque es lo que devuelve el único motor de serie diaria que existe, y las dos cifras
  // juntas se reconcilian solas.
  ventas: {
    perms: ['invoices.read'],
    datos: (db, ctx) => {
      const per = ctx.per;
      const v = ventasResumen(db, { from: per.ini, to: per.fin });
      const ant = ventasResumen(db, { from: per.iniAnt, to: per.finAnt });
      return {
        base: v.base, iva: v.iva, total: v.total, facturas: v.count,
        anterior: { base: ant.base, total: ant.total, facturas: ant.count },
        comparacion: comparar(v.base, ant.base, 'sube_bien'),
        // La minigráfica es la MISMA serie del gráfico grande (con IVA, que es lo que da el motor).
        chispa: serieDelMes(db, ctx).actual.map(p => p.total),
      };
    },
  },

  // ── PENDIENTE DE COBRO ────────────────────────────────────────────────────────────────────────
  // YA HAY COMPARACIÓN (23 ago 2026, punto 8). Aquí ponía «no existe motor que reconstruya la deuda
  // de una fecha pasada», y era verdad hasta que se construyó: `deudaAFecha` (cobros.js) suma lo
  // emitido hasta esa fecha menos lo COBRADO hasta esa fecha, con el mismo filtro de qué cuenta que
  // el resto del sistema. Control: al día de hoy da exactamente lo mismo que `openDebts`.
  // MENOS deuda es MEJOR, así que la comparación va con el tono invertido (`baja_bien`).
  // Y lo que el motor NO puede saber se DICE, no se disimula: el estado de una factura se lee como
  // está HOY, así que una anulada la semana pasada tampoco cuenta para el mes anterior. Cuando hay
  // alguna de esas, la cifra de comparación se marca como aproximada con su motivo.
  cobro: {
    perms: ['cobros.read'],
    datos: (db, { per }) => {
      const d = openDebts(db, per.hoy);
      const vencidas = (d.rows || []).filter(r => r.estado === 'vencida');
      const ant = deudaAFecha(db, per.finAnt);
      const cmp = comparar(d.total, ant.total, 'baja_bien');
      return {
        total: d.total, facturas: (d.rows || []).length,
        vencidas: vencidas.length,
        vencido: r2(vencidas.reduce((s, r) => s + (Number(r.pendiente) || 0), 0)),
        deudaAnterior: ant.total, fechaAnterior: ant.fecha,
        comparacion: { ...cmp, tono: cmp.hay ? cmp.tono : (vencidas.length ? 'mal' : 'neutro') },
        aproximada: !ant.exacta,
        porQueNoHayComparacion: ant.exacta ? null
          : 'La comparación es aproximada: ' + ant.avisadas + ' factura(s) anuladas o rectificadas se leen '
            + 'como están hoy, no como estaban el ' + fechaEs(ant.fecha) + '.',
        chispa: null,
      };
    },
  },

  // ── MARGEN ────────────────────────────────────────────────────────────────────────────────────
  // El MOTOR ÚNICO, y su base viaja SIEMPRE (`margen`, `desglose`): la pantalla no puede pintar el
  // porcentaje sin decir sobre qué se divide, porque aquí lleva el acompañamiento pegado.
  margen: {
    perms: ['analytics.read', 'invoices.read'],
    datos: (db, ctx) => {
      const per = ctx.per;
      const modo = modoDeEmpresa(db);
      const m = margenResumen(db, { from: per.ini, to: per.fin });
      const ant = margenResumen(db, { from: per.iniAnt, to: per.finAnt });
      const t = titularDe(m.margen, modo), tAnt = titularDe(ant.margen, modo);
      // Un margen se compara en PUNTOS PORCENTUALES, no en «un 5 % más de porcentaje».
      const cmp = (t.pct == null || tAnt.pct == null)
        ? { hay: false, pct: null, delta: null, tono: 'neutro', anterior: tAnt.pct }
        : { hay: true, anterior: tAnt.pct, delta: r2(t.pct - tAnt.pct), pct: null, puntos: true,
            tono: t.pct === tAnt.pct ? 'neutro' : (t.pct > tAnt.pct ? 'bien' : 'mal') };
      return {
        modo, sufijo: MODOS[modo].sufijo,
        pct: t.pct, euros: m.margen.euros,
        margen: m.margen,                       // las dos cifras + la base + lo que queda fuera
        sinCoste: m.sinCoste, sinCostePct: m.sinCostePct,
        comparacion: cmp,
        chispa: chispaMargen(db, ctx),
      };
    },
  },

  // ── CLIENTES NUEVOS ───────────────────────────────────────────────────────────────────────────
  // YA HAY COMPARACIÓN (23 ago 2026, punto 8). Aquí ponía «el motor cuenta las altas por meses
  // completos: no hay forma honesta de comparar medio mes con medio mes». La forma honesta existe y
  // es la obvia: comparar el MISMO TRAMO — del 1 al 23 de agosto contra del 1 al 23 de julio.
  // `clientesNuevosPorTramo` lo hace recortando los dos lados por igual, y avisa (`completo`) cuando
  // el mes anterior era más corto que el día pedido, que es el único caso en que no son iguales.
  // La tendencia sigue saliendo de los meses COMPLETOS: una chispa de medio mes engañaría.
  clientes: {
    perms: ['clients.read'],
    datos: (db, { per }) => {
      const filas = clientesNuevosPorMes(db, { meses: 12 });
      const porMes = new Map(filas.map(f => [f.periodo, f.clientes]));
      const dia = Number(String(per.hoy).slice(8, 10));
      const ahora = clientesNuevosPorTramo(db, { mes: per.mes, hastaDia: dia });
      const antes = clientesNuevosPorTramo(db, { mes: per.mesAnt, hastaDia: dia });
      return {
        nuevos: ahora.clientes,
        mesAnteriorCompleto: porMes.has(per.mesAnt) ? porMes.get(per.mesAnt) : null,
        tramoDia: dia, tramoAnterior: antes.clientes, tramoAnteriorDia: antes.hastaDia,
        comparacion: comparar(ahora.clientes, antes.clientes, 'sube_bien'),
        // El único matiz que puede haber: febrero contra un día 30 no tiene día 30 que comparar.
        porQueNoHayComparacion: antes.hastaDia === dia ? null
          : 'El mes anterior solo tenía ' + antes.diasDelMes + ' días, así que se compara con el mes entero.',
        chispa: filas.slice(-6).map(f => f.clientes),
        chispaMeses: filas.slice(-6).map(f => f.periodo),
      };
    },
  },

  // ── EL GRÁFICO PRINCIPAL ──────────────────────────────────────────────────────────────────────
  // Ventas por día del mes en curso, con el mes anterior detrás. `ventasPorDia` es el ÚNICO motor de
  // serie diaria que existe y devuelve el TOTAL CON IVA — el constructor de analítica NO sabe
  // agrupar por día (`clavePeriodo` solo entiende mes/trimestre/año). Se usa lo que hay y se dice
  // lo que es; no se inventa una serie en base.
  grafico: {
    perms: ['invoices.read'],
    datos: (db, ctx) => serieDelMes(db, ctx),
  },

  // ── LO QUE MÁS VENDES · LO QUE MÁS TE DEJA ────────────────────────────────────────────────────
  // Los dos rankings salen del MISMO motor (`margenPorProducto`) y por tanto de la MISMA agrupación:
  // así no puede pasar que un producto exista en una lista y no en la otra. Con el SUELO aplicado a
  // las dos, arriba y abajo.
  productos: {
    perms: ['analytics.read', 'invoices.read', 'products.read'],
    datos: (db, { per }) => {
      const modo = modoDeEmpresa(db);
      const todos = margenPorProducto(db, { from: per.ini, to: per.fin, limit: 100000 });
      const conSuelo = todos.filter(p => Number(p.qty) >= SUELO_UNIDADES);
      const vendidos = [...conSuelo].sort((a, b) => b.qty - a.qty);
      // Para «lo que más te deja» solo entran los que tienen coste conocido: sin coste no hay margen
      // que juzgar (nunca 0 ni 100 %), así que quedarían fuera igual — mejor decirlo que colarlos.
      const juzgables = conSuelo.filter(p => p.margen && p.margen.hay);
      const rentables = [...juzgables].sort((a, b) => pctDe(b, modo) - pctDe(a, modo));
      return {
        suelo: SUELO_UNIDADES, sueloTexto: SUELO_TEXTO, modo, sufijo: MODOS[modo].sufijo,
        total: todos.length, dentro: conSuelo.length, fuera: todos.length - conSuelo.length,
        sinCosteFuera: conSuelo.length - juzgables.length,
        vendidos: extremos(vendidos).map(p => productoFila(p, modo)),
        rentables: extremos(rentables).map(p => productoFila(p, modo)),
      };
    },
  },

  // ── TUS MEJORES CLIENTES ──────────────────────────────────────────────────────────────────────
  // `ventasPorCliente`, el mismo del informe de clientes (y con su misma limpieza: el mostrador sin
  // cliente no es un cliente, así que no compite en el ranking de clientes).
  mejores: {
    perms: ['invoices.read', 'clients.read'],
    datos: (db, { per }) => ({
      clientes: ventasPorCliente(db, { from: per.ini, to: per.fin, limit: 50 })
        .filter(x => x.client_id).slice(0, 3)
        .map(x => ({ client_id: x.client_id, nombre: x.cliente, base: x.base, facturas: x.facturas })),
    }),
  },

  // ── OPORTUNIDADES ABIERTAS ────────────────────────────────────────────────────────────────────
  oportunidades: {
    perms: ['crm.read'],
    datos: (db, { per }) => {
      const p = pipelineByStage(db, per.hoy);
      return { abiertas: p.abiertas, importe: p.totalAbierto, ponderado: p.ponderado, href: '/admin/crm' };
    },
  },

  // ── DISA DECIDE ───────────────────────────────────────────────────────────────────────────────
  // El vigía detecta y `priorizar` ordena — los dos ya existen. Aquí solo se cogen los TRES primeros
  // y se les pone su destino. Sin nada que recomendar, `lineas` viene vacío y la pantalla no pinta
  // el bloque: un bloque que dice «no hay nada» ocupa sitio y no aporta.
  //
  // POR QUÉ NO SE PINTA LA PROSA DE `voz.js` AQUÍ, y conviene que quede escrito. La voz compone unas
  // frases estupendas («Conviene reclamar el cobro de …»), pero escribe el dinero en formato inglés
  // (€232.75) y las fechas en ISO (2026-07-28) — se ve en su propio comentario de cabecera. Esta
  // pantalla tiene una regla dura: dinero y fechas EN ESPAÑOL, sin excepción. Las dos salidas malas
  // serían tocar la voz (cambia también la pantalla del vigía y cuatro gates: otra tarea) o
  // reescribir su texto con expresiones regulares — que es REPARSEAR, justo lo que la voz prohíbe en
  // su cabecera y lo que destroza un nombre de cliente con caracteres raros.
  // La tercera salida es la que se toma: la línea se COMPONE de campos estructurados (la cifra, la
  // etiqueta del detector, el nombre, el código del documento y la fecha), y cada uno se escribe en
  // español al pintarlo. Ni una cifra se recalcula: son las del vigía, tal cual.
  decide: {
    perms: ['analytics.read'],
    datos: (db, { puede, per, rutaExiste }) => {
      const res = detectar(db, { hasPerm: puede, hoy: per.hoy });
      const lineas = priorizar(res.hallazgos || [], res.hoy).slice(0, 3).map(a => ({
        detector: a.detector, area: a.area, areaEtiqueta: a.areaEtiqueta,
        etiqueta: a.detectorEtiqueta,
        cifra: a.cifra, moneda: !!a.moneda, unidad: a.moneda ? null : (UNIDAD[a.detector] || null),
        fecha: a.fecha || null,
        quien: nombreDeRef(db, a.ref),
        codigo: (a.ref && (a.ref.invoice_number || a.ref.internal_code || a.ref.supplier_invoice_number)) || null,
        prioridad: a.prioridad ? a.prioridad.grupo : 'media',
        ...destinoDe(a, rutaExiste),
      }));
      return { lineas };
    },
  },
};

// LA UNIDAD DE LA CIFRA. El vigía manda el número y si es dinero o no, pero no QUÉ MIDE: un «13» a
// secas delante de «hueco que se va a perder» no dice nada. La unidad es un rótulo de producto por
// detector —no un cálculo—, y sale de lo que cada uno ya declara en su cabecera (horas libres, días,
// faltas). Un detector nuevo sin entrada aquí se pinta sin unidad, como hasta ahora: nunca inventa.
const UNIDAD = {
  hueco_perdido:    'h libres',
  cliente_dormido:  'días',
  fuera_de_ritmo:   'días',
  sin_proxima_cita: 'días',
  ausencias:        'faltas',
};

// El NOMBRE de quien va el aviso, resuelto igual que en la pantalla del vigía (`resolversDe`): una
// consulta de un nombre, nunca una cifra, y solo para un hallazgo que este usuario YA puede ver (el
// vigía filtró antes por el permiso de cada detector). Se escapa al pintarlo, como todo nombre.
function nombreDeRef(db, ref) {
  if (!ref) return null;
  try {
    if (ref.client_id) return db.prepare('SELECT name FROM clients WHERE id=?').get(ref.client_id)?.name || null;
    if (ref.supplier_id) return db.prepare('SELECT name FROM suppliers WHERE id=?').get(ref.supplier_id)?.name || null;
  } catch { return null; }
  return null;
}

// El porcentaje que manda en esta empresa para ORDENAR el ranking de rentabilidad. Nunca se pinta
// desnudo: la fila lleva su base al lado (ver `productoFila`).
const pctDe = (p, modo) => {
  const t = titularDe(p.margen, modo);
  return t.pct == null ? -Infinity : t.pct;
};

// Los TRES PRIMEROS + EL ÚLTIMO. Con cuatro o menos no hay «último» que enseñar aparte: se enseñan
// todos y ya está — repetir una fila como si fuera el farolillo rojo sería una lista que miente.
function extremos(lista) {
  if (lista.length <= 4) return lista.map((p, i) => ({ ...p, _puesto: i + 1, _ultimo: false }));
  const top = lista.slice(0, 3).map((p, i) => ({ ...p, _puesto: i + 1, _ultimo: false }));
  const u = lista[lista.length - 1];
  return top.concat([{ ...u, _puesto: lista.length, _ultimo: true }]);
}

function productoFila(p, modo) {
  const t = titularDe(p.margen, modo);
  return {
    nombre: p.product_name, product_id: p.product_id,
    qty: p.qty, ingresos: p.ingresos, beneficio: p.beneficio,
    pct: t.pct, sufijo: t.sufijo,
    // LA BASE, SIEMPRE. Es lo que convierte el porcentaje en algo comprobable (CANON · margen.js).
    base: p.margen ? p.margen.venta : null,
    fuera: p.margen ? p.margen.fuera : null,
    aproximado: !!p.aproximado,
    puesto: p._puesto, ultimo: p._ultimo,
  };
}

// ── LA SERIE DIARIA (el gráfico grande y la minigráfica de ventas) ──────────────────────────────
// `ventasPorDia(db, N)` mira N días hacia atrás desde HOY, así que se le piden los que hagan falta
// para llegar al día 1 del mes ANTERIOR y se reparte lo que devuelve en dos series por su fecha.
// Repartir no es calcular: la suma de cada día es la que dio el motor, intacta.
//
// Los días sin factura salen a 0 A PROPÓSITO, y aquí sí es verdad: `ventasPorDia` enumera TODAS las
// facturas que cuentan, así que un día que no aparece es un día en el que no se vendió nada. (No es
// el caso de `compararEnTiempo`, donde un hueco significa «esa área no tiene dato ese periodo».)
function serieDelMes(db, ctx) {
  // Memorizada por composición: la piden la tarjeta de ventas Y el gráfico grande, y barrer las
  // facturas de dos meses dos veces por carga del Inicio sería pagar dos veces lo mismo.
  if (ctx._serie) return ctx._serie;
  const per = ctx.per;
  const DIA = 86400000;
  const dias = Math.round((Date.parse(per.hoy + 'T00:00:00Z') - Date.parse(per.iniAnt + 'T00:00:00Z')) / DIA) + 1;
  // AHORA CADA DÍA TRAE SUS DOS CIFRAS (23 ago 2026, punto 8). `ventasPorDia` devolvía solo el total
  // CON IVA, así que el gráfico iba con IVA y el titular de arriba sin él, y la pantalla tenía que
  // explicar el desajuste en una nota al pie. Ahora el motor da también la BASE —el mismo `subtotal`
  // que suma el titular—, así que el gráfico habla el mismo idioma que la cifra que tiene encima.
  const porFecha = new Map(ventasPorDia(db, Math.max(1, dias)).map(d => [d.date, d]));
  const serie = (ini, fin) => {
    const out = [];
    for (let t = Date.parse(ini + 'T00:00:00Z'); t <= Date.parse(fin + 'T00:00:00Z'); t += DIA) {
      const f = new Date(t).toISOString().slice(0, 10);
      const d = porFecha.get(f);
      out.push({ fecha: f, dia: Number(f.slice(8, 10)), total: d ? d.total : 0, base: d ? d.base : 0 });
    }
    return out;
  };
  ctx._serie = {
    conIva: false,                                 // se pinta la BASE, igual que el titular
    tieneAmbas: true,                              // y el total con IVA sigue viajando, por si hace falta
    actual: serie(per.ini, per.fin), mes: per.mes,
    anterior: serie(per.iniAnt, per.ultAnt), mesAnt: per.mesAnt,
  };
  return ctx._serie;
}

// La minigráfica del margen: BENEFICIO en euros por mes (no el porcentaje). Un porcentaje suelto en
// una minigráfica es justo un porcentaje sin su base, que es lo que el canon prohíbe. Sale del
// constructor —`cruzar` por fecha con la medida `beneficio`—, que usa el mismo motor de margen.
function chispaMargen(db, ctx) {
  const per = ctx.per;
  try {
    const [y, m] = per.mes.split('-').map(Number);
    const desde = new Date(Date.UTC(y, m - 6, 1)).toISOString().slice(0, 10);
    const r = cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: ['beneficio'],
                           periodo: 'mes', from: desde, to: per.fin, limit: 24, hasPerm: ctx.puede });
    return (r.filas || []).map(f => f.beneficio == null ? 0 : f.beneficio);
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LA COMPOSICIÓN — solo lo que este usuario puede ver
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function puedeSeccion(nombre, { puede, db }) {
  const s = SECCIONES[nombre];
  if (!s) return false;
  if (s.aplica && !s.aplica(db)) return false;
  return s.perms.every(p => puede(p));
}

// Los permisos que le FALTAN a este usuario para una sección (para decírselo, en vez de callar).
export function faltanDe(nombre, puede) {
  const s = SECCIONES[nombre];
  return s ? s.perms.filter(p => !puede(p)) : [];
}

// UNA sección suelta, por su nombre. Es la puerta que se usa al FORZAR la ruta a mano: una sección
// que no existe da 404 y una para la que falta un permiso da 403 — nunca un cuerpo a medias.
export function seccion(db, nombre, { puede, sym = '€', rutaExiste = () => true, hoy = null } = {}) {
  const s = SECCIONES[nombre];
  if (!s) { const e = new Error('No conozco esa parte del Inicio'); e.status = 404; throw e; }
  const falta = s.perms.filter(p => !puede(p));
  if (falta.length) { const e = new Error('No tienes permiso para ver esta parte del Inicio'); e.status = 403; throw e; }
  if (s.aplica && !s.aplica(db)) return null;      // no aplica a este negocio: no existe, no es un hueco
  const per = periodoDe(hoy || hoyLocal());
  return s.datos(db, { puede, sym, rutaExiste, per, db });
}

export function cuadro(db, { puede, sym = '€', rutaExiste = () => true, hoy = null } = {}) {
  const per = periodoDe(hoy || hoyLocal());
  const ctx = { puede, sym, rutaExiste, per, db };
  const out = { periodo: per, sym, secciones: {}, sinPermiso: [], noAplica: [] };
  for (const nombre of Object.keys(SECCIONES)) {
    const s = SECCIONES[nombre];
    if (s.aplica && !s.aplica(db)) { out.noAplica.push(nombre); continue; }
    const falta = s.perms.filter(p => !puede(p));
    // LO QUE NO SE PUEDE VER NO SE CALCULA. No es que se esconda al pintar: es que el motor ni
    // siquiera se llama, así que el dato no existe en la respuesta y no puede viajar.
    if (falta.length) { out.sinPermiso.push({ seccion: nombre, falta }); continue; }
    try { out.secciones[nombre] = s.datos(db, ctx); }
    catch (e) { out.secciones[nombre] = null; }     // un motor que peta no tumba el Inicio entero
  }
  return out;
}
