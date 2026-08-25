// scripts/lib/correo-de-prueba.mjs
//
// LAS DIRECCIONES DE SIMULACIÓN DE RESEND. Ninguna comprobación vuelve a escribir a una bandeja real.
//
// POR QUÉ. Censo del 25 ago 2026 (docs/censo-correos.md): el 24 de agosto salieron **174 correos**
// contra una línea base de **2 al día**. Cuarenta y cinco cayeron en la bandeja del dueño y **39 de
// ellos los mandaron tres comprobaciones** que se disparan en cada pasada del barrido. Además, **122
// de los 675 envíos de agosto rebotaron** —el 18 %—, casi todos a direcciones inventadas del tipo
// `@t.local`. Y los rebotes no son inocuos: fueron los que llevaron a Resend a **suprimir** una
// dirección real, que lleva ocho días sin recibir nada.
//
// QUÉ SON ESTAS DIRECCIONES. Resend las trata como envíos completos —se componen, se envían, se
// registran, devuelven su id— pero **no salen a internet y no tocan la reputación del dominio**:
//   · delivered@resend.dev  → se entrega
//   · bounced@resend.dev    → rebota (para probar el camino del rebote a propósito)
//   · complained@resend.dev → el destinatario lo marca como spam
//
// LO QUE NO CAMBIA: las comprobaciones siguen comprobando exactamente lo mismo —que el correo se
// compone y sale, con su asunto y su cuerpo—. Lo único que cambia es que ya no acaba en la bandeja de
// nadie. Los envíos REALES del producto (facturas, cobros, avisos, parte del barrido) no se tocan.

export const ENTREGADO = 'delivered@resend.dev';
export const REBOTA    = 'bounced@resend.dev';
export const SPAM      = 'complained@resend.dev';

// Una dirección de simulación distinta por comprobación, para poder rastrear en el registro de Resend
// quién mandó qué. Resend entrega igual todo lo que va a delivered@resend.dev, con etiqueta o sin ella.
export function correoDePrueba(etiqueta) {
  const limpia = String(etiqueta || 'gate').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return 'delivered+' + (limpia || 'gate') + '@resend.dev';
}
