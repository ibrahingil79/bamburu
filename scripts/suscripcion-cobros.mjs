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
// LO QUE NO ES. NO es el cobro mensual del día 5 — eso es `suscripcion-cobro-mensual`, la tarea
// siguiente, y no se adelanta aquí. Esta pasada solo cobra el PRIMER tramo, el proporcional.
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
  return 0;
}

main().then(c => process.exit(c)).catch(e => {
  process.stderr.write(`[suscripcion-cobros] avería: ${e.stack || e.message}\n`);
  process.exit(1);
});
