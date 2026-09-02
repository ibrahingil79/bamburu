#!/usr/bin/env node
//
// test-suscripcion.mjs — La comprobación de `suscripcion-plan-y-alta`.
//
// QUÉ MIDE, Y CONTRA QUÉ. Los cinco criterios de aceptación del tablero, uno a uno y nombrados, más
// las trampas que este repo ya se ha comido antes.
//
// NO TOCA NADA DE PRODUCCIÓN. Se fabrica una `control.db` de usar y tirar en un directorio temporal
// y se hace `chdir` ANTES de importar nada —`core/control-db.js` resuelve su ruta con
// `process.cwd()` en el momento del import, así que el orden importa y no es casual—. Todo lo que
// crea se borra en el `finally`, pase, falle o reviente: regla de `CLAUDE.md`, y aquí es fácil
// cumplirla porque lo que crea es un directorio entero.
//
// NO LLAMA A STRIPE. Ni una petición de red. Lo que se prueba es lo que decide: el precio, el IVA,
// el prorrateo, la prueba de 15 días y los estados. Lo que Stripe hace con una tarjeta es de Stripe.

import { mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let ok = 0, mal = 0;
const P = t => process.stdout.write(t + '\n');
function check(nombre, condicion, detalle = '') {
  if (condicion) { ok += 1; P(`  ✓ ${nombre}`); }
  else { mal += 1; P(`  ✗ ${nombre}${detalle ? '\n      ' + String(detalle).slice(0, 400) : ''}`); }
}

const tmp = mkdtempSync(path.join(tmpdir(), 'susc-test-'));
try {
  mkdirSync(path.join(tmp, 'data'), { recursive: true });
  process.chdir(tmp);

  const { controlDb, initControlDb, createTenant } = await import(path.join(RAIZ, 'core/control-db.js'));
  initControlDb();
  const plan = await import(path.join(RAIZ, 'core/plan.js'));
  const susc = await import(path.join(RAIZ, 'core/suscripcion.js'));

  // ── CRITERIO 1 · «Un plan único de 9,90 €/mes, y el precio vive en un solo sitio configurable» ──
  P('\n[criterio 1] El plan y su precio');
  check('el precio base es 990 céntimos (9,90 €)', plan.precioBaseCentimos() === 990, plan.precioBaseCentimos());
  check('el IVA es del 21 %', plan.ivaPorcentaje() === 21);
  check('el IVA de 9,90 € son 2,08 €', plan.ivaDe(990) === 208, plan.ivaDe(990));
  check('el total cobrado son 11,98 € (decisión de Ibrahin del 2 sep)', plan.totalConIvaCentimos(990) === 1198, plan.totalConIvaCentimos(990));
  check('el texto que se anuncia es «9,90 €/mes + IVA»', plan.textoPrecio() === '9,90 €/mes + IVA', plan.textoPrecio());
  check('el desglose separa base, IVA y total',
    plan.desglose().base === '9,90 €' && plan.desglose().iva === '2,08 €' && plan.desglose().total === '11,98 €',
    JSON.stringify(plan.desglose()));

  // Configurable de verdad: se cambia el ajuste y TODO se mueve con él, sin reiniciar.
  controlDb.prepare("INSERT INTO settings (key,value) VALUES ('suscripcion_precio_base_centimos','1500') ON CONFLICT(key) DO UPDATE SET value='1500'").run();
  check('cambiar el ajuste mueve el precio (15,00 €) sin reiniciar', plan.textoPrecio() === '15,00 €/mes + IVA', plan.textoPrecio());
  check('y mueve el total cobrado (18,15 €)', plan.desglose().total === '18,15 €', plan.desglose().total);
  controlDb.prepare("DELETE FROM settings WHERE key='suscripcion_precio_base_centimos'").run();
  check('quitado el ajuste, vuelve solo a 9,90 €', plan.textoPrecio() === '9,90 €/mes + IVA');
  controlDb.prepare("INSERT INTO settings (key,value) VALUES ('suscripcion_precio_base_centimos','no-es-un-numero') ON CONFLICT(key) DO UPDATE SET value='no-es-un-numero'").run();
  check('un ajuste corrupto NO deja al producto sin precio', plan.precioBaseCentimos() === 990, plan.precioBaseCentimos());
  controlDb.prepare("DELETE FROM settings WHERE key='suscripcion_precio_base_centimos'").run();

  // EL PRECIO NO SE REPITE POR EL CÓDIGO. Es la mitad del criterio que se olvida: tener un módulo de
  // precio no sirve de nada si una pantalla escribe "9,90" a mano.
  const SUELTOS = [];
  (function barrer(dir) {
    for (const e of readdirSync(dir)) {
      if (['node_modules', '.git', 'data', 'public', 'docs', 'logs'].includes(e)) continue;
      const f = path.join(dir, e);
      const st = statSync(f);
      if (st.isDirectory()) { barrer(f); continue; }
      if (!/\.(js|mjs)$/.test(e)) continue;
      // El precio vive en `core/plan.js`. Y los GUIONES DE COMPROBACIÓN quedan fuera, con la misma
      // distinción —y por el mismo motivo— que ya hace `cli.guionesDeComprobacion` del orquestador
      // con los `console.log`: un gate tiene que afirmar contra el literal esperado. Si comprobara
      // contra `textoPrecio()` se volvería tautológico y dejaría de cazar el día en que alguien
      // cambie el precio por defecto sin querer, que es exactamente lo que viene a cazar.
      // En el PRODUCTO la regla se queda igual de dura: aquí no se exime ni un fichero de `modules/`
      // ni de `core/`, y `scripts/` solo se exime si el NOMBRE dice que es una comprobación.
      if (f.endsWith('core/plan.js')) continue;
      if (/(^|\/)(gate|verify|test|censo|lint)-[^/]*\.(mjs|js)$/.test(f)) continue;
      const txt = readFileSync(f, 'utf8');
      txt.split('\n').forEach((l, i) => {
        if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
        if (/9[,.]90\s*€|\b990\b\s*\/\/\s*c[eé]ntimos|'9,90'|"9,90"/.test(l)) {
          SUELTOS.push(`${path.relative(RAIZ, f)}:${i + 1}  ${l.trim().slice(0, 90)}`);
        }
      });
    }
  })(RAIZ);
  check('el precio NO está escrito a mano en ningún otro fichero', SUELTOS.length === 0, SUELTOS.join('\n      '));

  // ── CRITERIO 2 · «15 días de prueba gratis SIN pedirle tarjeta» ────────────────────────────────
  P('\n[criterio 2] La prueba de 15 días, sin tarjeta');
  check('el plan declara 15 días de prueba', plan.diasDePrueba() === 15);
  const t1 = createTenant({ name: 'Prueba Uno', slug: 'prueba-uno', db_filename: 'p1.db' });
  const s1 = susc.suscripcionDe(t1.id);
  check('un negocio nuevo nace con suscripción sembrada', !!s1, 'no se sembró ninguna fila');
  check('nace en estado «prueba»', s1?.estado === 'prueba', s1?.estado);
  check('nace SIN tarjeta', !s1?.stripe_metodo_pago_id && !s1?.tarjeta_ultimos4);
  check('la prueba dura exactamente 15 días', susc.diasEntre(s1.prueba_inicio, s1.prueba_fin) === 15,
    `${s1.prueba_inicio} → ${s1.prueba_fin}`);
  // Las dos vías de siembra —`createTenant` y la migración— tienen que dar la MISMA fila.
  controlDb.prepare('DELETE FROM tenant_suscripciones WHERE tenant_id = ?').run(t1.id);
  initControlDb();
  const s1b = susc.suscripcionDe(t1.id);
  check('la siembra de la migración da la misma fila que el alta',
    s1b?.estado === s1.estado && susc.diasEntre(s1b.prueba_inicio, s1b.prueba_fin) === 15);
  const antes = JSON.stringify(susc.suscripcionDe(t1.id));
  susc.asegurarSuscripcion(t1.id); initControlDb();
  check('volver a sembrar NO reinicia la prueba de nadie', JSON.stringify(susc.suscripcionDe(t1.id)) === antes);

  // ── CRITERIO 3 · «la parte proporcional hasta el día 5 siguiente» ──────────────────────────────
  P('\n[criterio 3] El prorrateo hasta el día 5');
  check('el día de cobro es el 5', plan.diaDeCobro() === 5);
  const a = susc.prorrateo('2026-09-20');
  check('del 20 de septiembre, el periodo acaba el 5 de octubre', a.hasta === '2026-10-05', a.hasta);
  check('son 15 días de un ciclo de 30', a.dias_periodo === 15 && a.dias_ciclo === 30, `${a.dias_periodo}/${a.dias_ciclo}`);
  check('medio ciclo cuesta la mitad: 4,95 € + IVA', a.base === '4,95 €' && a.total === '5,99 €', JSON.stringify(a));
  const b = susc.prorrateo('2026-09-05');
  check('empezar EL DÍA 5 no da un periodo de cero días', b.dias_periodo > 0, b.dias_periodo);
  check('empezar el día 5 es un mes completo', b.es_mes_completo && b.total === '11,98 €', JSON.stringify(b));
  // El ciclo REAL, no "30 días fijos": febrero tiene 28 y julio 31, y medio mes debe costar medio mes.
  const feb = susc.prorrateo('2026-02-19');
  check('en febrero el ciclo es de 28 días, no de 30', feb.dias_ciclo === 28, feb.dias_ciclo);
  check('y medio febrero sigue costando la mitad', feb.dias_periodo === 14 && feb.base === '4,95 €', JSON.stringify(feb));
  const jul = susc.prorrateo('2026-07-20');
  check('en julio el ciclo es de 31 días', jul.dias_ciclo === 31, jul.dias_ciclo);
  check('el IVA se calcula SOBRE LA BASE YA PRORRATEADA', susc.prorrateo('2026-09-20').iva_centimos === plan.ivaDe(495));
  check('diciembre cruza de año correctamente', susc.prorrateo('2026-12-20').hasta === '2027-01-05', susc.prorrateo('2026-12-20').hasta);

  // ── CRITERIO 5 · «el negocio ve en qué situación está» ─────────────────────────────────────────
  P('\n[criterio 5] La situación que ve el negocio');
  const hoy = susc.hoyISO();
  const e1 = susc.situacion(t1.id, { hoy });
  check('en prueba, se dice cuántos días quedan', e1.situacion === 'prueba' && e1.dias_restantes === 15, JSON.stringify(e1.titulo));
  check('en prueba, se le dice que no se le ha pedido tarjeta', /no te hemos pedido/i.test(e1.detalle), e1.detalle);
  const e2 = susc.situacion(t1.id, { hoy: susc.sumarDias(hoy, 20) });
  check('vencida la prueba, NO se le sigue diciendo que está de prueba', e2.situacion === 'prueba_terminada', e2.situacion);
  check('y no se le ha cobrado nada todavía', /no se te ha cobrado nada/i.test(e2.detalle), e2.detalle);
  susc.guardarSuscripcion(t1.id, { estado: 'al_corriente', proximo_cobro: susc.sumarDias(hoy, 10),
                                   tarjeta_marca: 'visa', tarjeta_ultimos4: '4242' });
  const e3 = susc.situacion(t1.id, { hoy });
  check('al corriente, se dice cuándo sale el próximo cobro', e3.situacion === 'al_corriente' && /próximo cobro/i.test(e3.detalle), e3.detalle);
  check('la tarjeta se enseña por sus CUATRO últimos dígitos', e3.tarjeta?.ultimos4 === '4242');
  susc.guardarSuscripcion(t1.id, { estado: 'pago_pendiente', ultimo_error: 'La tarjeta fue rechazada.' });
  const e4 = susc.situacion(t1.id, { hoy });
  check('con pago pendiente, se dice el motivo', e4.situacion === 'pago_pendiente' && /rechazada/.test(e4.detalle), e4.detalle);
  check('los tres estados del criterio existen y no hay inventados',
    JSON.stringify(susc.ESTADOS) === JSON.stringify(['prueba', 'al_corriente', 'pago_pendiente']), susc.ESTADOS);
  check('nunca se guarda un número de tarjeta completo',
    !Object.keys(susc.suscripcionDe(t1.id)).some(k => /numero|number|cvv|cvc|pan/i.test(k)),
    Object.keys(susc.suscripcionDe(t1.id)).join(','));

  // ── CRITERIO 4 · «con Stripe, como autónomo: no se exige ni se menciona ninguna sociedad» ──────
  P('\n[criterio 4] Con Stripe, y como autónomo');
  const pantalla = readFileSync(path.join(RAIZ, 'modules/erp/routes/suscripcion.js'), 'utf8');
  const soloComentarios = pantalla.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  check('la pantalla no pide ni menciona ninguna sociedad',
    !/sociedad|S\.L\.|razón social|CIF de empresa/i.test(soloComentarios),
    (soloComentarios.match(/.*(sociedad|S\.L\.|razón social).*/i) || [''])[0]);
  const stripeMod = readFileSync(path.join(RAIZ, 'core/stripe.js'), 'utf8');
  check('el cerrojo del modo de prueba existe y rechaza claves reales', /sk_test_/.test(stripeMod) && /modoRealAutorizado/.test(stripeMod));
  const st = await import(path.join(RAIZ, 'core/stripe.js'));
  check('sin autorización, una clave sk_live_ NO se considera de prueba', !st.esClaveDePrueba('sk_live_abc'));
  check('el modo real NO está autorizado por defecto', st.modoRealAutorizado() === false);
  check('la firma del webhook se rechaza sin secreto', st.verificarFirmaWebhook('{}', 't=1,v1=x', null).ok === false);
  // 2 SEP 2026 — Managed Payments. Stripe lo activa POR DEFECTO en las cuentas nuevas y eso hace que
  // `mode: setup` sea RECHAZADO. Se apaga por petición, no en el panel: el dueño no tiene que ir a
  // marcar una casilla en otra web para que su programa funcione. Las dos mitades tienen que estar:
  // el interruptor, y el reintento sin él para una cuenta que no conozca el parámetro.
  check('el alta apaga Managed Payments en la propia petición', /managed_payments:\s*\{\s*enabled:\s*false\s*\}/.test(stripeMod));
  check('y reintenta sin el parámetro si la cuenta no lo conoce',
    /parameter_unknown/.test(stripeMod) && /startsWith\('managed_payments'\)/.test(stripeMod));
  check('el alta NO usa mode subscription (cobraría en el acto, con prueba viva)',
    !/mode:\s*'subscription'/.test(stripeMod));
  check('una firma con hora vieja se rechaza',
    st.verificarFirmaWebhook('{}', 't=1000,v1=deadbeef', 'secreto', { ahora: 9_999_999_000 }).ok === false);

  // ── Las trampas que este repo ya se ha comido ──────────────────────────────────────────────────
  P('\n[reglas del repo]');
  check('CERO ventanitas del navegador en la pantalla nueva',
    !/(^|[^.\w])(prompt|confirm|alert)\s*\(/m.test(soloComentarios),
    (soloComentarios.match(/.*(prompt|confirm|alert)\s*\(.*/) || [''])[0]);
  check('se usa el panel compartido (confirmarEnPagina)', /confirmarEnPagina/.test(pantalla));
  const idx = readFileSync(path.join(RAIZ, 'modules/erp/routes/index.js'), 'utf8');
  check('la pantalla está MONTADA (no es una ruta inventada)',
    /admin\.route\('\/suscripcion'/.test(idx) && /apiApp\.route\('\/suscripcion'/.test(idx));
  const menu = readFileSync(path.join(RAIZ, 'modules/erp/menu.js'), 'utf8');
  check('el menú la enseña SOLO al dueño', /suscripcion:\s*r => r === 'owner'/.test(menu));
  check('y la ruta también cierra por su cuenta (no solo el menú)', /function soloDueno/.test(pantalla));
  check('el webhook va ANTES del middleware de tenant',
    (() => { const i = readFileSync(path.join(RAIZ, 'index.js'), 'utf8');
             return i.indexOf("app.post('/stripe/webhook'") < i.indexOf("app.use('*', tenantMiddleware)"); })());
  check('el guion de un solo uso no pasa el secreto por la línea de comandos',
    (() => { const g = readFileSync(path.join(RAIZ, 'scripts/configurar-stripe.sh'), 'utf8');
             return /read -rsp/.test(g) && !/curl[^\n]*-H ["']Authorization: Bearer \$/.test(g); })());
  check('el cobro usa llave de idempotencia estable por PERIODO',
    /prorrateo-\$\{tenant\.id\}-\$\{pr\.desde\}-\$\{pr\.hasta\}/.test(readFileSync(path.join(RAIZ, 'core/suscripcion-cobro.js'), 'utf8')));
  check('la migración de control.db es aditiva (ni DROP ni DELETE de datos de tenant)',
    !/DROP TABLE|DROP COLUMN/i.test(readFileSync(path.join(RAIZ, 'core/control-db.js'), 'utf8')));

  // ── LOS TRES FALLOS QUE DESTAPÓ PULSAR EL BOTÓN (2 sep 2026) ──────────────────────────────────
  // Ninguno de los tres lo vio ninguna aserción de las de arriba, y los tres dejaban el alta MUERTA.
  // Van aquí para que no vuelvan sin que nadie se entere; la comprobación viva es
  // `gate-suscripcion-alta-real`, que necesita claves y se lanza a mano.
  P('\n[los tres fallos del 2 sep, para que no vuelvan]');
  const guard = readFileSync(path.join(RAIZ, 'core/tenant-middleware.js'), 'utf8');
  // 1 · El negocio al que se le pide regularizar era el único que NO podía regularizar: el
  //     readOnlyGuard bloqueaba el POST que abre el Checkout. La puerta de salida tiene que estar
  //     abierta, o el criterio del corte («se dice qué hay que hacer para volver») es imposible.
  check('un negocio en SOLO LECTURA puede llegar a pagar (la puerta de salida está abierta)',
    /'\/admin\/suscripcion'/.test(guard) && /'\/api\/erp\/suscripcion'/.test(guard),
    'readOnlyGuard no deja pasar las rutas de suscripción');
  check('y no se ha aflojado nada más del guardián',
    /'\/admin\/login'/.test(guard) && /method === 'GET'/.test(guard));
  // 2 · Una llave de idempotencia atada solo al negocio revienta en cuanto cambia un parámetro:
  //     «Keys for idempotent requests can only be used with the same parameters…», 24 h caído.
  // ⚙️ 2 SEP 2026 (noche): esta aserción exigía la forma literal `cliente-tenant-<id>-<huella>`. El
  // mismo fallo volvió a aparecer en la suscripción, así que la regla se sacó a `llaveIdempotente` y
  // la comprueba el bloque del cobro mensual, más abajo. Aquí queda lo que sigue importando: que la
  // llave del cliente NO sea solo el número del negocio.
  check('la llave de idempotencia del cliente lleva el CONTENIDO dentro, no solo el negocio',
    /llaveIdempotente\(`cliente-tenant-\$\{tenantId\}`, params\)/.test(stripeMod)
      && !/idempotencia: `cliente-tenant-\$\{tenantId\}`/.test(stripeMod));
  // 3 · `c.get('session').email` NO existe (core/auth.js no lo devuelve), así que el cliente de
  //     Stripe nacía sin correo y el Checkout se lo pedía al dueño.
  check('el correo del dueño se lee de la BD, no de un campo que la sesión no tiene',
    /SELECT email FROM admin_users WHERE id = \?/.test(pantalla) && !/session\)\?\.email/.test(pantalla));

  // ── EL COBRO MENSUAL (tarea `suscripcion-cobro-mensual`, 2 sep 2026) ─────────────────────────
  P('\n[cobro mensual] Lo que decide el producto, sin tocar Stripe');
  // ⚠️ LAS ASERCIONES EN NEGATIVO SE MIDEN SOBRE EL CÓDIGO, NO SOBRE LOS COMENTARIOS. Cuatro de las
  // de aquí abajo dieron rojo la primera vez porque casaban con el comentario que EXPLICA por qué
  // algo no se usa — «no se usa getTenantDb porque…» contiene `getTenantDb`. Un gate que se cree sus
  // propios comentarios mide la prosa, no el producto.
  const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter(l => !l.trim().startsWith('//')).join('\n');
  const mensual = readFileSync(path.join(RAIZ, 'core/suscripcion-mensual.js'), 'utf8');
  const mensualCod = sinComentarios(mensual);
  const cobroMod = readFileSync(path.join(RAIZ, 'core/suscripcion-cobro.js'), 'utf8');
  const idx2 = readFileSync(path.join(RAIZ, 'index.js'), 'utf8');

  // El fallo de UN MES: `pr.hasta` YA es el día 5, y pasarlo por `siguienteDiaDeCobro` (que es
  // estricto) anclaba al mes siguiente. El negocio habría pasado un mes sin que se le facturara.
  check('el ancla se pasa YA RESUELTA, no recalculada desde el día de hoy',
    /ancla: pr\.hasta/.test(cobroMod) && /const fechaAncla = ancla \|\|/.test(mensual),
    'si se recalcula, el primer cobro se va un mes');
  check('la suscripción se abre con proration_behavior none (no cobra dos veces)',
    /proration_behavior: 'none'/.test(stripeMod));
  check('y anclada con billing_cycle_anchor, no con un calendario de meses a mano',
    /billing_cycle_anchor/.test(stripeMod) && !/febrero|dias_del_mes\[/.test(sinComentarios(stripeMod)));
  check('el IVA va como tax_rate aparte, para que la factura lo desglose',
    /tax_behavior: 'exclusive'/.test(stripeMod) && /default_tax_rates/.test(stripeMod));

  // La llave de idempotencia: el mismo fallo apareció DOS veces el mismo día (cliente y
  // suscripción). Ahora la regla vive en una función y se usa en todas menos en la del cobro, que
  // es la excepción legítima y está dicha.
  check('la regla de la llave de idempotencia vive en UNA función',
    /export function llaveIdempotente/.test(stripeMod));
  check('y la usan todas las creaciones menos la del cobro, que es la excepción dicha',
    (stripeMod.match(/llaveIdempotente\(/g) || []).length >= 5
      && /ÚNICA LLAVE DEL FICHERO QUE \*\*NO\*\* PASA POR/.test(stripeMod),
    (stripeMod.match(/llaveIdempotente\(/g) || []).length + ' usos');

  // Leer un correo no puede migrar la base de un negocio ni fabricar una vacía.
  check('el correo del dueño se lee SIN getTenantDb (que abre para escribir y migra)',
    !/getTenantDb/.test(mensualCod), 'getTenantDb en el CÓDIGO de suscripcion-mensual.js');
  check('y con fileMustExist, para no CREAR la base que no encuentre',
    /fileMustExist: true/.test(mensual) && /readonly: true/.test(mensual));

  // Un guion que mueve algo no lo mueve por defecto — y mandar un correo a un cliente es moverlo.
  check('en simulacro NO se manda ningún correo', /if \(simulacro\) return \{ enviado: false/.test(mensual));
  check('un fallo del correo no mata la pasada (el constructor de Resend SÍ lanza)',
    /catch \(e\) \{\s*return \{ enviado: false, motivo: 'fallo_al_enviar'/.test(mensual));
  check('no se avisa dos veces del mismo cobro', /aviso_de_factura === cargo\.factura_id/.test(mensual));
  check('se avisa 7 días antes, y el número vive en un solo sitio',
    /export const DIAS_DE_AVISO = 7/.test(mensual)
      && !/faltan !== 7|=== 7\b/.test(mensualCod.replace('DIAS_DE_AVISO = 7', '')),
    'el 7 tiene que salir de DIAS_DE_AVISO, no escrito otra vez');

  // El webhook: los tres eventos de suscripción, y el impago SIN adelantar la tarea siguiente.
  check('el webhook escucha invoice.upcoming, invoice.paid e invoice.payment_failed',
    /invoice\.upcoming/.test(idx2) && /invoice\.paid/.test(idx2) && /invoice\.payment_failed/.test(idx2));
  check('un cobro correcto NO manda ningún correo', !/sendEmail|enviarAviso/.test(
    idx2.slice(idx2.indexOf("evento.type === 'invoice.paid'"), idx2.indexOf("evento.type === 'invoice.payment_failed'"))));
  // ⚙️ 2 SEP 2026 (noche): esta aserción decía «el corte es la tarea siguiente». Ya no lo es: es
  // ESTA. Lo que sigue siendo cierto —y es lo que ahora se comprueba— es que el webhook **abre el
  // episodio y no corta**: cortar en el acto, sin los 30 días de avisos, es justo lo que el dueño
  // pidió no hacer. El corte lo decide la pasada diaria, por calendario.
  const tramoFallido = sinComentarios(
    idx2.slice(idx2.indexOf("evento.type === 'invoice.payment_failed'"), idx2.indexOf("evento.type === 'customer.subscription.deleted'")));
  check('un cobro fallido abre el episodio y NO corta en el acto',
    /registrarFalloDeCobro/.test(tramoFallido) && !/setTenantStatus|suspended_admin/i.test(tramoFallido),
    tramoFallido.slice(0, 250));

  // Cambiar de tarjeta: la nueva primero, la vieja después.
  // El aviso NO puede depender de que haya prorrateos pendientes: los avisos son de los negocios
  // que YA están al corriente, que son justo los que no salen en esa lista. Había un `return` seco.
  const pasada = readFileSync(path.join(RAIZ, 'scripts/suscripcion-cobros.mjs'), 'utf8');
  check('la pasada avisa aunque no haya ningún prorrateo pendiente',
    (pasada.match(/await avisosPrevios\(\)/g) || []).length === 2,
    (pasada.match(/await avisosPrevios\(\)/g) || []).length + ' llamada(s): hace falta también en la salida temprana');

  check('al cambiar de tarjeta se pone la nueva ANTES de retirar la vieja',
    mensual.indexOf('cambiarMetodoDeSuscripcion') < mensual.indexOf('desasociarMetodo'));

  // ── EL IMPAGO Y EL CORTE (tarea `suscripcion-impago-y-corte`, 2 sep 2026) ────────────────────
  P('\n[impago y corte]');
  const impago = readFileSync(path.join(RAIZ, 'core/suscripcion-impago.js'), 'utf8');
  const impagoCod = sinComentarios(impago);
  const guardCod = sinComentarios(guard);
  const situacionMod = readFileSync(path.join(RAIZ, 'core/suscripcion.js'), 'utf8');
  const layoutMod = readFileSync(path.join(RAIZ, 'modules/erp/layout.js'), 'utf8');

  check('el corte es a los 30 días y el número vive en un solo sitio',
    /export const DIAS_HASTA_EL_CORTE = 30/.test(impago) && !/\b30\b/.test(impagoCod.replace('DIAS_HASTA_EL_CORTE = 30', '')),
    'el 30 tiene que salir de la constante');
  check('hay CINCO escalones distintos, no un mensaje repetido',
    (impago.match(/clave: '/g) || []).length === 5);
  check('un reintento fallido NO reinicia el reloj del corte',
    /if \(s\.impago_desde\) \{/.test(impagoCod), 'sin esto el corte se aleja solo y no llega nunca');
  check('EL CORTE NO BORRA NADA: ni DELETE ni DROP en todo el módulo',
    !/DELETE FROM|DROP /i.test(impagoCod));
  check('el corte va ANTES del correo (si falla el correo, la cuenta ya está cortada)',
    impagoCod.indexOf("esc.clave === 'corte'") < impagoCod.indexOf('await enviar('));
  check('pagar NO levanta una suspensión que puso otro',
    /cortado_por_impago/.test(impagoCod) && /estabaCortado/.test(impagoCod));
  check('los avisos no ofrecen descuento ni negocian el precio',
    !/descuento|oferta|rebaja|promoci[óo]n/i.test(impagoCod));

  // El corazón de la tarea: desde cortado SIEMPRE se puede pagar.
  check('desde una cuenta CORTADA se puede llegar a pagar (la puerta sigue abierta)',
    /'\/admin\/suscripcion'/.test(guardCod) && /'\/api\/erp\/suscripcion'/.test(guardCod),
    'readOnlyGuard tiene que dejar pasar la suscripción, o el corte no tiene salida');

  // Las dos contradicciones que solo se vieron mirando la pantalla.
  check('un negocio cortado NO se describe como «vuelve a intentarlo»',
    /situacion: 'cortado'/.test(situacionMod) && /cortado_por_impago === 1/.test(situacionMod));
  check('y no se le enseña un prorrateo cuando lo que debe es la cuota',
    /situacion === 'pago_pendiente' \|\| s\.situacion === 'cortado'/.test(pantalla));
  check('la franja de impago y la de corte son EXCLUYENTES, no salen las dos',
    /readOnly\s*\n?\s*\? `<div[^]*?: \(_imp/.test(layoutMod) || /readOnly[^]{0,400}: \(_imp/.test(layoutMod));
  check('las dos franjas llevan botón para arreglarlo', (layoutMod.match(/Arreglar mi pago/g) || []).length >= 1);
  check('la pasada corre las TRES fases al mismo nivel, sin anidarlas',
    (readFileSync(path.join(RAIZ, 'scripts/suscripcion-cobros.mjs'), 'utf8').match(/await cadenaDeImpago\(\)/g) || []).length === 2);

  // ── LOS 90 DÍAS Y LA BÓVEDA (tarea `suscripcion-datos-tras-el-corte`, 2 sep 2026) ─────────────
  P('\n[90 días y bóveda]');
  const datosMod = readFileSync(path.join(RAIZ, 'core/suscripcion-datos.js'), 'utf8');
  const datosCod = sinComentarios(datosMod);
  const expMod = readFileSync(path.join(RAIZ, 'modules/erp/exportacion.js'), 'utf8');
  const expCod = sinComentarios(expMod);
  const zipMod = readFileSync(path.join(RAIZ, 'core/zip.js'), 'utf8');

  check('la ventana dura 90 días y el número vive en un solo sitio',
    /export const DIAS_DE_DESCARGA = 90/.test(datosMod)
      && !/\b90\b/.test(datosCod.replace('DIAS_DE_DESCARGA = 90', '')),
    'el 90 tiene que salir de la constante');
  check('el reloj NO se reinicia al volver a abrir la ventana',
    /if \(s\.descarga_hasta\) return s;/.test(datosCod),
    'sin esto la ventana se alarga sola y los 90 días no llegan nunca');
  check('la ventana se abre EN EL CORTE, no cada día',
    /abrirVentanaDeDescarga\(fila\.tenant_id \?\? fila\.id, \{ db, desde: dia \}\)/.test(
      readFileSync(path.join(RAIZ, 'core/suscripcion-impago.js'), 'utf8')));

  // LA REGLA QUE MANDA: no se destruye información en ningún momento.
  check('el módulo de la bóveda no borra NADA', !/DELETE FROM|DROP /i.test(datosCod));
  check('y no MUEVE la base a ningún sitio: la bóveda es un estado, no un sitio',
    !/rename|copyFile|unlink|rmdir/i.test(datosCod));
  check('el exportador tampoco borra nada', !/DELETE FROM|DROP /i.test(expCod));

  // La copia: completa, comprobada, y que se abra.
  check('el paquete se contrasta con la base ANTES de entregarse',
    /descuadres\.length/.test(expCod) && /NO se entrega/.test(expMod));
  check('y el ZIP se vuelve a LEER entero antes de entregarlo',
    /verificarZip\(zip\)/.test(expCod) && /export function verificarZip/.test(zipMod));
  check('el verificador comprueba el CRC de cada fichero, no solo que haya bytes',
    /crc32\(contenido\) !== huella/.test(zipMod));
  check('los CSV llevan BOM y punto y coma (que es lo que abre Excel)',
    /'\\ufeff'|'﻿'/.test(expCod) && /\.join\(';'\)/.test(expCod));
  check('las credenciales NO viajan en la copia, y están declaradas',
    /admin_sessions/.test(expMod) && /password_hash/.test(expMod) && /TABLAS_FUERA/.test(expCod));
  check('y lo excluido se DICE en el LEEME (una omisión silenciosa es el fallo que esto evita)',
    /LO QUE NO ESTÁ AQUÍ/.test(expMod));

  // Los PDFs son caros: medido, 2,2 s cada uno en serie.
  check('las facturas en PDF se generan de varias en varias, no de una en una',
    /PDFS_A_LA_VEZ/.test(expCod) && /Promise\.all/.test(expCod));
  check('y hay UNA exportación a la vez en todo el servidor',
    /function enFila/.test(expCod) && /return enFila\(/.test(expCod));
  check('el PDF sale por el MISMO camino que el botón del producto',
    /buildInvoicePaper/.test(expCod) && /printableShell/.test(expCod));

  // Desde una cuenta cortada se puede DESCARGAR, igual que pagar.
  check('la descarga cuelga de /admin/suscripcion, que el guardián deja pasar',
    /views\.get\('\/descargar'/.test(pantalla) && /'\/admin\/suscripcion'/.test(guardCod));
  check('en la bóveda no se ofrece un botón de descarga que ya no funciona',
    /datos\.puede_descargar \?/.test(pantalla));
  check('la pasada diaria cierra las ventanas vencidas, en su propia fase',
    (pasada.match(/cerrarVentanasDeDescarga\(\)/g) || []).length === 3);
  // REMATE 2 SEP 2026: la espera de la copia recargaba la pantalla entera cada 15 s — once minutos
  // de parpadeo con el cliente delante. Ahora se pregunta por el estado y se repinta SOLO la tarjeta.
  const pantallaCod = sinComentarios(pantalla);
  check('la espera de la copia NO recarga la pantalla',
    !/location\.reload/.test(pantallaCod), (pantallaCod.match(/.*location\.reload.*/) || [''])[0]);
  check('se pregunta por el estado y se repinta solo la tarjeta',
    /suscripcion\/situacion/.test(pantallaCod) && /caja\.innerHTML/.test(pantallaCod));
  check('y solo se repinta cuando el estado CAMBIA (repintar siempre también parpadea)',
    /nuevo !== caja\.dataset\.estado/.test(pantallaCod));

  check('el correo del corte dice los 90 días y qué pasa después',
    /DÍAS PARA LLEVARTE TODO LO TUYO/.test(readFileSync(path.join(RAIZ, 'core/suscripcion-impago.js'), 'utf8')));

  // ── LA LLAVE ANTI-COBROS-DUPLICADOS SE CONSTRUYE EN UN SOLO SITIO ────────────────────────────
  //
  // REMATE DEL BLOQUE 1 (2 sep 2026, a petición de Ibrahin). Este fallo salió CUATRO VECES el mismo
  // día, siempre igual: alguien —yo— escribe la llave de idempotencia a mano, y en cuanto cambia un
  // parámetro Stripe la rechaza 24 h con «Keys for idempotent requests can only be used with the
  // same parameters they were first used with». Cada vez se arreglaba en el punto de llamada, y cada
  // vez volvía en el siguiente. La regla no puede vivir en quien llama, porque quien llama se
  // olvida: vive en `llaveIdempotente`, y esto lo vigila.
  //
  // Mismo patrón que la comprobación del precio de más arriba: se barre el árbol y se exige que
  // TODA `idempotencia:` salga de esa función. Las excepciones se declaran aquí, con su motivo — no
  // se permiten en silencio.
  P('\n[la llave de idempotencia, en un solo sitio]');
  const IDEMPOTENCIA_A_MANO_DECLARADA = {
    // La identidad de este cobro ES su periodo, y por eso su llave NO lleva el contenido: si el
    // importe cambiara por un error de cálculo, meterlo en la llave haría que el segundo intento
    // cobrara OTRA VEZ en vez de chocar. Es la única, y está dicha también en `core/stripe.js`.
    "core/stripe.js|}, { idempotencia: referencia });":
      'el cobro del prorrateo: su identidad es el PERIODO, no el contenido',
  };

  const aMano = [];
  (function barrerLlaves(dir) {
    for (const e of readdirSync(dir)) {
      if (['node_modules', '.git', 'data', 'public', 'docs', 'logs', '.orquestador'].includes(e)) continue;
      const f = path.join(dir, e);
      const st = statSync(f);
      if (st.isDirectory()) { barrerLlaves(f); continue; }
      if (!/\.(js|mjs)$/.test(e)) continue;
      // Los guiones de comprobación quedan fuera, igual que en el barrido del precio y por el mismo
      // motivo: un gate NOMBRA la forma prohibida para poder exigirla, y cazarse a sí mismo sería
      // medir la prosa. En el producto la regla se queda igual de dura.
      if (/(^|\/)(gate|verify|test|censo|lint)-[^/]*\.(mjs|js)$/.test(f)) continue;
      const rel = path.relative(RAIZ, f);
      sinComentarios(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => {
        if (!/\bidempotencia\s*:/.test(l)) return;
        // Vale con o sin prefijo de módulo: `llaveIdempotente(...)` y `stripe.llaveIdempotente(...)`
        // son la misma puerta. Sin esto, la forma correcta del rescate salía marcada como fallo.
        if (/idempotencia\s*:\s*(?:[A-Za-z_$][\w$]*\.)?llaveIdempotente\(/.test(l)) return;
        if (/idempotencia\s*:\s*string|@param/.test(l)) return;            // firmas y documentación
        const clave = `${rel}|${l.trim()}`;
        if (IDEMPOTENCIA_A_MANO_DECLARADA[clave]) return;                  // excepción con su motivo
        aMano.push(`${rel}:${i + 1}  ${l.trim().slice(0, 90)}`);
      });
    }
  })(RAIZ);
  check('ninguna llave de idempotencia se construye a mano fuera de llaveIdempotente',
    aMano.length === 0,
    aMano.join('\n      ') + '\n      → pásala por llaveIdempotente(prefijo, params), o decláralá arriba con su motivo');
  check('y la función central sigue metiendo el contenido en la llave',
    /export function llaveIdempotente/.test(stripeMod) && /createHash\('sha256'\)/.test(stripeMod));
  check('la única excepción declarada sigue existiendo y sigue dicha en el código',
    /\u00daNICA LLAVE DEL FICHERO QUE \*\*NO\*\* PASA POR/.test(stripeMod),
    'si se quita la excepción, hay que quitarla también de la lista de esta comprobación');

  // ── EL RESCATE DE LA BÓVEDA (tarea `suscripcion-rescate-de-la-boveda`, 2 sep 2026) ───────────
  P('\n[rescate de la bóveda]');
  const resc = readFileSync(path.join(RAIZ, 'core/suscripcion-rescate.js'), 'utf8');
  const rescCod = sinComentarios(resc);
  const layoutCod = sinComentarios(layoutMod);
  const impagoTxt = readFileSync(path.join(RAIZ, 'core/suscripcion-impago.js'), 'utf8');

  check('el rescate cuesta UN MES completo, no un prorrateo',
    /precioBaseCentimos/.test(rescCod) && !/prorrateo/i.test(rescCod));
  check('el importe sale de core/plan.js, su único sitio',
    /from '\.\/plan\.js'/.test(rescCod) && !/\b990\b|9,90/.test(rescCod));
  check('NO se calcula ninguna deuda ni atraso: se paga por adelantado',
    !/atras|deuda|moros/i.test(rescCod), 'el que no pagó no compró el periodo, y punto');
  check('sin descuentos ni ofertas', !/descuento|oferta|rebaja|promoci[óo]n/i.test(rescCod));
  check('el rescate deja SU FACTURA (no un cargo suelto)',
    /\/invoices/.test(rescCod) && /finalize/.test(rescCod));
  check('la línea se crea DENTRO de su factura, no suelta',
    /invoice: fac\.datos\.id/.test(rescCod) && /pending_invoice_items_behavior: 'exclude'/.test(rescCod),
    'una línea suelta se barre a la factura siguiente y el cliente paga dos veces');
  check('cerrar la factura ya la cobra: no se cobra dos veces',
    /status === 'paid'\) return cerrada/.test(rescCod));
  check('las llaves de idempotencia pasan por llaveIdempotente',
    (rescCod.match(/llaveIdempotente\(/g) || []).length === 2
      && !/idempotencia: referencia/.test(rescCod));
  check('el cobro va ANTES de reactivar',
    (() => { const c = rescCod.slice(rescCod.indexOf('export async function rescatar'));
             return c.indexOf('await cobrarUnMes') < c.indexOf('volverALaNormalidad(tenant.id'); })());
  check('hay DOS elecciones, que es el criterio del dueño',
    /ELECCIONES = \['cuenta', 'datos'\]/.test(resc));
  // Escrito por posiciones y no recortando el fichero a ojo: la primera versión partía por un
  // comentario que ya no estaba en el código sin comentarios, y medía otra cosa.
  check('con «datos» la cuenta SIGUE cortada: se reactiva DESPUÉS de esa rama',
    rescCod.indexOf("eleccion: 'datos'") < rescCod.indexOf('volverALaNormalidad(tenant.id')
      && (rescCod.match(/volverALaNormalidad\(tenant\.id/g) || []).length === 1,
    'la reactivación solo puede estar en la rama de la cuenta');
  check('y se le reabre la ventana con los días de siempre, sin inventar plazo',
    /DIAS_DE_DESCARGA/.test(rescCod) && !/\b90\b/.test(rescCod));
  check('el rescate no borra NADA', !/DELETE FROM|DROP /i.test(rescCod));
  check('la bóveda NO caduca para rescatar: no se mira en_boveda para permitirlo',
    !/en_boveda_desde[^\n]*return \{ aplica: false/.test(rescCod));

  // Las cuatro frases que prometían una reactivación automática que ya no existe.
  check('la franja de SOLO LECTURA manda a «Recuperar mi cuenta», no a esperar',
    /Recuperar mi cuenta/.test(layoutCod) && !/se reactiva sola/.test(layoutCod));
  check('la tarjeta de estado cortado también', !/se reactiva sola/.test(sinComentarios(situacionMod)));
  check('y el correo del corte explica el paso de pagar el mes',
    /Recuperar mi cuenta/.test(impagoTxt) && !/se reactiva sola/.test(sinComentarios(impagoTxt)));
  check('la pantalla no ofrece dos caminos de vuelta a la vez',
    /s\.situacion === 'pago_pendiente' \? `<div class="card">/.test(pantalla),
    'la caja «Qué hay que pagar» no puede salir en una cuenta ya cortada');

  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  // Lo que la prueba crea, la prueba lo borra: pase, falle o reviente.
  process.chdir(RAIZ);
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(mal ? 1 : 0);
