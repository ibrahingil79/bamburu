// ════════════════════════════════════════════════════════════════════════════════════════════════
// DISA · LOS INFORMES POR CHAT — la segunda puerta (CANON §3-bis) · punto 10, 23 ago 2026
//
// QUÉ RESUELVE. La puerta visual a la analítica estaba entera (crear, guardar, reabrir, compartir,
// renombrar, borrar, imprimir, PDF y correo) y la de DISA NO EXISTÍA: `analytics_panels` no estaba
// en su mapa de lectura —un empleado que los pidiera por chat recibía «no consultable con tu
// permiso»— y no había ninguna acción dedicada. Un dueño podía leer la tabla en crudo con
// `query_database`, que es SQL, no una puerta.
//
// LAS TRES REGLAS QUE MANDAN AQUÍ:
//
//  1. MISMO MOTOR, NO UNA COPIA. Todo sale de `constructor-analitica.js`: `cruzar`, `camposPara`,
//     `listarPaneles`, `panelVisible`. Si esto tuviera su propio catálogo o su propio SQL, las dos
//     puertas darían números distintos el día que una cambiara — y el canon dice que ninguna
//     sustituye a la otra, no que se parezcan.
//
//  2. MISMOS PERMISOS QUE LA PANTALLA. El `hasPerm` que se le pasa es el mismo `checkPermission`
//     que usa `requirePerm`. Un panel COMPARTIDO de un área que el usuario no puede ver **no se
//     lista**: `listarPaneles` filtra por «mío o compartido», y encima de eso se filtra por el
//     permiso del área, que es lo que hace la pantalla al abrirlo. Y se dice CUÁNTOS se han
//     escondido, para que el usuario sepa que hay algo que no ve en vez de creer que no existe.
//
//  3. NO SE ESCRIBE. Ni guardar, ni renombrar, ni borrar. Componer devuelve el resultado y un
//     ENLACE que abre el constructor con la receta puesta; guardar se hace allí, con un botón.
//     Es «DISA propone y el usuario confirma» aplicado a esto, y evita abrir un camino de escritura
//     nuevo por una comodidad. `analytics_panels` sigue FUERA de WRITABLE_TABLES.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { cruzar, camposPara, listarPaneles, panelVisible, areasPara, areaPerm, AREAS,
         RANGOS, RANGO_POR_DEFECTO } from '../erp/constructor-analitica.js';

// La declaración que ve el modelo. Vive aquí, junto a lo que la ejecuta: una descripción que
// prometa algo que la función no hace es la peor clase de mentira, porque la dice la máquina.
export const TOOLS_INFORMES = [
  {
    name: 'listar_informes',
    description: 'Lista los informes de analitica GUARDADOS que este usuario puede ver (los suyos y los compartidos). Usala cuando pregunte por "mis informes" o quiera abrir uno por su nombre.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'abrir_informe',
    description: 'Abre un informe guardado por su id y devuelve sus filas ya calculadas, con el enlace para verlo en pantalla. Primero usa listar_informes para saber el id.',
    input_schema: { type: 'object', properties: { id: { type: 'integer', description: 'El id del informe' } }, required: ['id'] },
  },
  {
    name: 'catalogo_informes',
    description: 'Dice que AREAS, que formas de repartir y que medidas hay disponibles para ESTE usuario. Usala ANTES de componer_informe para elegir nombres validos: no te los inventes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'componer_informe',
    description: 'Compone un informe NUEVO y devuelve sus filas y un enlace para abrirlo en la pantalla. No lo guarda: guardar se hace desde la pantalla. Usa catalogo_informes para saber que nombres valen.',
    input_schema: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'ventas, compras, clientes, inventario, contabilidad, agenda o catalogo' },
        quiero_saber: { type: 'string', description: 'la clave de la medida (p.ej. base, beneficio, citas, productos)' },
        repartido_por: { type: 'string', description: 'la clave de la dimension (p.ej. fecha, cliente, producto, parado)' },
        periodo: { type: 'string', description: 'clave de rango: 12m, este_anio, mes_actual… (por defecto 12m)' },
        paso: { type: 'string', description: 'mes, trimestre o anio (solo cuando se reparte por fecha)' },
      },
      required: ['area', 'quiero_saber', 'repartido_por'],
    },
  },
];
export const NOMBRES_INFORMES = new Set(TOOLS_INFORMES.map(t => t.name));

// El enlace que se le da al usuario. NO es una puerta nueva a los datos: la pantalla vuelve a pedir
// el cruce por el endpoint de siempre, con los permisos de siempre.
export function enlaceDeReceta(r) {
  const q = new URLSearchParams({ area: r.area, dim: r.dimension, med: (r.medidas || [])[0] || '' });
  if (r.rango) q.set('rango', r.rango);
  if (r.periodo) q.set('periodo', r.periodo);
  if (r.grafico) q.set('grafico', r.grafico);
  return '/admin/analytics?' + q.toString();
}

// `hasPerm` recibe la clave entera ('invoices.read'), igual que en el constructor.
export function herramientasDeInformes(db, { userId = null, hasPerm = () => true, limite = 30 } = {}) {
  const listar = () => {
    const todos = listarPaneles(db, userId) || [];
    const visibles = todos.filter(p => { const per = areaPerm((p.config || {}).area || 'ventas'); return !per || hasPerm(per); });
    return {
      informes: visibles.map(p => ({
        id: p.id, nombre: p.nombre, propio: !!p.propio, compartido: !!p.compartido,
        autor: p.autor || null, area: (p.config || {}).area || 'ventas',
        repartido_por: (p.config || {}).dimension,
      })),
      // Se DICE cuántos se esconden. Callarlo haría creer que no existen, que es distinto de
      // «existen y no los ves», y esa diferencia importa cuando alguien pregunta por uno por nombre.
      ocultos_por_permiso: todos.length - visibles.length,
    };
  };
  const abrir = (id) => {
    const p = panelVisible(db, userId, Number(id));
    if (!p) return { error: 'No existe ese informe, o no es tuyo ni está compartido.' };
    const r = cruzar(db, { ...p.config, hasPerm, limit: limite });
    return { nombre: p.nombre, receta: p.config, enlace: '/admin/analytics?panel=' + p.id,
             periodo: r.rangoEtiqueta || null, filas: r.filas, total_filas: (r.filas || []).length };
  };
  const catalogo = () => {
    const areas = areasPara(hasPerm) || {};
    const out = {};
    for (const k of Object.keys(areas)) {
      const cp = camposPara(hasPerm, k);
      out[k] = {
        etiqueta: areas[k],
        repartir_por: Object.fromEntries(Object.entries(cp.dimensiones).map(([kk, v]) => [kk, v.etiqueta])),
        quiero_saber: Object.fromEntries(Object.entries(cp.medidas).map(([kk, v]) => [kk, v.etiqueta])),
      };
    }
    return { areas: out, periodos: Object.fromEntries(Object.entries(RANGOS || {}).map(([k, v]) => [k, v.etiqueta || k])) };
  };
  const componer = (inp = {}) => {
    const area = String(inp.area || 'ventas');
    if (!AREAS[area]) return { error: 'No conozco el área "' + area + '". Las que hay: ' + Object.keys(AREAS).join(', ') };
    const receta = {
      area, dimension: String(inp.repartido_por || 'fecha'),
      medidas: [String(inp.quiero_saber || '')].filter(Boolean),
      rango: inp.periodo || RANGO_POR_DEFECTO, periodo: inp.paso || 'mes',
    };
    const r = cruzar(db, { ...receta, hasPerm, limit: limite });
    return { receta, periodo: r.rangoEtiqueta || null, filas: r.filas, total_filas: (r.filas || []).length,
             enlace: enlaceDeReceta(receta),
             nota: 'Para guardarlo, abre el enlace y pulsa Guardar: desde el chat no se guarda.' };
  };

  // EL ERROR SE VISTE EN CADA FUNCIÓN, no solo en el despachador. `cruzar` LANZA cuando falta un
  // permiso (403) —y hace bien: fallar cerrado es lo correcto—, pero una función exportada que a
  // veces devuelve un objeto y a veces revienta es una trampa para quien la llame por otro sitio.
  // Aquí todas devuelven lo mismo: un resultado, o `{ error, status }`. El modelo recibe una frase
  // que puede leerle al usuario, y un 403 se distingue de un «no existe», que no es lo mismo.
  const seguro = fn => (...args) => {
    try { return fn(...args); }
    catch (e) { return { error: e && e.message ? e.message : 'No he podido preparar ese informe.', status: e && e.status }; }
  };
  const api = { listar: seguro(listar), abrir: seguro(abrir), catalogo: seguro(catalogo), componer: seguro(componer) };
  const ejecutar = (nombre, input = {}) => {
    switch (nombre) {
      case 'listar_informes':   return api.listar();
      case 'abrir_informe':     return api.abrir(input.id);
      case 'catalogo_informes': return api.catalogo();
      case 'componer_informe':  return api.componer(input);
      default: return { error: 'Herramienta de informes desconocida: ' + nombre };
    }
  };
  return { TOOLS: TOOLS_INFORMES, ejecutar, ...api };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DISA · DESCUENTOS, PROMOCIONES Y BONOS (punto 11) — LEER Y PROPONER, nunca aplicar
//
// POR QUÉ AQUÍ: es la misma clase de puerta que la de los informes —DISA contesta con el MISMO
// motor que la pantalla— y comparte su regla: **no escribe**. Aplicar un descuento cambia lo que se
// factura, y consumir un bono le quita al cliente algo que pagó: las dos son acciones con valor, y
// el canon dice que DISA propone y el usuario confirma. Así que devuelve el cálculo y **el enlace**
// a donde se hace, igual que con los informes.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { listarPromociones, promocionVigente, bonosDe, proponer as proponerDto } from '../erp/descuentos.js';

export const TOOLS_DESCUENTOS = [
  {
    name: 'ver_descuentos',
    description: 'Dice que descuentos hay disponibles: las promociones vigentes hoy, el descuento fijo de un cliente y sus bonos con sesiones sin usar. Si le pasas el id del cliente, lo cuenta todo de el.',
    input_schema: { type: 'object', properties: { client_id: { type: 'integer', description: 'opcional: el cliente del que preguntan' } } },
  },
  {
    name: 'calcular_descuento',
    description: 'Calcula cuanto se llevaria de descuento un importe para un cliente, con lo que hay vigente hoy. Devuelve el detalle y el enlace para hacerlo en la pantalla. NO aplica nada.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'integer', description: 'el cliente' },
        importe: { type: 'number', description: 'la base del documento, sin IVA' },
        iva: { type: 'number', description: 'el tipo de IVA de esa base (21, 10, 4 o 0). Por defecto 21.' },
        codigo: { type: 'string', description: 'un codigo de promocion, si lo tiene' },
      },
      required: ['importe'],
    },
  },
];
export const NOMBRES_DESCUENTOS = new Set(TOOLS_DESCUENTOS.map(t => t.name));

export function herramientasDeDescuentos(db, { hasPerm = () => true } = {}) {
  const puede = () => hasPerm('invoices.read');
  const ver = (inp = {}) => {
    if (!puede()) return { error: 'No tienes permiso para ver los descuentos (hace falta el de facturas).' };
    const hoy = new Date().toISOString().slice(0, 10);
    const proms = listarPromociones(db, { soloActivas: true })
      .filter(p => promocionVigente(p, hoy))
      .map(p => ({ nombre: p.nombre, descuento: p.tipo === 'porcentaje' ? p.valor + ' %' : p.valor + ' €',
                   codigo: p.codigo || null, hasta: p.hasta || null, sobre: p.alcance }));
    const out = { promociones_vigentes: proms, enlace: '/admin/descuentos' };
    if (inp.client_id) {
      const cli = db.prepare('SELECT id, name, descuento_pct FROM clients WHERE id=?').get(inp.client_id);
      if (!cli) return { error: 'Ese cliente no existe.' };
      out.cliente = { id: cli.id, nombre: cli.name, descuento_fijo_pct: Number(cli.descuento_pct) || 0 };
      out.bonos = bonosDe(db, cli.id, { soloVivos: true })
        .map(b => ({ id: b.id, nombre: b.nombre, quedan: b.quedan, de: b.sesiones, caduca: b.caduca || null }));
      out.nota_bonos = 'Un bono no se descuenta de la factura: se consume desde /admin/descuentos y no genera factura, porque el ingreso se declaro al venderlo.';
    }
    return out;
  };
  const calcular = (inp = {}) => {
    if (!puede()) return { error: 'No tienes permiso para calcular descuentos (hace falta el de facturas).' };
    const importe = Number(inp.importe) || 0;
    if (importe <= 0) return { error: 'Dime un importe mayor que cero.' };
    const iva = inp.iva == null ? 21 : Number(inp.iva);
    const r = proponerDto(db, { clientId: inp.client_id || null, codigo: inp.codigo || '',
      lineas: [{ description: 'Base', quantity: 1, unit_price: importe, tax_rate: iva }] });
    const total = Math.round(r.lineas.reduce((s, l) => s + Math.abs(l.unit_price), 0) * 100) / 100;
    return {
      base: importe, descuento_total: total, quedaria_en: Math.round((importe - total) * 100) / 100,
      detalle: r.propuestas.map(p => ({ nombre: p.nombre, motivo: p.motivo, resta: p.importe || 0 })),
      enlace: '/admin/invoices/new',
      nota: 'Esto es un calculo, no se ha aplicado nada. Para aplicarlo, en la PANTALLA de la factura pulsa «Descuentos…» y eliges cual entra.',
    };
  };
  const ejecutar = (nombre, input = {}) => {
    try {
      if (nombre === 'ver_descuentos') return ver(input);
      if (nombre === 'calcular_descuento') return calcular(input);
      return { error: 'Herramienta de descuentos desconocida: ' + nombre };
    } catch (e) { return { error: e && e.message ? e.message : 'No he podido calcularlo.', status: e && e.status }; }
  };
  return { TOOLS: TOOLS_DESCUENTOS, ejecutar, ver, calcular };
}
