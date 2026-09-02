#!/usr/bin/env node
//
// suscripcion-cobros.mjs — La pasada diaria que cobra el prorrateo cuando vence una prueba.
//
// QUÉ CIERRA. El criterio 3 de `suscripcion-plan-y-alta`: «al terminar la prueba, o al darse de alta
// a mitad de mes, se cobra la parte proporcional hasta el día 5 siguiente». La segunda mitad la
// resuelve la pantalla en el acto (cuando el dueño deja la tarjeta con la prueba ya vencida); ESTA
// es la primera: el dueño dejó la tarjeta durante la prueba, se fue, y quince días después hay que
// cobrarle sin que él tenga que volver a entrar.
//
// Y LA SEGUNDA MITAD, desde `suscripcion-cobro-mensual` (2 sep 2026): **el aviso de la semana
// antes**. El cobro mensual en sí lo hace Stripe —día 5, con `billing_cycle_anchor`— y aquí no se
// cobra nada de eso; lo que hace esta pasada es mirar a quién le falta exactamente una semana y
// mandarle el aviso con el importe y los cuatro últimos dígitos de su tarjeta.
//
// **Por qué el aviso lo dispara también esta pasada y no solo el webhook de Stripe:** el plazo del
// evento `invoice.upcoming` **no se puede fijar por API** (medido: `GET /v1/account` devuelve
// `settings.billing` vacío), es un ajuste del panel. El criterio del dueño dice «una semana antes»,
// y no puede depender de una casilla que alguien tenga que ir a marcar en otra web. Los dos
// disparadores entran por la misma puerta, que apunta la factura por la que ya avisó: **un aviso por
// cobro**, venga por donde venga.
//
// POR QUÉ NO SE MUERE NUNCA. Recorre la lista negocio a negocio y cada uno va en su propio
// try/catch: un cobro que revienta no puede dejar sin cobrar a los que venían detrás. Sale con 0
// aunque haya rechazos —un rechazo de tarjeta es una respuesta, no una avería del servidor— y con 1
// solo si la pasada misma no pudo funcionar. Si saliera con 1 por una tarjeta caducada, systemd
// marcaría la unidad en rojo todos los días y el rojo dejaría de significar algo.
//
// SIMULACRO POR DEFECTO, como el resto de guiones que mueven algo en este repo. Sin `--cobrar` dice
// a quién cobraría y cuánto, y NO llama a Stripe. La unidad de systemd sí pasa `--cobrar`.

import { controlDb } from '../core/control-db.js';
import { plan } from '../core/plan.js';
import { hoyISO, prorrateo, fechaEnPalabras } from '../core/suscripcion.js';
import { cobrarProrrateo, pendientesDeProrrateo } from '../core/suscripcion-cobro.js';
import { enviarAvisoPrevio, DIAS_DE_AVISO } from '../core/suscripcion-mensual.js';
import { diagnostico } from '../core/stripe.js';

const args = process.argv.slice(2);
const DE_VERDAD = args.includes('--cobrar');
const HOY = (args.find(a => a.startsWith('--hoy=')) || '').slice(6) || hoyISO();

function linea(t) { process.stdout.write(t + '\n'); }

async function main() {
  const d = diagnostico();
  linea(`[suscripcion-cobros] ${HOY} · Stripe: ${d.modo}${d.usable ? '' : ' (NO USABLE)'} · ${DE_VERDAD ? 'COBRANDO' : 'SIMULACRO (usa --cobrar)'}`);
  linea(`[suscripcion-cobros] plan: ${plan().texto_precio} — se cobra ${plan().desglose_mes.total} al mes`);

  if (DE_VERDAD && !d.usable) {
    // Que no se pueda cobrar SÍ es una avería de la pasada: alguien la programó para cobrar y no
    // puede. Sale con 1 para que systemd lo cante.
    linea('[suscripcion-cobros] ✗ Stripe no está usable en este servidor y se pidió cobrar de verdad.');
    return 1;
  }

  let pendientes;
  try {
    pendientes = pendientesDeProrrateo({ db: controlDb, hoy: HOY });
  } catch (e) {
    linea(`[suscripcion-cobros] ✗ no se pudo leer la lista: ${e.message}`);
    return 1;
  }

  if (!pendientes.length) {
    linea('[suscripcion-cobros] no hay ninguna prueba vencida con tarjeta puesta. Nada que cobrar.');
    // Y AUN ASÍ SE AVISA. Aquí había un `return 0` seco: si ningún negocio tenía un prorrateo
    // pendiente —que es el caso NORMAL, casi todos los días— la pasada terminaba y **no se mandaba
    // ni un aviso**. Los avisos no dependen del prorrateo: son de los negocios que ya están al
    // corriente, que son justo los que no aparecen en esa lista.
    await avisosPrevios();
    return 0;
  }

  let cobrados = 0, rechazados = 0, saltados = 0;
  for (const t of pendientes) {
    const pr = prorrateo(HOY);
    const cabecera = `  · ${t.slug} (#${t.id}) — prueba hasta ${fechaEnPalabras(t.prueba_fin)} — ${pr.dias_periodo}/${pr.dias_ciclo} días → ${pr.total}`;
    if (!DE_VERDAD) { linea(cabecera + '  [simulacro]'); saltados += 1; continue; }
    try {
      const r = await cobrarProrrateo({ id: t.id, name: t.name, slug: t.slug }, { db: controlDb, hoy: HOY });
      if (r.ok) { linea(cabecera + `  ✓ cobrado (${r.stripe_id || 'sin id'})`); cobrados += 1; }
      else if (r.motivo === 'cobro_rechazado') { linea(cabecera + `  ✗ rechazado: ${r.error}`); rechazados += 1; }
      else { linea(cabecera + `  — sin cobrar (${r.motivo}): ${r.detalle || ''}`); saltados += 1; }
    } catch (e) {
      linea(cabecera + `  ✗ excepción: ${e.message}`);
      rechazados += 1;
    }
  }

  linea(`[suscripcion-cobros] ${cobrados} cobrado(s) · ${rechazados} rechazado(s) · ${saltados} sin cobrar`);

  await avisosPrevios();
  return 0;
}

/**
 * EL AVISO DE LA SEMANA ANTES. Recorre los negocios con suscripción abierta en Stripe y le manda el
 * aviso a quien le falten exactamente `DIAS_DE_AVISO` días para el cargo.
 *
 * En SIMULACRO no manda nada: dice a quién avisaría. Es la misma regla que el cobro — un guion que
 * mueve algo no lo mueve por defecto.
 */
async function avisosPrevios() {
  let filas = [];
  try {
    filas = controlDb.prepare(`
      SELECT t.id, t.name, t.slug, s.stripe_suscripcion_id, s.aviso_de_factura
        FROM tenants t JOIN tenant_suscripciones s ON s.tenant_id = t.id
       WHERE s.stripe_suscripcion_id IS NOT NULL`).all();
  } catch (e) {
    linea(`[suscripcion-avisos] ✗ no se pudo leer la lista: ${e.message}`);
    return;
  }
  if (!filas.length) { linea('[suscripcion-avisos] no hay ninguna suscripción abierta en Stripe.'); return; }

  let avisados = 0, nada = 0, fallos = 0;
  for (const t of filas) {
    try {
      // `simulacro` se le pasa al propio módulo: calcula a quién, cuánto y qué día, y NO manda ni
      // apunta nada. Decidirlo aquí, después de llamar, habría sido tarde — el correo ya habría
      // salido.
      const r = await enviarAvisoPrevio({ id: t.id, name: t.name, slug: t.slug },
                                        { db: controlDb, hoy: HOY, forzar: false, simulacro: !DE_VERDAD });
      if (!DE_VERDAD) {
        linea(`  · ${t.slug} — ${r.motivo}${r.cargo ? ` · ${r.cargo.total} el ${r.cargo.fecha}` : ''}  [simulacro: no se envía]`);
        nada += 1;
        continue;
      }
      if (r.enviado) { linea(`  · ${t.slug} — ✉️ avisado: ${r.cargo.total} el ${r.cargo.fecha} → ${r.destino}`); avisados += 1; }
      else if (r.motivo === 'fallo_al_enviar') { linea(`  · ${t.slug} — ✗ NO SALIÓ el aviso: ${r.error}`); fallos += 1; }
      else { linea(`  · ${t.slug} — ${r.motivo}${r.faltan != null ? ` (faltan ${r.faltan} d)` : ''}`); nada += 1; }
    } catch (e) {
      linea(`  · ${t.slug} — ✗ excepción al avisar: ${e.message}`); fallos += 1;
    }
  }
  linea(`[suscripcion-avisos] ${avisados} avisado(s) · ${nada} sin aviso · ${fallos} fallo(s) · se avisa ${DIAS_DE_AVISO} días antes`);
}

main().then(c => process.exit(c)).catch(e => {
  process.stderr.write(`[suscripcion-cobros] avería: ${e.stack || e.message}\n`);
  process.exit(1);
});
