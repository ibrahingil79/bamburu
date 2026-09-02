// suscripcion.js — La relación de dinero entre un negocio y Bamburu.
//
// QUÉ ES Y DÓNDE VIVE. Esto NO son datos del negocio: es lo que el negocio le debe a Bamburu. Por eso
// vive en `control.db` (tabla `tenant_suscripciones`, una fila por negocio) y no en la base de cada
// tenant. Tres motivos, y el tercero es el que manda:
//   1. Es información de la plataforma, no del cliente.
//   2. El corte por impago (tarea `suscripcion-impago-y-corte`) tiene que decidirse ANTES de abrir la
//      base del negocio; si el dato viviera dentro, habría que abrirla para saber si se puede abrir.
//   3. Una copia de seguridad restaurada de un negocio NO debe poder devolverle una suscripción
//      pagada. El estado del dinero no se restaura con los datos del cliente.
//
// LOS ESTADOS VAN EN ESPAÑOL, y no es estética: `CLAUDE.md` lo tiene escrito con su motivo —los
// estados de pedido en inglés fueron causa de bugs de analítica—. Son exactamente los tres que pide
// el criterio 5 de la tarea, ni uno más:
//   · `prueba`         — dentro de los 15 días gratis, sin tarjeta.
//   · `al_corriente`   — tiene tarjeta y no debe nada.
//   · `pago_pendiente` — se le ha intentado cobrar y no ha salido, o la prueba terminó sin tarjeta.
// El corte, la bóveda y el rescate son estados de las TRES TAREAS SIGUIENTES. No se inventan aquí:
// una máquina de estados a medias es peor que una corta.
//
// NADA DE ESTO COBRA POR SU CUENTA. Este fichero calcula y guarda; quien habla con Stripe es
// `core/stripe.js`, y quien decide cobrar es la ruta que el dueño pulsa.

import { controlDb } from './control-db.js';
import { precioBaseCentimos, diasDePrueba, diaDeCobro, desglose } from './plan.js';

export const ESTADOS = ['prueba', 'al_corriente', 'pago_pendiente'];

// ── Fechas ────────────────────────────────────────────────────────────────────────────────────────
// Todo va en 'YYYY-MM-DD' y toda la aritmética en UTC. Con horas locales, "sumar 15 días" cruza un
// cambio de hora dos veces al año y devuelve 14 o 16: la prueba de un cliente duraría un día menos
// según el mes en que se diera de alta.

export function hoyISO(ahora = new Date()) { return ahora.toISOString().slice(0, 10); }

function aUTC(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}
function deUTC(ms) { return new Date(ms).toISOString().slice(0, 10); }

export function sumarDias(iso, dias) { return deUTC(aUTC(iso) + dias * 86400000); }
export function diasEntre(desdeISO, hastaISO) { return Math.round((aUTC(hastaISO) - aUTC(desdeISO)) / 86400000); }

/**
 * El día de cobro (por defecto el 5) INMEDIATAMENTE POSTERIOR a `iso`, en estricto.
 * Estricto a propósito: si la prueba termina un día 5, el periodo hasta "el 5 siguiente" es el mes
 * entero, no cero días. Un periodo de cero días sería una factura de 0,00 € que no explica nada.
 */
export function siguienteDiaDeCobro(iso, dia = 5) {
  const [a, m] = String(iso).slice(0, 10).split('-').map(Number);
  const d = Number(String(iso).slice(8, 10));
  // Un mes puede no tener día 5 solo si `dia` > 28; con 5 nunca pasa, pero se acota igual por si
  // alguien cambia el ajuste a 31: se usa el último día real del mes.
  const enMes = (anio, mes) => {
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
  };
  const esteMes = enMes(a, m);
  if (d < Number(esteMes.slice(8, 10))) return esteMes;
  return m === 12 ? enMes(a + 1, 1) : enMes(a, m + 1);
}

/** El día de cobro anterior o igual a `iso`: el principio del ciclo que contiene esa fecha. */
export function diaDeCobroAnterior(iso, dia = 5) {
  const siguiente = siguienteDiaDeCobro(iso, dia);
  const [a, m] = siguiente.split('-').map(Number);
  const ultimo = new Date(Date.UTC(m === 1 ? a - 1 : a, m === 1 ? 12 : m - 1, 0)).getUTCDate();
  return m === 1
    ? `${a - 1}-12-${String(Math.min(dia, 31)).padStart(2, '0')}`
    : `${a}-${String(m - 1).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

/**
 * EL PRORRATEO — criterio 3 de la tarea: «al terminar la prueba, o al darse de alta a mitad de mes,
 * se cobra la parte proporcional hasta el día 5 siguiente».
 *
 * Se prorratea sobre el CICLO REAL (día 5 → día 5), no sobre "30 días". Importa: de un 5 de febrero
 * a un 5 de marzo hay 28 días y de un 5 de julio a un 5 de agosto hay 31. Con un divisor fijo de 30,
 * el mismo número de días de servicio costaría distinto según el mes, y en febrero se cobraría de
 * más. Con el ciclo real, medio ciclo cuesta siempre medio plan.
 *
 * El IVA se calcula SOBRE LA BASE YA PRORRATEADA, nunca prorrateando el total: prorratear un total
 * con IVA dentro y desglosarlo después descuadra el céntimo justo en la factura.
 */
export function prorrateo(desdeISO, db = controlDb) {
  const dia = diaDeCobro(db);
  const hasta = siguienteDiaDeCobro(desdeISO, dia);
  const inicioCiclo = diaDeCobroAnterior(desdeISO, dia);
  const diasCiclo = diasEntre(inicioCiclo, hasta);
  const diasPeriodo = diasEntre(desdeISO, hasta);
  const base = Math.round((precioBaseCentimos(db) * diasPeriodo) / diasCiclo);
  return {
    desde: desdeISO,
    hasta,
    dias_periodo: diasPeriodo,
    dias_ciclo: diasCiclo,
    es_mes_completo: diasPeriodo === diasCiclo,
    ...desglose(base, db),
  };
}

// ── La fila de cada negocio ───────────────────────────────────────────────────────────────────────

export function suscripcionDe(tenantId, db = controlDb) {
  try { return db.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id = ?').get(tenantId) || null; }
  catch { return null; }
}

/**
 * Crea la fila de un negocio si no la tiene, arrancando la prueba. Idempotente: si ya existe, no la
 * toca — volver a llamarla NUNCA reinicia una prueba ni borra una tarjeta.
 * `desde` permite sembrar negocios antiguos con su propia fecha.
 */
export function asegurarSuscripcion(tenantId, { desde = null, db = controlDb } = {}) {
  const ya = suscripcionDe(tenantId, db);
  if (ya) return ya;
  const inicio = desde || hoyISO();
  const fin = sumarDias(inicio, diasDePrueba(db));
  db.prepare(`
    INSERT INTO tenant_suscripciones (tenant_id, estado, prueba_inicio, prueba_fin)
    VALUES (?, 'prueba', ?, ?)
    ON CONFLICT(tenant_id) DO NOTHING
  `).run(tenantId, inicio, fin);
  return suscripcionDe(tenantId, db);
}

function guardar(tenantId, campos, db = controlDb) {
  const claves = Object.keys(campos);
  if (!claves.length) return suscripcionDe(tenantId, db);
  const sets = claves.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tenant_suscripciones SET ${sets}, actualizado_en = CURRENT_TIMESTAMP WHERE tenant_id = ?`)
    .run(...claves.map(k => campos[k]), tenantId);
  return suscripcionDe(tenantId, db);
}
export { guardar as guardarSuscripcion };

// ── La situación, ya masticada para pintarla ──────────────────────────────────────────────────────

/**
 * Lo que el criterio 5 pide enseñar: en qué situación está el negocio, dicho como se lo diría una
 * persona. Devuelve SIEMPRE algo pintable, incluso si la fila no existe todavía.
 *
 * `estado` es el de la tabla; `situacion` es lo que se enseña, y no son lo mismo: un negocio en
 * `prueba` cuya prueba ya venció se enseña como `prueba_terminada`, porque decirle "estás de prueba"
 * cuando se le acabó hace tres días es mentirle. El estado guardado no se toca al leer — quien lo
 * cambia es el cobro, no una pantalla.
 */
export function situacion(tenantId, { hoy = null, db = controlDb } = {}) {
  const dia = hoy || hoyISO();
  const s = suscripcionDe(tenantId, db) || null;
  const p = { precio_texto: null, dia_de_cobro: diaDeCobro(db) };

  if (!s) {
    return { ...p, hay_fila: false, estado: null, situacion: 'sin_suscripcion',
             titulo: 'Sin suscripción', detalle: 'Este negocio todavía no tiene una suscripción abierta.',
             puede_dar_tarjeta: true, dias_restantes: null, tarjeta: null };
  }

  const tarjeta = s.tarjeta_ultimos4
    ? { marca: s.tarjeta_marca || 'tarjeta', ultimos4: s.tarjeta_ultimos4, caduca: s.tarjeta_caduca || null }
    : null;
  const base = { ...p, hay_fila: true, estado: s.estado, tarjeta, prueba_fin: s.prueba_fin,
                 proximo_cobro: s.proximo_cobro || null };

  if (s.estado === 'prueba') {
    const restantes = diasEntre(dia, s.prueba_fin);
    if (restantes > 0) {
      return { ...base, situacion: 'prueba', dias_restantes: restantes,
               titulo: `Estás de prueba: te quedan ${restantes} ${restantes === 1 ? 'día' : 'días'}`,
               detalle: tarjeta
                 ? `Cuando termine la prueba se hará el primer cobro, proporcional hasta el día ${diaDeCobro(db)}.`
                 : 'No te hemos pedido ninguna tarjeta. Cuando quieras, deja una y no se te cortará al terminar.',
               puede_dar_tarjeta: true };
    }
    return { ...base, situacion: 'prueba_terminada', dias_restantes: 0,
             titulo: 'Tu prueba ha terminado',
             detalle: 'Deja una tarjeta para seguir usando Bamburu. No se te ha cobrado nada todavía.',
             puede_dar_tarjeta: true };
  }

  // ── CORTADO POR IMPAGO ──────────────────────────────────────────────────────────────────────
  // Va ANTES que los demás: un negocio cortado sigue teniendo `estado = 'pago_pendiente'`, y sin
  // esto la pantalla le decía «tienes un pago pendiente, vuelve a intentarlo» **con la cuenta ya en
  // solo lectura**. La franja de arriba decía una cosa y la tarjeta de debajo otra. Ninguna
  // aserción lo vio: las dos frases eran correctas por separado.
  if (s.cortado_por_impago === 1) {
    return { ...base, situacion: 'cortado', dias_restantes: null,
             titulo: 'Tu cuenta está en SOLO LECTURA',
             detalle: `No pudimos cobrar tu suscripción en 30 días, desde el ${fechaEnPalabras(s.impago_desde)}. `
                    + 'Puedes ver y descargar todo; no puedes crear ni modificar. No se ha borrado nada. '
                    // ⚙️ 2 SEP 2026: decía «pon una tarjeta y se reactiva sola», y con el rescate
                    // construido eso YA NO ES CIERTO: hace falta pagar el mes y elegir. Prometer una
                    // reactivación automática dejaría al dueño esperando un cobro que no va a salir.
                    + 'Para volver: pon una tarjeta que funcione y pulsa «Recuperar mi cuenta» aquí abajo.',
             puede_dar_tarjeta: true, cortado_en: s.cortado_en || null };
  }

  if (s.estado === 'al_corriente') {
    return { ...base, situacion: 'al_corriente', dias_restantes: null,
             titulo: 'Al corriente de pago',
             detalle: s.proximo_cobro
               ? `El próximo cobro sale el ${fechaEnPalabras(s.proximo_cobro)}.`
               : 'No hay ningún pago pendiente.',
             puede_dar_tarjeta: true };
  }

  return { ...base, situacion: 'pago_pendiente', dias_restantes: null,
           titulo: 'Tienes un pago pendiente',
           // Con un impago abierto se dice la FECHA DEL CORTE, que es lo que el dueño necesita saber
           // para decidir si le corre prisa. «Vuelve a intentarlo» a secas no informa de nada.
           detalle: s.corte_previsto
             ? `No hemos podido cobrar tu suscripción. Si no se arregla, el ${fechaEnPalabras(s.corte_previsto)} `
               + 'tu cuenta pasará a solo lectura: seguirás viéndolo todo, pero no podrás crear ni modificar. '
               + 'No se borra nada. Pon una tarjeta que funcione y se arregla al momento.'
             : (s.ultimo_error || 'El último cobro no salió adelante. Revisa la tarjeta y vuelve a intentarlo.'),
           puede_dar_tarjeta: true, corte_previsto: s.corte_previsto || null };
}

/** '2026-09-20' → '20 de septiembre de 2026'. Las fechas se le enseñan al dueño en español. */
export function fechaEnPalabras(iso) {
  if (!iso) return '—';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return '—';
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
