// PLANTILLAS DE EMAIL — la casa de plantillas, ahora EDITABLE por el dueño.
//
// QUÉ CAMBIA Y QUÉ NO. Los textos que este negocio envía ya existían: vivían repartidos entre cuatro
// constructores (collectionEmail, accountEmail, opportunityEmail, avisosEmail) y cuatro HTML escritos a
// mano dentro de las rutas (presupuesto, orden de compra, recuperar contraseña, enlace del portal).
// Aquí NO se inventa ninguna plantilla nueva ni un segundo sistema de envío: se recogen las que hay,
// se les marcan los HUECOS que ya rellenaban, y se permite reescribirlas.
//
// LA IDEA. Una plantilla de fábrica deja de ser código que concatena cadenas y pasa a ser DATO: un
// texto con huecos `{{asi}}`. El constructor de siempre (collectionEmail, etc.) se queda como envoltorio
// que renderiza ese dato con los valores reales — misma firma, misma salida. Y como la de fábrica ya es
// un texto con huecos, LA EDITABLE ES LA MISMA COSA: no hay dos versiones del texto que puedan
// desincronizarse. Ese era el riesgo real de esta tarea.
//
// LAS DOS FAMILIAS, Y POR QUÉ SE TRATAN DISTINTO.
//   · CLIENTE (A) — lo que el negocio le dice a un cliente o a un proveedor. Si el dueño se carga un
//     hueco importante (el nº de factura en un recordatorio de pago), se le AVISA. Es su voz y su
//     decisión: un email raro es un problema suyo, no un accidente del sistema.
//   · SISTEMA (B) — los operativos. Aquí hay un ELEMENTO CRÍTICO —el enlace de acción— y quitarlo NO
//     es una decisión estética: un "recupera tu contraseña" sin el enlace deja a una persona fuera de
//     su propia cuenta, y encima no se entera nadie hasta que pasa. Eso se BLOQUEA al guardar.
//     El elemento crítico no sale de una lista inventada: sale de la plantilla de fábrica (el enlace
//     que HOY trae ese email).
// (Local, como en cobros.js y avisos.js: este proyecto no tiene un módulo de utilidades común y no es
//  esta tarea la que va a inventarlo.)
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const FAMILIA_CLIENTE = 'cliente';
export const FAMILIA_SISTEMA = 'sistema';

// ── Motor ───────────────────────────────────────────────────────────────────
const RE_HUECO = /\{\{\s*([a-z_]+)\s*\}\}/g;

// Sustituye los huecos. Los valores se ESCAPAN siempre — salvo los declarados `esHtml`, que son bloques
// que el propio sistema genera (la tabla de la orden, la lista de avisos): ahí el HTML es el dato.
// Un hueco que no existe se queda vacío, nunca imprime "{{loquesea}}" en la cara del cliente.
export function renderPlantilla(txt, vars, { html = true } = {}) {
  return String(txt || '').replace(RE_HUECO, (_, clave) => {
    const v = vars[clave];
    if (v == null) return '';
    if (v && typeof v === 'object' && v.esHtml) return String(v.valor);
    return html ? escapeHtml(String(v)) : String(v);
  });
}

// Qué huecos usa de verdad un texto (para la red de seguridad).
export const huecosUsados = (txt) => new Set([...String(txt || '').matchAll(RE_HUECO)].map(m => m[1]));

// Versión en texto plano de un HTML. Para el `text` del email (los clientes que no pintan HTML) y para
// la vista previa. No pretende ser un navegador: pretende no perder el mensaje.
export function htmlAtexto(html) {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/div|\/h\d|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();
}

// ── Piezas comunes de las plantillas de fábrica (para no repetir el marco) ──
const MARCO = (cuerpo) =>
  '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">'
  + cuerpo + '</div>';
const FIRMA = '<p style="margin-top:24px">Un saludo,<br>{{empresa}}</p>';
const CAJA = (filas) => '<p style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin:16px 0">' + filas + '</p>';
const BOTON = (texto) => '<p><a href="{{enlace}}" style="display:inline-block;background:#111827;color:#fff;padding:12px 20px;'
  + 'border-radius:8px;text-decoration:none;font-weight:600">' + texto + '</a></p>';

// ── EL CATÁLOGO ─────────────────────────────────────────────────────────────
//
// Cada tipo declara:
//   familia   — cliente | sistema (decide si la red de seguridad avisa o BLOQUEA)
//   tonos     — variantes editables por separado bajo el mismo tipo (o null si solo tiene una)
//   huecos    — lo que ese email SABE rellenar. Salen de lo que la plantilla de fábrica ya usaba.
//   requeridos— (familia CLIENTE) quitarlos AVISA
//   criticos  — (familia SISTEMA) quitarlos BLOQUEA el guardado
//   fabrica   — el texto de fábrica, con sus huecos. Es la fuente: no hay otra copia en ningún sitio.
//   ejemplo   — datos de muestra para la vista previa (nunca datos reales de un cliente)
export const CATALOGO = {

  // ══ FAMILIA A — al cliente / al proveedor ═════════════════════════════════
  cobro_factura: {
    familia: FAMILIA_CLIENTE,
    label: 'Recordatorio de pago (una factura)',
    descripcion: 'Se lo mandas a un cliente cuando una factura suya está vencida. Cuatro tonos, del amable al último aviso.',
    tonos: [
      { clave: 'amable', label: 'Amable' },
      { clave: 'firme-medio', label: 'Firme' },
      { clave: 'formal', label: 'Formal' },
      { clave: 'ultima', label: 'Última gestión' },
    ],
    huecos: [
      { clave: 'cliente', label: 'Nombre del cliente' },
      { clave: 'factura', label: 'Nº de factura' },
      { clave: 'importe', label: 'Importe pendiente' },
      { clave: 'vencimiento', label: 'Fecha de vencimiento' },
      { clave: 'empresa', label: 'Tu negocio' },
    ],
    requeridos: ['factura', 'importe'],
    ejemplo: { cliente: 'María García', factura: 'F2026-0042', importe: '363,00 €', vencimiento: '2026-06-30', empresa: 'Tu Negocio' },
    fabrica: {
      'amable': {
        subject: 'Recordatorio: factura {{factura}} pendiente',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Esperamos que todo vaya bien. Te escribimos como recordatorio amistoso de que la factura {{factura}} está pendiente de pago.</p>'
          + CAJA('<strong>Importe pendiente:</strong> {{importe}}<br><strong>Vencimiento:</strong> {{vencimiento}}')
          + '<p>Si ya la has abonado, ignora este mensaje. ¡Gracias!</p>' + FIRMA),
      },
      'firme-medio': {
        subject: 'Recordatorio de pago: factura {{factura}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Te recordamos que la factura {{factura}}, con vencimiento {{vencimiento}}, sigue pendiente de pago. Agradeceríamos que la regularices lo antes posible.</p>'
          + CAJA('<strong>Importe pendiente:</strong> {{importe}}<br><strong>Vencimiento:</strong> {{vencimiento}}')
          + '<p>Si ya has realizado el pago, te agradeceríamos que nos lo confirmes.</p>' + FIRMA),
      },
      'formal': {
        subject: 'Aviso de pago pendiente: factura {{factura}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Por la presente te comunicamos formalmente que la factura {{factura}}, vencida el {{vencimiento}}, continúa impagada. Te rogamos procedas a su abono de forma inmediata.</p>'
          + CAJA('<strong>Importe pendiente:</strong> {{importe}}<br><strong>Vencimiento:</strong> {{vencimiento}}')
          + '<p>Quedamos a la espera de su pago o de noticias suyas.</p>' + FIRMA),
      },
      'ultima': {
        subject: 'Última gestión de cobro: factura {{factura}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Esta es una última gestión de cobro respecto a la factura {{factura}}, vencida el {{vencimiento}} y aún impagada. De no recibir el pago, nos veremos obligados a valorar las medidas oportunas para su recuperación.</p>'
          + CAJA('<strong>Importe pendiente:</strong> {{importe}}<br><strong>Vencimiento:</strong> {{vencimiento}}')
          + '<p>Quedamos a la espera de una respuesta a la mayor brevedad.</p>' + FIRMA),
      },
    },
  },

  cobro_cuenta: {
    familia: FAMILIA_CLIENTE,
    label: 'Recordatorio de saldo (toda la cuenta)',
    descripcion: 'Cuando un cliente te debe varias facturas y prefieres escribirle UNA vez por el saldo entero, no una por factura.',
    tonos: [
      { clave: 'amable', label: 'Amable' },
      { clave: 'firme-medio', label: 'Firme' },
      { clave: 'formal', label: 'Formal' },
      { clave: 'ultima', label: 'Última gestión' },
    ],
    huecos: [
      { clave: 'cliente', label: 'Nombre del cliente' },
      { clave: 'n_facturas', label: 'Nº de facturas pendientes' },
      { clave: 'total', label: 'Saldo total' },
      { clave: 'facturas', label: 'Lista de facturas', esHtml: true, bloque: true },
      { clave: 'empresa', label: 'Tu negocio' },
    ],
    requeridos: ['total', 'facturas'],
    ejemplo: {
      cliente: 'María García', n_facturas: '3', total: '1.210,00 €', empresa: 'Tu Negocio',
      facturas: { esHtml: true, valor: '<ul><li>F2026-0040 — 363,00 € (vencida el 2026-06-01)</li><li>F2026-0042 — 484,00 € (vencida el 2026-06-30)</li><li>F2026-0045 — 363,00 € (vence el 2026-07-20)</li></ul>' },
    },
    fabrica: {
      'amable': {
        subject: 'Recordatorio: saldo pendiente ({{total}})',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Esperamos que todo vaya bien. Te escribimos como recordatorio de que tienes {{n_facturas}} factura(s) pendiente(s) de pago con nosotros.</p>'
          + CAJA('<strong>Saldo pendiente:</strong> {{total}}') + '{{facturas}}'
          + '<p>Si ya has abonado alguna, ignóralo. ¡Gracias!</p>' + FIRMA),
      },
      'firme-medio': {
        subject: 'Recordatorio de pago: saldo pendiente {{total}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Te recordamos que mantienes {{n_facturas}} factura(s) pendiente(s) de pago. Agradeceríamos que regularices el saldo lo antes posible.</p>'
          + CAJA('<strong>Saldo pendiente:</strong> {{total}}') + '{{facturas}}'
          + '<p>Si ya has realizado algún pago, te agradeceríamos que nos lo confirmes.</p>' + FIRMA),
      },
      'formal': {
        subject: 'Aviso de saldo pendiente: {{total}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Por la presente te comunicamos formalmente que mantienes un saldo pendiente con nosotros, detallado a continuación. Te rogamos procedas a su abono de forma inmediata.</p>'
          + CAJA('<strong>Saldo pendiente:</strong> {{total}}') + '{{facturas}}'
          + '<p>Quedamos a la espera de su pago o de noticias suyas.</p>' + FIRMA),
      },
      'ultima': {
        subject: 'Última gestión de cobro: saldo {{total}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Esta es una última gestión de cobro respecto al saldo pendiente que mantienes con nosotros. De no recibir el pago, nos veremos obligados a valorar las medidas oportunas para su recuperación.</p>'
          + CAJA('<strong>Saldo pendiente:</strong> {{total}}') + '{{facturas}}'
          + '<p>Quedamos a la espera de una respuesta a la mayor brevedad.</p>' + FIRMA),
      },
    },
  },

  comercial: {
    familia: FAMILIA_CLIENTE,
    label: 'Seguimiento comercial y reenganche',
    descripcion: 'Los que usa el CRM para mover una oportunidad, y el de "reenganche" que DISA te propone para un cliente que dejó de comprar.',
    tonos: [
      { clave: 'primer-contacto', label: 'Primer contacto' },
      { clave: 'seguimiento', label: 'Seguimiento' },
      { clave: 'insistencia', label: 'Insistencia' },
      { clave: 'ultimo-intento', label: 'Último intento' },
      { clave: 'reenganche', label: 'Reenganche (cliente dormido)' },
    ],
    huecos: [
      { clave: 'cliente', label: 'Nombre del cliente' },
      { clave: 'asunto', label: 'Asunto / oportunidad' },
      { clave: 'empresa', label: 'Tu negocio' },
    ],
    requeridos: [],
    ejemplo: { cliente: 'María García', asunto: 'la reforma del local', empresa: 'Tu Negocio' },
    fabrica: {
      'primer-contacto': {
        subject: '{{asunto}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Te escribo por {{asunto}}. Me gustaría conocer bien lo que necesitas para poder ayudarte.</p>'
          + '<p>¿Te viene bien que hablemos esta semana?</p>' + FIRMA),
      },
      'seguimiento': {
        subject: 'Seguimiento: {{asunto}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Retomo el hilo de {{asunto}} por si has tenido ocasión de verlo. Quedo a tu disposición para cualquier duda.</p>'
          + '<p>Si te encaja, dime y seguimos adelante.</p>' + FIRMA),
      },
      'insistencia': {
        subject: '¿Cómo lo ves? — {{asunto}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Vuelvo a escribirte sobre {{asunto}}. Si sigues interesado, dime y lo retomamos; si necesitas ajustar algo, lo vemos sin problema.</p>'
          + '<p>Con una línea tuya me vale para saber cómo lo ves.</p>' + FIRMA),
      },
      'ultimo-intento': {
        subject: 'Cierro el tema de {{asunto}} (salvo que me digas)',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Te escribo una última vez sobre {{asunto}}. Si ahora no es el momento, lo entiendo perfectamente y aquí me tienes cuando lo sea.</p>'
          + '<p>Gracias por tu tiempo en cualquier caso.</p>' + FIRMA),
      },
      // Este NO habla de "tu solicitud" a propósito: a un cliente dormido no le has mandado ninguna.
      'reenganche': {
        subject: 'Hace tiempo que no coincidimos',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Hace un tiempo que no coincidimos y quería escribirte para saludarte. Sigo por aquí para lo que necesites.</p>'
          + '<p>Si en algún momento te hace falta algo, dímelo y lo vemos sin compromiso.</p>' + FIRMA),
      },
    },
  },

  presupuesto: {
    familia: FAMILIA_CLIENTE,
    label: 'Envío de presupuesto',
    descripcion: 'El correo con el que le mandas un presupuesto a un cliente. El PDF va adjunto siempre, lo digas o no en el texto.',
    tonos: null,
    huecos: [
      { clave: 'numero', label: 'Nº de presupuesto' },
      { clave: 'validez', label: 'Válido hasta' },
      { clave: 'empresa', label: 'Tu negocio' },
    ],
    requeridos: ['numero'],
    ejemplo: { numero: 'P2026-0007', validez: '2026-08-15', empresa: 'Tu Negocio' },
    fabrica: {
      _: {
        subject: 'Presupuesto {{numero}} — {{empresa}}',
        html: MARCO('<p>Hola,</p>'
          + '<p>Adjuntamos tu presupuesto nº <strong>{{numero}}</strong> (válido hasta {{validez}}).</p>'
          + '<p style="color:#6b7280;font-size:12px;margin-top:24px">Enviado desde {{empresa}} con Bamburu.</p>'),
      },
    },
  },

  orden_compra: {
    familia: FAMILIA_CLIENTE,
    label: 'Orden de compra al proveedor',
    descripcion: 'Lo que le llega a tu proveedor cuando le envías una orden. El bloque {{documento}} es la orden en sí (líneas, cantidades y totales): puedes escribir alrededor, pero si lo quitas, el proveedor recibe un correo sin el pedido.',
    tonos: null,
    huecos: [
      { clave: 'numero', label: 'Nº de orden' },
      { clave: 'documento', label: 'La orden (tabla)', esHtml: true, bloque: true },
      { clave: 'empresa', label: 'Tu negocio' },
    ],
    requeridos: ['documento'],
    ejemplo: {
      numero: 'OC-0031', empresa: 'Tu Negocio',
      documento: { esHtml: true, valor: '<table style="width:100%;border-collapse:collapse"><tr><th style="border:1px solid #ddd;padding:6px">Producto</th><th style="border:1px solid #ddd;padding:6px">Cant.</th><th style="border:1px solid #ddd;padding:6px">Coste</th></tr><tr><td style="border:1px solid #ddd;padding:6px">Vela Lavanda 200g</td><td style="border:1px solid #ddd;padding:6px">10</td><td style="border:1px solid #ddd;padding:6px">2,50 €</td></tr></table><p><strong>Total (IVA incl.):</strong> 30,25 €</p>' },
    },
    fabrica: {
      _: {
        subject: 'Orden de compra {{numero}} — {{empresa}}',
        html: '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#1f2937">'
          + '{{documento}}'
          + '<p style="color:#6b7280;font-size:12px;margin-top:24px">Documento enviado desde {{empresa}} con Bamburu.</p></div>',
      },
    },
  },

  // ══ FAMILIA B — de sistema. El enlace NO se puede quitar. ═════════════════
  recuperar_password: {
    familia: FAMILIA_SISTEMA,
    label: 'Recuperar contraseña',
    descripcion: 'Se le manda a quien pide recuperar su contraseña. Sin el enlace, la persona se queda fuera de su cuenta: por eso no se puede guardar sin él.',
    tonos: null,
    huecos: [
      { clave: 'nombre', label: 'Nombre de la persona' },
      { clave: 'enlace', label: 'Enlace para recuperar', critico: true },
    ],
    requeridos: [],
    criticos: ['enlace'],
    motivoCritico: 'Sin el enlace de recuperación, quien lo reciba NO puede recuperar su contraseña y se queda fuera de su cuenta.',
    ejemplo: { nombre: 'Ibrahin', enlace: 'https://tunegocio.bamburu.com/reset?token=EJEMPLO' },
    fabrica: {
      _: {
        subject: 'Recupera tu contraseña en Bamburu',
        html: MARCO('<h2 style="font-size:20px;margin-bottom:16px">Hola, {{nombre}}</h2>'
          + '<p>Hemos recibido una solicitud para recuperar tu contraseña en Bamburu.</p>'
          + BOTON('Recuperar contraseña')
          + '<p style="color:#6b7280;font-size:13px;margin-top:24px">Este enlace expira en 1 hora. Si no solicitaste esto, ignora este email.</p>'),
      },
    },
  },

  portal_cliente: {
    familia: FAMILIA_SISTEMA,
    label: 'Enlace del portal del cliente',
    descripcion: 'El correo con el que tu cliente entra a su portal privado a ver y descargar sus facturas. Sin el enlace, no puede entrar.',
    tonos: null,
    huecos: [
      { clave: 'cliente', label: 'Nombre del cliente' },
      { clave: 'empresa', label: 'Tu negocio' },
      { clave: 'enlace', label: 'Enlace al portal', critico: true },
      { clave: 'dias', label: 'Días que dura el enlace' },
    ],
    requeridos: [],
    criticos: ['enlace'],
    motivoCritico: 'Sin el enlace del portal, tu cliente NO puede entrar a ver sus facturas: recibiría un correo que no sirve para nada.',
    ejemplo: { cliente: 'María García', empresa: 'Tu Negocio', enlace: 'https://tunegocio.bamburu.com/portal/EJEMPLO', dias: '14' },
    fabrica: {
      _: {
        subject: 'Tus facturas — {{empresa}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>{{empresa}} pone a tu disposición un portal privado donde puedes <b>ver y descargar tus facturas</b> y consultar su estado de pago.</p>'
          + BOTON('Ver mis facturas')
          + '<p style="color:#6b7280;font-size:12px">El enlace es personal y caduca en {{dias}} días. Si no lo has solicitado, ignora este correo.</p>'),
      },
    },
  },

  // ══ PIEZA 5 · CITAS — confirmación y recordatorio (SISTEMA: el enlace es crítico) ═══════════
  confirmacion_cita: {
    familia: FAMILIA_SISTEMA,
    label: 'Confirmación de cita',
    descripcion: 'Se lo mandas al cliente al crear o confirmar una cita. Lleva el enlace por el que puede confirmar o avisar de que no puede ir. Sin el enlace, el cliente no puede responder.',
    tonos: null,
    huecos: [
      { clave: 'cliente', label: 'Nombre del cliente' },
      { clave: 'empresa', label: 'Tu negocio' },
      { clave: 'servicio', label: 'Servicio(s)' },
      { clave: 'fecha', label: 'Día de la cita' },
      { clave: 'hora', label: 'Hora de la cita' },
      { clave: 'direccion', label: 'Dirección del negocio' },
      { clave: 'enlace', label: 'Enlace de la cita', critico: true },
    ],
    requeridos: [],
    criticos: ['enlace'],
    motivoCritico: 'Sin el enlace, tu cliente no puede confirmar la cita ni avisarte de que no puede ir: el correo no serviría de nada.',
    ejemplo: { cliente: 'María García', empresa: 'Tu Negocio', servicio: 'Corte + tinte', fecha: '2026-08-03', hora: '10:00', direccion: 'C/ Mayor 1, Madrid', enlace: 'https://tunegocio.bamburu.com/cita/EJEMPLO' },
    fabrica: {
      _: {
        subject: 'Tu cita en {{empresa}} — {{fecha}} a las {{hora}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Te confirmamos tu cita en <b>{{empresa}}</b>:</p>'
          + CAJA('<strong>Servicio:</strong> {{servicio}}<br><strong>Día:</strong> {{fecha}}<br><strong>Hora:</strong> {{hora}}<br><strong>Dónde:</strong> {{direccion}}')
          + '<p>Confírmala o avísanos si no puedes venir con un solo clic:</p>'
          + BOTON('Ver mi cita')
          + '<p style="color:#6b7280;font-size:12px">Este enlace es solo para tu cita. Si no la has solicitado, ignora este correo.</p>'),
      },
    },
  },

  recordatorio_cita: {
    familia: FAMILIA_SISTEMA,
    label: 'Recordatorio de cita',
    descripcion: 'El aviso del día antes. Puede salir solo por email (si lo activas en Ajustes) o mandarlo tú a mano. Lleva el mismo enlace de la cita.',
    tonos: null,
    huecos: [
      { clave: 'cliente', label: 'Nombre del cliente' },
      { clave: 'empresa', label: 'Tu negocio' },
      { clave: 'servicio', label: 'Servicio(s)' },
      { clave: 'fecha', label: 'Día de la cita' },
      { clave: 'hora', label: 'Hora de la cita' },
      { clave: 'direccion', label: 'Dirección del negocio' },
      { clave: 'enlace', label: 'Enlace de la cita', critico: true },
    ],
    requeridos: [],
    criticos: ['enlace'],
    motivoCritico: 'Sin el enlace, tu cliente no puede confirmar ni avisarte de que no puede ir desde el recordatorio.',
    ejemplo: { cliente: 'María García', empresa: 'Tu Negocio', servicio: 'Corte + tinte', fecha: '2026-08-03', hora: '10:00', direccion: 'C/ Mayor 1, Madrid', enlace: 'https://tunegocio.bamburu.com/cita/EJEMPLO' },
    fabrica: {
      _: {
        subject: 'Recordatorio: tu cita en {{empresa}} es mañana a las {{hora}}',
        html: MARCO('<p>Hola {{cliente}},</p>'
          + '<p>Te recordamos tu cita en <b>{{empresa}}</b>:</p>'
          + CAJA('<strong>Servicio:</strong> {{servicio}}<br><strong>Día:</strong> {{fecha}}<br><strong>Hora:</strong> {{hora}}<br><strong>Dónde:</strong> {{direccion}}')
          + '<p>Si no puedes venir, avísanos con un clic para poder dar tu hueco a otra persona:</p>'
          + BOTON('Ver mi cita')
          + '<p style="color:#6b7280;font-size:12px">Este enlace es solo para tu cita.</p>'),
      },
    },
  },

  resumen_avisos: {
    familia: FAMILIA_SISTEMA,
    label: 'Tu resumen diario',
    descripcion: 'El correo que TE llega a ti cada mañana con lo urgente del día. El bloque {{avisos}} es la lista: si lo quitas, el correo llega vacío de contenido.',
    tonos: null,
    huecos: [
      { clave: 'empresa', label: 'Tu negocio' },
      { clave: 'n', label: 'Nº de avisos' },
      { clave: 'resumen', label: 'Resumen en una frase' },
      { clave: 'avisos', label: 'La lista de avisos', esHtml: true, bloque: true, critico: true },
    ],
    requeridos: [],
    criticos: ['avisos'],
    motivoCritico: 'Sin la lista de avisos, el resumen diario llega VACÍO: no te enterarías de nada de lo urgente.',
    ejemplo: {
      empresa: 'Tu Negocio', n: '3', resumen: '2 cobros vencidos; 1 producto con stock bajo',
      avisos: { esHtml: true, valor: '<p style="margin:16px 0 6px;font-weight:700">Facturas de cliente vencidas (2)</p><table style="border-collapse:collapse;width:100%;background:#f9fafb;border-radius:8px"><tr><td style="padding:6px 8px;font-weight:600">María García</td><td style="padding:6px 8px;color:#b42318">F2026-0042 · 363,00 € · 12 días</td></tr></table>' },
    },
    fabrica: {
      _: {
        subject: 'Bamburu · {{n}} avisos que requieren tu atención',
        html: MARCO('<p>Hola,</p>'
          + '<p>Buenos días. Esto es lo que requiere tu atención hoy: {{resumen}}.</p>'
          + '{{avisos}}'
          + '<p style="margin-top:16px"><a href="https://bamburu.com" style="color:#2563eb">Entra en Bamburu</a> para gestionarlos.</p>'
          + '<p style="margin-top:24px;color:#6b7280;font-size:.85rem">Un saludo,<br>Bamburu (por {{empresa}})</p>'),
      },
    },
  },
};

// El tono por defecto de un tipo sin tonos (la clave interna de su única plantilla).
export const TONO_UNICO = '_';
export const tiposDe = (familia) => Object.entries(CATALOGO).filter(([, t]) => t.familia === familia);
export const esTonoValido = (tipoId, tono) => {
  const t = CATALOGO[tipoId];
  if (!t) return false;
  if (!t.tonos) return tono === TONO_UNICO;
  return t.tonos.some(x => x.clave === tono);
};

// ── La plantilla EN VIGOR para un tipo/tono: la editada si existe, si no la de fábrica ──
// La de fábrica NUNCA se pierde: vive en el código y la tabla solo guarda las ediciones. "Volver al
// original" es, literalmente, borrar la fila.
export function plantillaDeFabrica(tipoId, tono = TONO_UNICO) {
  const t = CATALOGO[tipoId];
  if (!t) return null;
  return t.fabrica[tono] || t.fabrica[TONO_UNICO] || null;
}

export function plantillaEnVigor(db, tipoId, tono = TONO_UNICO) {
  const fabrica = plantillaDeFabrica(tipoId, tono);
  if (!fabrica) return null;
  try {
    const fila = db.prepare('SELECT subject, html FROM email_templates WHERE tipo=? AND tono=?').get(tipoId, tono);
    if (fila && fila.html && fila.html.trim()) return { subject: fila.subject, html: fila.html, editada: true };
  } catch { /* sin tabla aún (migración pendiente): manda la de fábrica */ }
  return { ...fabrica, editada: false };
}

// RENDER FINAL: el email que se va a enviar. Es el ÚNICO camino: lo usan tanto los constructores de
// siempre (collectionEmail y compañía) como los envíos que tenían el HTML a mano. La ruta de envío no
// cambia — mismo Resend, mismo historial —: solo de dónde sale el texto.
export function renderEmail(db, tipoId, tono, vars) {
  const p = plantillaEnVigor(db, tipoId, tono || TONO_UNICO);
  if (!p) throw new Error('Tipo de plantilla desconocido: ' + tipoId);
  return pintar(p, vars);
}

// Render forzado con la de FÁBRICA (ignora lo editado). Para la vista previa del original y para los
// llamadores que no tienen `db` a mano (tests de la plantilla pura).
export function renderEmailFabrica(tipoId, tono, vars) {
  const p = plantillaDeFabrica(tipoId, tono || TONO_UNICO);
  if (!p) throw new Error('Tipo de plantilla desconocido: ' + tipoId);
  return pintar({ ...p, editada: false }, vars);
}

function pintar(p, vars) {
  const html = renderPlantilla(p.html, vars, { html: true });
  return {
    subject: renderPlantilla(p.subject, vars, { html: false }),
    html,
    text: htmlAtexto(html),
    editada: !!p.editada,
  };
}

// ── LA RED DE SEGURIDAD ─────────────────────────────────────────────────────
//
// Distinta por familia, y a propósito:
//   · CLIENTE → AVISA. Es su voz; si quiere mandar un recordatorio sin el nº de factura, allá él.
//   · SISTEMA → BLOQUEA. Un email operativo sin su enlace de acción no es un email raro: es una
//     persona que se queda fuera, y sin que nadie se entere hasta que pasa.
//
// Devuelve { bloquea, motivo, avisos[] }.
export function revisarPlantilla(tipoId, { subject, html }) {
  const t = CATALOGO[tipoId];
  if (!t) return { bloquea: true, motivo: 'Tipo de plantilla desconocido.', avisos: [] };

  const avisos = [];
  if (!String(subject || '').trim()) return { bloquea: true, motivo: 'El asunto no puede quedar vacío.', avisos };
  if (!htmlAtexto(html).trim()) return { bloquea: true, motivo: 'El mensaje no puede quedar vacío.', avisos };

  const usados = new Set([...huecosUsados(subject), ...huecosUsados(html)]);
  const label = (c) => (t.huecos.find(h => h.clave === c) || {}).label || c;

  // SISTEMA: el elemento crítico no es negociable.
  for (const c of (t.criticos || [])) {
    if (!usados.has(c)) {
      return {
        bloquea: true,
        motivo: 'Has quitado «' + label(c) + '», y este email no puede enviarse sin eso. '
          + (t.motivoCritico || '') + ' Vuelve a insertarlo para poder guardar.',
        avisos,
      };
    }
  }

  // CLIENTE: se avisa, no se bloquea.
  for (const c of (t.requeridos || [])) {
    if (!usados.has(c)) avisos.push('Has quitado «' + label(c) + '». El email se enviará igual, pero a tu cliente le faltará ese dato.');
  }
  return { bloquea: false, motivo: null, avisos };
}
