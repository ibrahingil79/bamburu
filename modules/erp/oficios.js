// ESCALERA · PASO 8 — PERFIL DE OFICIO (módulo HOJA).
//
// POR QUÉ ES HOJA, Y POR QUÉ IMPORTA. El menú lo pinta layout.js y las pantallas de la agenda las pinta
// routes/citas.js; los dos necesitan LAS MISMAS PALABRAS. Si el diccionario viviera en routes/citas.js,
// layout.js tendría que importarlo y cerraría el círculo (routes/citas.js ya importa adminLayout de
// layout.js). Aquí dentro solo entra `db`: nada de routes/, nada de layout, nada de products. Mismo
// patrón y misma razón que reserva-publica-config.js en la pieza 6.
//
// ANTES DE ESTO EL VOCABULARIO YA ESTABA PARTIDO EN DOS: `cita_puesto_plural` se leía en ajustesCitas()
// (routes/citas.js) y OTRA VEZ, por su cuenta, en el parche del menú de layout.js. Con una sola palabra
// se notaba poco; con un diccionario por oficio, el menú habría dicho una cosa y la pantalla otra. Este
// fichero es ahora el ÚNICO sitio que resuelve palabras de pantalla: los dos lados llaman a vocabulario().
//
// EL OFICIO HACE EXACTAMENTE DOS COSAS: cambia palabras de pantalla y precarga el catálogo de servicios.
// NO toca el motor, NO enciende ni apaga funciones, NO quita nada. Los huecos, los solapes y los
// horarios siguen saliendo de citas-engine.js sin enterarse de que este fichero existe.
//
// LAS DURACIONES NO SON INVENTADAS. Cada una viene de lo que se publica hoy en España (agendas reales de
// Fresha y Booksy, tarifas de clínica, tiempos de taller y de gestoría). Las fuentes están anotadas
// servicio a servicio más abajo. Se siembra la duración TOTAL de la cita: el "tiempo de espera" (el
// tinte que reposa) y el "margen después" nacen a 0 a propósito, porque las fuentes publican el tiempo
// total que ocupa la cita, no su reparto interno — y eso sí sería inventárselo. El negocio los ajusta
// cuando quiera desde Servicios, que es donde viven.

export const OFICIO_DEFECTO = 'otro';

// Los seis. `puesto_sing`/`puesto_plural` son solo el ARRANQUE: en cuanto se escriben en company_config,
// manda lo guardado (el dueño puede renombrarlos en Ajustes de citas y nadie se lo pisa).
//
// `usa_proyectos` — si el panel de cita PINTA el campo «Proyecto» (peldaño 7). Es solo pintar: el campo
// NUNCA se saca del DOM ni se borra el dato, porque `editCitaSvc` escribe `project_id=?` con lo que
// llegue, y un campo ausente le borraría el proyecto a la cita al editarla. Un peluquero no tiene
// proyectos; una asesoría sí. **'otro' lo mantiene EN true a propósito**: son los negocios que ya
// existían, que hoy ven ese campo, y a esos no se les quita nada de la pantalla por una migración.
export const OFICIOS = [
  {
    id: 'peluqueria',
    usa_proyectos: false,
    label: 'Peluquería y barbería',
    cliente_sing: 'Cliente', cliente_plural: 'Clientes',
    puesto_sing: 'Silla', puesto_plural: 'Sillas',
    // Fuente: agendas públicas de barberías y peluquerías en Fresha (Madrid y Barcelona, ago 2026).
    servicios: [
      { nombre: 'Corte caballero',        duracion_min: 30,  banda: 'general' },  // Fresha Madrid: "Corte Caballero" 30 min (varios salones)
      { nombre: 'Arreglo de barba',       duracion_min: 20,  banda: 'general' },  // Fresha Madrid: "Arreglo de Barba" 20 min (Jesús Peluqueros, Chamer)
      { nombre: 'Corte y barba',          duracion_min: 45,  banda: 'general' },  // Fresha Madrid: "Pack Corte de Pelo y Barba" 45 min (Chicomalo)
      { nombre: 'Corte señora',           duracion_min: 45,  banda: 'general' },  // Fresha BCN: "Corte de cabello para mujer" 45 min – 1 h
      { nombre: 'Color / tinte de raíz',  duracion_min: 60,  banda: 'general' },  // Fresha BCN: "Color/Tinte Raíz" 1 h
      { nombre: 'Mechas / balayage',      duracion_min: 150, banda: 'general' },  // Fresha BCN: "Mechas Balayage… + matiz + peinado" 2 h 30 min
      { nombre: 'Peinado',                duracion_min: 30,  banda: 'general' },  // Fresha BCN: "Peinado" 15 min – 1 h
      { nombre: 'Lavar y peinar',         duracion_min: 60,  banda: 'general' },  // Fresha BCN: "Lavado y peinar cabello largo" 1 h
    ],
  },
  {
    id: 'estetica',
    usa_proyectos: false,
    label: 'Estética y belleza',
    cliente_sing: 'Cliente', cliente_plural: 'Clientes',
    puesto_sing: 'Cabina', puesto_plural: 'Cabinas',
    // Fuente: agendas públicas de centros de estética y salones de uñas en Booksy (Barcelona, ago 2026).
    servicios: [
      { nombre: 'Manicura',                  duracion_min: 30, banda: 'general' },  // Booksy: "Manicura" 30 min (Wikinails, Beauty Project)
      { nombre: 'Manicura semipermanente',   duracion_min: 60, banda: 'general' },  // Booksy: "MANICURA SEMIPERMANENTE" 1 h
      { nombre: 'Pedicura',                  duracion_min: 45, banda: 'general' },  // Booksy: "MANICURA COMPLETA" 45 min; pedicura equivalente
      { nombre: 'Diseño de cejas',           duracion_min: 25, banda: 'general' },  // Booksy: "Diseño de cejas + depilación (hilo ó cera)" 25 min
      { nombre: 'Depilación con cera (labio)', duracion_min: 10, banda: 'general' },// Booksy: "Depilación de labio superior con cera o hilo" 10 min
      { nombre: 'Limpieza facial',           duracion_min: 60, banda: 'general' },  // Booksy: tratamiento facial 45 min – 1 h 15 min
      { nombre: 'Masaje',                    duracion_min: 60, banda: 'general' },  // Booksy: "Masaje clásico" 1 h
      { nombre: 'Lifting de pestañas',       duracion_min: 40, banda: 'general' },  // Booksy: "Lifting de pestañas" 40 min
    ],
  },
  {
    id: 'salud',
    usa_proyectos: false,
    // PELDAÑO 8 (24 ago 2026) — el oficio pasa de «fisioterapia» a SALUD Y BIENESTAR, que es lo que
    // pedía el peldaño. Antes tenía cuatro servicios y los cuatro eran de fisio: un psicólogo o un
    // nutricionista elegía este oficio y se encontraba un catálogo que no era el suyo.
    label: 'Salud y bienestar',
    cliente_sing: 'Paciente', cliente_plural: 'Pacientes',
    puesto_sing: 'Sala', puesto_plural: 'Salas',
    // LA FICHA DEL PACIENTE. `campos_ficha` dice qué le hace falta a ESTE oficio en la ficha de su
    // cliente. Hoy solo la fecha de nacimiento — y NO es un capricho: la edad cambia la pauta de un
    // tratamiento y es lo primero que se pregunta en una primera visita.
    // LO QUE NO ENTRA AQUÍ, Y ES A PROPÓSITO: el historial clínico. Son datos de salud, categoría
    // ESPECIAL del RGPD (art. 9), y guardarlos exige decisiones que no están escritas en ningún
    // sitio de este proyecto (quién los ve, cuánto se conservan, cómo se piden). Va apuntado en el
    // TABLERO con sus opciones. Meter un campo «notas clínicas» sin resolver eso sería lo peor de
    // los dos mundos: el dato dentro y la protección fuera.
    campos_ficha: ['fecha_nacimiento'],
    // IVA: los servicios de asistencia sanitaria prestados por profesional titulado están EXENTOS
    // (art. 20.Uno.3º LIVA). Nace 'exento' para no arrancar cobrando un 21% que no toca; si el negocio
    // no está en ese supuesto, lo cambia en Productos como cualquier otra banda.
    // OJO A LA EXCEPCIÓN, y por eso no todos nacen exentos: el masaje de bienestar SIN finalidad
    // terapéutica NO está exento (consultas vinculantes de la DGT), y lo mismo el asesoramiento
    // nutricional que no presta un sanitario titulado. Los que están en esa frontera nacen al tipo
    // general y con el nombre que lo dice, para que el negocio decida a sabiendas.
    servicios: [
      // Fisioterapia — fuente: tarifas publicadas de clínica de fisioterapia en España (fisioem.com, ago 2026).
      { nombre: 'Primera consulta y valoración', duracion_min: 60, banda: 'exento' },  // fisioem: "1ª consulta – valoración 60 min"
      { nombre: 'Sesión de fisioterapia',        duracion_min: 45, banda: 'exento' },  // fisioem: "Sesión fisioterapia 45min"
      { nombre: 'Sesión de fisioterapia (60 min)', duracion_min: 60, banda: 'exento' },// tarifas de sesión de 60 min en clínicas ES
      { nombre: 'Sesión de suelo pélvico',       duracion_min: 45, banda: 'exento' },  // fisioem: "Sesión de tratamiento 45 min" (suelo pélvico)
      // Psicología — fuente: tarifas publicadas de gabinetes de psicología en España (ago 2026): la
      // sesión estándar es de 50–60 min y la primera, algo más larga.
      { nombre: 'Primera sesión de psicología',  duracion_min: 60, banda: 'exento' },
      { nombre: 'Sesión de psicología',          duracion_min: 50, banda: 'exento' },
      { nombre: 'Terapia de pareja',             duracion_min: 75, banda: 'exento' },
      // Nutrición — fuente: consultas de dietética-nutrición en España: primera visita 60 min,
      // revisiones 30 min. EXENTO solo si lo presta un sanitario titulado; si no, va al general.
      { nombre: 'Primera consulta de nutrición', duracion_min: 60, banda: 'exento' },
      { nombre: 'Revisión de nutrición',         duracion_min: 30, banda: 'exento' },
      // Osteopatía y podología — sesiones de 45–60 min en clínicas ES.
      { nombre: 'Sesión de osteopatía',          duracion_min: 50, banda: 'exento' },
      { nombre: 'Quiropodia',                    duracion_min: 45, banda: 'exento' },
      // Logopedia — sesión estándar de 45 min.
      { nombre: 'Sesión de logopedia',           duracion_min: 45, banda: 'exento' },
      // BIENESTAR, no sanitario: al tipo GENERAL, y el nombre lo dice.
      { nombre: 'Masaje de bienestar (no terapéutico)', duracion_min: 60, banda: 'general' },
      { nombre: 'Sesión de entrenamiento personal',     duracion_min: 60, banda: 'general' },
    ],
  },
  {
    id: 'taller',
    usa_proyectos: false,
    label: 'Taller mecánico',
    cliente_sing: 'Cliente', cliente_plural: 'Clientes',
    puesto_sing: 'Box', puesto_plural: 'Boxes',
    // Fuente: tiempos de servicio publicados por talleres y guías del sector en España (ago 2026).
    servicios: [
      { nombre: 'Cambio de aceite y filtro',   duracion_min: 45, banda: 'general' },  // 30–45 min (guías de taller ES)
      { nombre: 'Pastillas de freno (un eje)', duracion_min: 60, banda: 'general' },  // 30–60 min por eje
      { nombre: 'Cambio de neumáticos (4)',    duracion_min: 60, banda: 'general' },  // 45 min – 1 h las cuatro, con equilibrado
      { nombre: 'Equilibrado de 4 ruedas',     duracion_min: 45, banda: 'general' },  // 30–45 min
      { nombre: 'Revisión pre-ITV',            duracion_min: 90, banda: 'general' },  // 60–90 min según vehículo
    ],
  },
  {
    id: 'asesoria',
    usa_proyectos: true,
    label: 'Asesoría y consultoría',
    cliente_sing: 'Cliente', cliente_plural: 'Clientes',
    puesto_sing: 'Sala', puesto_plural: 'Salas',
    // Fuente: duraciones de cita publicadas para gestorías y asesorías en España (ago 2026):
    // "Una declaración de la Renta dura 45 minutos, un alta de autónomo 20, una consulta laboral por
    // despido objetivo 30 y una constitución de sociedad limitada puede pasar de la hora."
    servicios: [
      { nombre: 'Declaración de la Renta',      duracion_min: 45, banda: 'general' },
      { nombre: 'Alta de autónomo',             duracion_min: 20, banda: 'general' },
      { nombre: 'Consulta laboral',             duracion_min: 30, banda: 'general' },
      { nombre: 'Constitución de sociedad',     duracion_min: 60, banda: 'general' },
    ],
  },
  {
    id: 'otro',
    usa_proyectos: true,
    label: 'Otro',
    cliente_sing: 'Cliente', cliente_plural: 'Clientes',
    // 'Puesto/Puestos' es EXACTAMENTE el default histórico de company_config: por eso los negocios que
    // ya existen quedan en 'otro' y no cambian ni una palabra de lo que ven hoy.
    puesto_sing: 'Puesto', puesto_plural: 'Puestos',
    servicios: [],   // sin catálogo a propósito: "Otro" no sabe a qué se dedica, y no se lo inventa
  },
];

export const OFICIO_IDS = OFICIOS.map(o => o.id);

export function esOficio(id) { return OFICIO_IDS.includes(String(id || '')); }
// Cualquier cosa rara (vacío, texto libre, un oficio que ya no existe) → 'otro'. Nunca lanza.
export function normalizaOficio(x) {
  const id = String(x == null ? '' : x).trim().toLowerCase();
  return esOficio(id) ? id : OFICIO_DEFECTO;
}
export function oficioPorId(id) {
  return OFICIOS.find(o => o.id === normalizaOficio(id));
}

// El oficio del negocio. Tolerante a fallo: un tenant que aún no ha corrido la migración responde
// 'otro' (que es exactamente lo que ve hoy), nunca un error.
export function oficioDe(db) {
  try {
    return normalizaOficio(db.prepare('SELECT oficio FROM company_config WHERE id=1').get()?.oficio);
  } catch { return OFICIO_DEFECTO; }
}

// ── EL ÚNICO SITIO QUE RESUELVE PALABRAS DE PANTALLA ──────────────────────────────────────────────
// Lo llaman ajustesCitas() (pantallas) y layout.js (menú). Una fuente, un canal.
// Precedencia de los puestos: manda SIEMPRE lo guardado en company_config (es lo que el dueño eligió
// en Ajustes de citas). El oficio solo pone el arranque, y solo cuando se escribe (ver puestoDeOficio).
export function vocabulario(db) {
  const of = oficioPorId(oficioDe(db));
  let cfg = {};
  try { cfg = db.prepare('SELECT cita_puesto_sing, cita_puesto_plural FROM company_config WHERE id=1').get() || {}; } catch { cfg = {}; }
  return {
    oficio: of.id,
    oficio_label: of.label,
    cliente_sing: of.cliente_sing,
    cliente_plural: of.cliente_plural,
    usa_proyectos: of.usa_proyectos !== false,
    puesto_sing: (cfg.cita_puesto_sing || '').trim() || of.puesto_sing,
    puesto_plural: (cfg.cita_puesto_plural || '').trim() || of.puesto_plural,
  };
}

// ¿La forma de llamar a los puestos sigue siendo de fábrica, o el dueño la escribió a mano?
// Es de fábrica si coincide con la de ALGÚN oficio (y 'Puesto/Puestos' es la de 'otro', así que el
// default histórico también cuenta). Sirve para que al cambiar de oficio las palabras SIGAN al oficio
// nuevo cuando nadie las había tocado, y NO se pisen cuando sí.
export function puestoEsDeFabrica(sing, plural) {
  const s = String(sing || '').trim().toLowerCase();
  const p = String(plural || '').trim().toLowerCase();
  if (!s && !p) return true;
  return OFICIOS.some(o => o.puesto_sing.toLowerCase() === s && o.puesto_plural.toLowerCase() === p);
}

// Escribe en company_config el oficio y, SOLO si los puestos estaban de fábrica, sus palabras.
// Idempotente. Devuelve el oficio normalizado que quedó guardado.
export function fijarOficio(db, oficioId) {
  const of = oficioPorId(oficioId);
  const cfg = db.prepare('SELECT cita_puesto_sing, cita_puesto_plural FROM company_config WHERE id=1').get() || {};
  if (puestoEsDeFabrica(cfg.cita_puesto_sing, cfg.cita_puesto_plural)) {
    db.prepare('UPDATE company_config SET oficio=?, cita_puesto_sing=?, cita_puesto_plural=? WHERE id=1')
      .run(of.id, of.puesto_sing, of.puesto_plural);
  } else {
    db.prepare('UPDATE company_config SET oficio=? WHERE id=1').run(of.id);
  }
  return of.id;
}

// ── CATÁLOGO DE ARRANQUE ──────────────────────────────────────────────────────────────────────────
export function catalogoDe(oficioId) {
  return oficioPorId(oficioId).servicios.map(s => ({ ...s }));
}

// Nombre comparable: sin tildes, sin mayúsculas, sin espacios de sobra.
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Los servicios del oficio que el negocio AÚN NO TIENE. Compara por nombre contra TODO el catálogo de
// productos (no solo los reservables ni solo los activos): si el negocio ya tiene "Corte caballero"
// —lo creara él o se lo sembráramos y luego lo editara— no se le duplica y no se le toca.
export function serviciosQueFaltan(db, oficioId) {
  const quiere = catalogoDe(oficioId);
  if (!quiere.length) return [];
  let tiene;
  try { tiene = new Set(db.prepare('SELECT name FROM products').all().map(r => norm(r.name))); }
  catch { return []; }   // sin catálogo que consultar, no sembramos nada a ciegas
  return quiere.filter(s => !tiene.has(norm(s.nombre)));
}

// Siembra SOLO lo que falta. NUNCA borra, NUNCA pisa, NUNCA archiva: lo que ya existe se queda como
// esté, editado o no. Es idempotente — llamarla dos veces no duplica nada.
//
// `crearProducto` llega como ARGUMENTO a propósito: importar routes/products.js aquí cerraría el
// círculo layout → oficios → products → layout. Es la misma createProductSvc que usa "Nuevo servicio".
export function sembrarCatalogo(db, oficioId, crearProducto) {
  const faltan = serviciosQueFaltan(db, oficioId);
  if (!faltan.length) return [];
  const insCfg = db.prepare(
    `INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min,updated_at)
     VALUES (?,1,?,0,0,0,CURRENT_TIMESTAMP)`
  );
  const creados = [];
  for (const s of faltan) {
    // Mismo camino que "Nuevo servicio" de la agenda: el servicio NACE como producto de catálogo
    // (fuente única). Precio 0 — las fuentes publican duraciones, no precios, y el precio es del negocio.
    const sku = (norm(s.nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)) || 'servicio';
    const prod = crearProducto(db, {
      name: s.nombre, sku, price: 0, tax_band: s.banda,
      type: 'service', status: 'active', stock: 0, tags: [],
    });
    insCfg.run(prod.id, s.duracion_min);
    creados.push({ id: prod.id, nombre: s.nombre, duracion_min: s.duracion_min });
  }
  return creados;
}
