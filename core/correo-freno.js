// core/correo-freno.js
//
// EL FRENO DEL CORREO — para antes de vaciar el cupo, y lo dice.
//
// POR QUÉ EXISTE. El 24 ago 2026 salieron **174 correos en un día**, cuando la línea base real del
// producto son **2**. Cuarenta y cinco acabaron en la bandeja del dueño y treinta y seis rebotaron.
// Nadie lo frenó porque no había nada que contara: cada proceso enviaba lo suyo y ninguno veía el
// conjunto. Un bucle mal cerrado un domingo por la noche puede vaciar el cupo del plan y dejar al
// producto sin poder mandar ni una factura, sin un solo aviso.
//
// QUÉ HACE. Cuenta los envíos de la última hora en `control.db` (compartida entre procesos) y, si se
// pasa del tope, **para** y manda UN aviso al dueño. Uno por hora, no uno por intento.
//
// EL TOPE, Y DE DÓNDE SALE EL NÚMERO. 120 por hora. No es inventado: en todo agosto de 2026 —con
// barridos repetidos, migraciones de prueba y el peor día de la historia del proyecto— la hora más
// cargada tuvo **38 envíos**, y la mediana de las horas con actividad fue **2**. 120 es tres veces el
// peor caso real: no estorba ni al día más movido, y una avalancha de verdad (cientos) la corta.
// Se puede subir con BAMBURU_CORREO_TOPE_HORA si algún día un negocio de verdad lo necesita.
//
// FALLA ABIERTO, PERO NO CALLADO. Si el freno no puede consultar su tabla, **deja pasar el correo**:
// el producto tiene que seguir funcionando aunque su vigilante esté roto. Pero lo grita por stderr,
// porque un freno que no frena y no lo dice es peor que no tener freno.

import { controlDb } from './control-db.js';

export const TOPE_HORA = Number(process.env.BAMBURU_CORREO_TOPE_HORA || 120);

// El aviso de que se ha activado el freno tiene que poder salir aunque el freno esté activo.
export const ASUNTO_FRENO = '🛑 Bamburu · freno de correo activado';

// ── DIRECCIONES QUE NO PUEDEN EXISTIR: SE DESVÍAN A SIMULACIÓN, NO SE MANDAN AL VACÍO ───────────
//
// En agosto de 2026 **rebotaron 122 de 675 envíos, el 18 %**. Casi todos iban a direcciones que las
// comprobaciones se inventan: `@t.local`, `@bamburu.test`, `@ejemplo.com`. 79 eran recordatorios de
// cita y rebotaron el 100 %.
//
// Y un rebote no es gratis. Los rebotes bajan la reputación del dominio, y en esta cuenta ya
// costaron algo concreto: Resend acabó **suprimiendo** una dirección de verdad, que lleva ocho días
// sin recibir su resumen diario sin que nadie se enterara. Ver docs/censo-correos.md.
//
// Estos TLD no pueden recibir correo nunca: `.test`, `.local`, `.invalid` y `.example` están
// reservados justo para esto (RFC 2606/6761), y `ejemplo.com`/`bamburu.test` son inventos nuestros.
// Mandarles un correo es, por definición, fabricar un rebote. Se desvían a la dirección de simulación
// de Resend: el correo se compone igual, sale igual y se registra igual — pero no rebota.
//
// NO SE HACE EN SILENCIO. Se dice por stderr y se apunta en `correo_envios` con las dos direcciones,
// para que nunca tape el caso feo: un cliente REAL con la dirección mal escrita acabada en `.local`.
// Ahí el desvío evita el rebote, pero el registro deja ver que esa dirección no vale.
export const SIMULACION = 'delivered@resend.dev';
const TLD_IMPOSIBLES = /\.(test|local|invalid|example)$/i;
const DOMINIOS_INVENTADOS = /@(ejemplo\.com|example\.com|bamburu\.test)$/i;

export function esImposible(direccion) {
  const d = String(direccion || '').trim().toLowerCase();
  return TLD_IMPOSIBLES.test(d) || DOMINIOS_INVENTADOS.test(d);
}

// Devuelve { to, desviados } — `to` con la misma forma que llegó (texto o lista).
export function desviarImposibles(to) {
  const lista = Array.isArray(to) ? to : [to];
  const desviados = lista.filter(esImposible);
  if (!desviados.length) return { to, desviados };
  const nuevas = lista.map(d => (esImposible(d) ? SIMULACION : d));
  return { to: Array.isArray(to) ? nuevas : nuevas[0], desviados };
}

let avisadoHasta = 0;   // marca de tiempo hasta la que ya se avisó (una vez por hora)

// Solo para las comprobaciones: olvida que ya avisó, para poder ensayar el aviso más de una vez.
export function olvidarAviso() { avisadoHasta = 0; }

function haceUnaHora() {
  return new Date(Date.now() - 3600_000).toISOString();
}

// Devuelve { parar, enviados, tope, primeraVez }. Apunta el envío ANTES de decidir.
//
// `db` se puede inyectar para poder PROBAR el freno sin escribir en la base de control de verdad.
// No es adorno: una comprobación que ensaya el freno tendría que meter 120 filas en `correo_envios`
// del negocio real, y eso es justo la clase de basura que este encargo viene a quitar.
export function registrarYDecidir({ to, subject } = {}, db = controlDb) {
  const destino = Array.isArray(to) ? to.join(', ') : String(to || '');
  const asunto = String(subject || '');

  // El propio aviso del freno nunca se frena a sí mismo.
  if (asunto === ASUNTO_FRENO) return { parar: false, enviados: -1, tope: TOPE_HORA, primeraVez: false };

  let enviados;
  try {
    enviados = db.prepare(
      "SELECT COUNT(*) n FROM correo_envios WHERE ts >= ? AND frenado = 0").get(haceUnaHora()).n;
  } catch (e) {
    console.error('[correo-freno] NO PUEDO CONTAR LOS ENVÍOS, dejo pasar el correo sin vigilancia: ' + e.message);
    return { parar: false, enviados: -1, tope: TOPE_HORA, primeraVez: false, ciego: true };
  }

  const parar = enviados >= TOPE_HORA;
  try {
    db.prepare('INSERT INTO correo_envios (ts, destino, asunto, frenado) VALUES (?,?,?,?)')
      .run(new Date().toISOString(), destino.slice(0, 200), asunto.slice(0, 200), parar ? 1 : 0);
  } catch (e) {
    console.error('[correo-freno] no he podido apuntar el envío: ' + e.message);
  }

  let primeraVez = false;
  if (parar && Date.now() > avisadoHasta) { primeraVez = true; avisadoHasta = Date.now() + 3600_000; }
  return { parar, enviados, tope: TOPE_HORA, primeraVez };
}

// Cuántos van en la última hora (para comprobaciones y para el aviso).
export function enviadosUltimaHora(db = controlDb) {
  try {
    return db.prepare(
      "SELECT COUNT(*) n FROM correo_envios WHERE ts >= ? AND frenado = 0").get(haceUnaHora()).n;
  } catch { return -1; }
}
