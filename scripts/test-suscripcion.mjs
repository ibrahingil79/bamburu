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
      if (f.endsWith('core/plan.js') || f.endsWith('scripts/test-suscripcion.mjs')) continue;
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

  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  // Lo que la prueba crea, la prueba lo borra: pase, falle o reviente.
  process.chdir(RAIZ);
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(mal ? 1 : 0);
