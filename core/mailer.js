// Envío de email centralizado (Resend). Lazy init: importar este módulo no exige tener
// la API key presente (los tests inyectan su propio sendEmail y no llegan aquí). El SDK
// de Resend NO lanza: devuelve { data, error }; quien llama debe comprobar error.
//
// 25 ago 2026 · TODO PASA POR AQUÍ, Y AHORA HAY FRENO. Esta es la única puerta a Resend en todo
// Bamburu, así que es el único sitio donde se puede contar lo que sale. Ver core/correo-freno.js:
// si en una hora se pasa del tope, se PARA y se avisa una vez, en vez de vaciar el cupo del plan en
// silencio. Un correo frenado devuelve `error`, igual que un fallo de Resend, así que quien llama no
// se entera de nada nuevo: ya tenía que mirar `error`.
import { Resend } from 'resend';
import { registrarYDecidir, desviarImposibles, ASUNTO_FRENO, TOPE_HORA } from './correo-freno.js';

let _resend = null;
function client() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function sendEmail(opts) {
  // Primero el desvío: una dirección que no puede existir no se manda al vacío, se manda a simulación.
  // Ver core/correo-freno.js — 122 rebotes en agosto salieron de aquí, y los rebotes cuestan reputación.
  const { to, desviados } = desviarImposibles(opts.to);
  if (desviados.length) {
    console.error('[correo] dirección imposible, desviada a simulación: ' + desviados.join(', ')
      + ' · asunto "' + (opts.subject || '') + '"');
    opts = { ...opts, to };
  }

  const freno = registrarYDecidir(desviados.length
    ? { to: desviados.join(', ') + ' → simulación', subject: opts.subject }
    : opts);
  if (!freno.parar) return client().emails.send(opts);

  const motivo = 'Freno de correo: ' + freno.enviados + ' envíos en la última hora (tope ' + freno.tope + ').';
  console.error('[correo-freno] PARADO · ' + motivo + ' Destinatario: ' + (Array.isArray(opts.to) ? opts.to.join(', ') : opts.to));

  // Un aviso por hora, y sale por la puerta de al lado para que el freno no se frene a sí mismo.
  if (freno.primeraVez) {
    try {
      await client().emails.send({
        from: 'Bamburu <noreply@bamburu.com>', to: 'ibrahingil@gmail.com', subject: ASUNTO_FRENO,
        text: motivo + '\n\nDesde este momento Bamburu NO envía más correos hasta que baje el ritmo.\n'
          + 'Esto existe para que un bucle no vacíe el cupo del plan y deje al producto sin poder\n'
          + 'mandar una factura. Si el tope se ha quedado corto, se sube con BAMBURU_CORREO_TOPE_HORA.\n\n'
          + 'Último correo frenado: "' + (opts.subject || '') + '" → ' + (Array.isArray(opts.to) ? opts.to.join(', ') : opts.to),
      });
    } catch (e) { console.error('[correo-freno] no pude avisar del freno: ' + e.message); }
  }
  return { data: null, error: { name: 'freno_correo', message: motivo } };
}

export { TOPE_HORA };
