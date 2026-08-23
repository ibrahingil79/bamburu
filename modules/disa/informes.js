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
