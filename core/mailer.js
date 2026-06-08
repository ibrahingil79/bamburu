// Envío de email centralizado (Resend). Lazy init: importar este módulo no exige tener
// la API key presente (los tests inyectan su propio sendEmail y no llegan aquí). El SDK
// de Resend NO lanza: devuelve { data, error }; quien llama debe comprobar error.
import { Resend } from 'resend';

let _resend = null;
function client() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function sendEmail(opts) {
  return client().emails.send(opts);
}
