// ════════════════════════════════════════════════════════════════════════════════════════════════
// PON EN MARCHA TU NEGOCIO — los pasos del arranque, DERIVADOS del estado real
//
// QUÉ ABSORBE. Aquí muere el checklist de U6 («Configura tu negocio»), no se duplica: sus tres pasos
// —datos de empresa, primer cliente, primera factura— y el del margen viven ahora dentro de estos
// tres bloques, con el mismo anillo de progreso y el mismo patrón de guía de DISA (qué · por qué ·
// cómo, en su voz). Lo que cambia es el alcance y el comportamiento, no el estilo.
//
// EL FALLO QUE VIENE A CERRAR. El panel de U6 y la rejilla del Inicio **competían**: mientras
// quedara un paso pendiente, la rejilla NO se pintaba (`${onboarding ? '' : …}`), y en cuanto se
// completaban, el panel desaparecía PARA SIEMPRE, sin manera de volver a verlo. Así que un negocio
// nuevo nunca veía su Inicio, y uno rodado no podía volver a los pasos que dejó a medias.
//
// LA REGLA QUE MANDA AQUÍ: **ningún paso se marca a mano.** Cada uno se deriva de un dato real que
// el negocio ya tiene —hay NIF, hay horario, hay servicios con precio y duración, la página de
// reservas está encendida—, y por eso no hay ninguna casilla que pulsar ni ninguna bandera que
// mantener. Una casilla que se marca sola no puede mentir; una que se marca a mano, sí, y entonces
// el panel deja de significar nada.
//
// Y LA SEGUNDA: **ningún paso se elimina por oficio.** Los que no aplican a este negocio bajan a
// «Más opciones», visibles y a un clic. Es la misma regla del menú desde el revert de julio y la
// misma de los chips de la ficha de cliente: se oculta lo que no usas, no se te quita.
import { usaAgenda } from './vigia-agenda.js';
import { hayHorarioNegocio } from './citas-engine.js';
import { vocabulario } from './oficios.js';
import { correoActivo } from './avisos-preferencias.js';
import { modoYaPreguntado } from './margen.js';
import { getLayoutRaw, setLayout } from './inicio-layout.js';

const cuenta = (db, sql, ...args) => { try { return db.prepare(sql).get(...args)?.n || 0; } catch { return 0; } };
const cfgDe = db => { try { return db.prepare('SELECT * FROM company_config WHERE id=1').get() || {}; } catch { return {}; } };

// ── ¿ESTE NEGOCIO TRABAJA CON CITAS? ────────────────────────────────────────────────────────────
// Se responde con lo que YA existe, sin inventar una bandera nueva (Paso 0.4):
//   · `usaAgenda(db)` — el ESTADO REAL: hay horario puesto o hay alguna cita. Si es que sí, manda
//     esto: nunca se le esconden los pasos de agenda a quien ya la está usando.
//   · `usa_proyectos` del perfil de oficio — la única bandera de capacidad que el perfil tiene hoy.
//     Los oficios que trabajan por proyectos (asesoría, «otro») no arrancan por la agenda; los que
//     atienden con cita (peluquería, estética, salud, taller) sí.
// Lo que sale de aquí NO elimina pasos: decide cuáles van arriba y cuáles a «Más opciones».
export function trabajaConCitas(db) {
  try { if (usaAgenda(db)) return true; } catch { /* sin esquema de agenda */ }
  try { return vocabulario(db).usa_proyectos !== true; } catch { return true; }
}

// ── EL ESTADO, PASO A PASO ───────────────────────────────────────────────────────────────────────
// Cada entrada es una pregunta con respuesta sí/no sacada de la base. Ni una bandera a mano.
export function estadoArranque(db) {
  const cfg = cfgDe(db);
  const s = {};
  // Para poder facturar
  s.fiscal = !!(cfg.fiscal_id && String(cfg.fiscal_id).trim());
  // El aspecto: basta con que haya logo O que haya cambiado el nombre del documento. Es un paso de
  // presentación, no de legalidad: no se exige más de lo que hace falta para que la factura no
  // salga anónima.
  // EL LOGO SE MIRA DONDE SE GUARDA. Aquí solo se miraba `logo_url`, que es la columna VIEJA (una
  // dirección de imagen escrita a mano); desde que se puede SUBIR el fichero, el logo vive en
  // `company_config.company_logo_id`, que apunta al adjunto. Resultado: subías el logo, se guardaba
  // bien, y el panel de arranque seguía diciendo que faltaba. Es el fallo que avisó el dueño el 24
  // ago 2026, y era el ÚNICO de los once pasos que no se marcaba (los otros diez, comprobados uno a
  // uno haciéndolos de verdad). Se miran las DOS: la nueva y la de siempre.
  s.aspecto = !!(cfg.company_logo_id
                 || (cfg.logo_url && String(cfg.logo_url).trim())
                 || (cfg.document_name && String(cfg.document_name).trim() && cfg.document_name !== 'Factura'));
  // Para empezar a trabajar
  s.migracion = cuenta(db, 'SELECT COUNT(*) n FROM migracion_peticiones WHERE active=1') > 0;
  s.cliente = cuenta(db, 'SELECT COUNT(*) n FROM clients') > 0;
  s.servicios = cuenta(db,
    `SELECT COUNT(*) n FROM service_config sc JOIN products p ON p.id = sc.product_id
      WHERE sc.duracion_min > 0 AND p.price > 0`) > 0;
  s.horario = (() => { try { return hayHorarioNegocio(db); } catch { return false; } })();
  s.equipo = cuenta(db, 'SELECT COUNT(*) n FROM admin_users WHERE active=1') > 1;
  s.margen = (() => { try { return modoYaPreguntado(db); } catch { return false; } })();
  // Para que el negocio ande solo
  s.reservas = !!cfg.cita_pub_activa;
  s.recordatorios = (() => { try { return correoActivo(db, 'recordatorio_cita'); } catch { return false; } })();
  s.factura = cuenta(db, 'SELECT COUNT(*) n FROM invoices') > 0;
  return s;
}

// ── LOS PASOS ────────────────────────────────────────────────────────────────────────────────────
// `agenda:true` marca los que solo tienen sentido en un negocio que atiende con cita. `guia` es la
// voz de DISA: qué es, por qué importa y qué va a pasar al pulsar — el mismo patrón de U6.
// `destino` tiene que EXISTIR: un paso cuyo destino no responde no se pinta (ver `pasosDe`), porque
// un enlace a un 404 en la primera pantalla que ve un dueño es peor que no ofrecer el paso.
export const BLOQUES = [
  {
    key: 'facturar', titulo: 'Para poder facturar',
    sub: 'Lo mínimo para que tu primera factura salga legal y con tu cara.',
    pasos: [
      { key: 'fiscal', label: 'Tus datos fiscales', icon: 'ti-id', time: '~1 min',
        href: '/admin/settings', cta: 'Ir a mis datos',
        guia: 'Necesito tu <b>NIF</b> y tu <b>tipo de IRPF</b> para que tus facturas salgan legales y con los importes exactos desde la primera. Añade también el <b>nombre fiscal</b>, que aparece en cada documento. En cuanto guardes, este paso se marca solo.' },
      { key: 'aspecto', label: 'El aspecto de tus facturas', icon: 'ti-photo', time: '~1 min',
        href: '/admin/settings', cta: 'Poner mi logo',
        guia: 'Tu <b>logo</b> y cómo se llama tu documento («Factura», «Presupuesto»…). No cambia nada legal: cambia que tu cliente reciba algo con tu cara en vez de un papel anónimo.' },
    ],
  },
  {
    key: 'trabajar', titulo: 'Para empezar a trabajar',
    sub: 'Traer lo tuyo y dejar montado lo que vendes.',
    pasos: [
      { key: 'migracion', label: 'Trae tus datos del programa anterior', icon: 'ti-file-import', time: '~3 min',
        href: '/admin/migracion', cta: 'Pedir la migración',
        guia: 'Si vienes de otro programa, <b>no vuelvas a teclear nada</b>: dinos de dónde vienes y qué quieres traer, y <b>lo migra el equipo de Bamburu, gratis</b>. Sube el fichero si ya lo tienes; si no, te decimos cómo sacarlo.' },
      { key: 'cliente', label: 'Tu primer cliente', icon: 'ti-user-plus', time: '~1 min',
        href: '/admin/clients?nuevo=1', cta: 'Crear cliente',
        guia: 'Un cliente es <b>a quién le facturas</b>: su nombre y su NIF, y si quieres su email para enviarle las facturas. Con uno basta para arrancar; los demás los añades cuando los necesites.' },
      { key: 'servicios', label: 'Tus servicios, con precio y duración', icon: 'ti-clock-hour-4', time: '~3 min',
        href: '/admin/citas/servicios', cta: 'Poner duraciones', agenda: true,
        guia: 'Cuánto <b>cuesta</b> y cuánto <b>dura</b> cada cosa que haces. Con eso puedo cuadrar tu agenda sola, decirte qué huecos te quedan y dejar que tus clientes reserven sin llamarte.' },
      { key: 'horario', label: 'Cuándo abres', icon: 'ti-calendar-time', time: '~2 min',
        href: '/admin/citas/horarios', cta: 'Poner mi horario', agenda: true,
        guia: 'Tus horas de verdad, día a día. <b>Mientras no lo pongas, el motor da por abierto de 8 a 21 todos los días</b> — y con eso las horas libres que te digo no significan nada.' },
      { key: 'equipo', label: 'Tu equipo', icon: 'ti-users', time: '~2 min',
        href: '/admin/users', cta: 'Añadir a alguien',
        guia: 'Si trabaja alguien más contigo, dale su acceso: cada uno ve <b>solo lo suyo</b> y las citas se reparten por persona. Si trabajas solo, este paso no te hace falta.' },
      { key: 'margen', label: 'Cómo cuentas tu margen', icon: 'ti-percentage', time: '~20 s',
        href: '/admin/settings', cta: 'Elegir', margen: true,
        guia: 'Hay dos formas de decir lo mismo y las dos son correctas: contar lo que ganas <b>sobre lo que cobras</b> o <b>sobre lo que te costó</b>. Elige cuál quieres ver primero; los dos números se calculan igual y puedes cambiarlo cuando quieras.' },
    ],
  },
  {
    key: 'solo', titulo: 'Para que el negocio ande solo',
    sub: 'Lo que hace el trabajo por ti cuando tú no estás mirando.',
    pasos: [
      { key: 'reservas', label: 'Enciende tu página de reservas', icon: 'ti-world', time: '~2 min',
        href: '/admin/citas/publica', cta: 'Encenderla', agenda: true,
        guia: 'Una dirección propia donde tus clientes <b>piden cita solos</b>, a la hora que sea, sin llamarte. Solo ofrece los huecos que de verdad tienes: sale de tu horario y de tus servicios.' },
      { key: 'recordatorios', label: 'Recordatorios a tus clientes', icon: 'ti-send', time: '~1 min',
        href: '/admin/settings/avisos', cta: 'Encenderlos', agenda: true,
        guia: 'Un correo el día antes de la cita, <b>sin que tú hagas nada</b>. Es lo que más plantones evita. Se apaga cuando quieras desde la misma pantalla.' },
      { key: 'factura', label: 'Tu primera factura', icon: 'ti-file-invoice', time: '~2 min',
        href: '/admin/invoices/new', cta: 'Emitir factura',
        guia: 'Aquí nace tu <b>primer documento legal</b>. Eliges cliente, añades una línea y emites; del resto me encargo yo: numeración, IVA/IRPF y la <b>huella Verifactu</b>.' },
    ],
  },
];

// ── LA LISTA QUE LE TOCA A ESTE NEGOCIO ─────────────────────────────────────────────────────────
// `existe(href)` lo aporta quien llama (la ruta sabe qué rutas hay montadas): un paso cuyo destino
// no existe NO SE PINTA. Ni un enlace a un 404.
export function pasosDe(db, { existe = () => true } = {}) {
  const s = estadoArranque(db);
  const conCitas = trabajaConCitas(db);
  const bloques = [], extra = [];
  let total = 0, hechos = 0;
  for (const b of BLOQUES) {
    const vivos = [];
    for (const p of b.pasos) {
      if (!existe(p.href)) continue;                       // destino que no existe → no se ofrece
      const paso = { ...p, done: !!s[p.key], bloque: b.key, bloqueTitulo: b.titulo };
      total++; if (paso.done) hechos++;
      // Los de agenda en un negocio que no trabaja con citas NO se eliminan: bajan a «Más opciones».
      if (p.agenda && !conCitas) extra.push({ ...paso, porque: 'En tu oficio no se suele trabajar con cita previa' });
      else vivos.push(paso);
    }
    if (vivos.length) bloques.push({ key: b.key, titulo: b.titulo, sub: b.sub, pasos: vivos });
  }
  return { bloques, extra, total, hechos, completo: total > 0 && hechos === total, conCitas };
}

// ── ¿ESTE NEGOCIO YA ANDA? ──────────────────────────────────────────────────────────────────────
// «Actividad real» = ha facturado alguna vez O tiene alguna cita. Es la pregunta que decide si el
// panel de arranque manda en la pantalla o se aparta: a un negocio que ya factura, el Inicio tiene
// que enseñarle SUS NÚMEROS, no sus deberes. A uno que aún no ha hecho nada, al revés.
//
// Se responde con datos que ya existen —ni una bandera nueva, ni una tabla nueva—, y tolera que el
// esquema de agenda no esté todavía (un tenant recién creado). Un negocio a medio montar no tiene
// ninguna de las dos cosas, así que la respuesta es «no» y el panel nace abierto.
export function hayActividad(db) {
  if (cuenta(db, 'SELECT COUNT(*) n FROM invoices') > 0) return true;
  return cuenta(db, 'SELECT COUNT(*) n FROM citas WHERE archived=0') > 0;
}

// ── PLEGADO: SE RECUERDA POR USUARIO ────────────────────────────────────────────────────────────
// El panel NUNCA desaparece: se pliega en una línea y sigue ahí, y se puede plegar y desplegar a
// mano cuando se quiera. La preferencia es de la PERSONA, no del negocio —dos socios pueden querer
// cosas distintas—, y se guarda en `dashboard_layouts`, la misma tabla que ya guarda las
// preferencias de usuario del Inicio y del menú. No nace una tabla para recordar un pliegue.
//
// QUÉ CAMBIA CON EL CUADRO DE MANDO: el pliegue POR DEFECTO ya no depende de si los pasos están
// todos hechos, sino de si el negocio TIENE ACTIVIDAD REAL. Antes, un negocio que llevaba un año
// facturando pero al que le faltaba encender los recordatorios abría su Inicio con la lista de
// deberes desplegada por delante de sus cifras. El criterio bueno no es «te falta un paso», es
// «¿esto ya anda?».
const scopeArranque = userId => 'arranque:usuario:' + Number(userId);

export function plegadoDeUsuario(db, userId, porDefecto) {
  const def = !!porDefecto;
  if (!db || !userId) return def;
  try {
    const g = getLayoutRaw(db, scopeArranque(userId));
    // Sin preferencia guardada manda el defecto; con preferencia manda SIEMPRE la persona.
    if (!g || typeof g !== 'object' || Array.isArray(g) || typeof g.plegado !== 'boolean') return def;
    return g.plegado;
  } catch { return def; }
}

export function guardarPlegado(db, userId, plegado) {
  setLayout(db, scopeArranque(userId), { plegado: !!plegado }, userId);
  return { plegado: !!plegado };
}
