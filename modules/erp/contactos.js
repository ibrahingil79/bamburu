// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL REGISTRO DE CONTACTOS — todo lo que ha pasado con un cliente, y qué parte de eso es una VISITA
//
// EL PROBLEMA QUE RESUELVE. «Última vez que vino» solo sabía mirar la agenda. En un negocio que
// factura sin citas, la ficha decía «0 visitas» de un cliente con 21 facturas; y en cualquier negocio
// no había forma de saber cuándo se habló por última vez con alguien, aunque Bamburu le hubiera
// mandado tres correos.
//
// LA TRAMPA QUE HAY QUE NO PISAR. Lo evidente sería juntarlo todo en «última vez que supimos de él».
// Sería un desastre: **tres recordatorios automáticos harían parecer vivo a un cliente que lleva año
// y medio sin aparecer**, y el detector de enfriamiento —que es de las pocas cosas que trabajan solas
// para el dueño— dejaría de avisar justo de los clientes que se están yendo. Un aviso que no salta es
// peor que no tener aviso: nadie lo echa de menos.
//
// POR ESO HAY DOS COSAS, Y NO UNA:
//
//   CONTACTO  = cualquier trato. Presencial, teléfono, WhatsApp, correo, mensaje, cita.
//   VISITA    = SOLO cita atendida, factura, venta de mostrador y presencial apuntado a mano.
//
// Y de ahí las dos tarjetas de la ficha: «Último contacto» (todo) y «Última vez que vino» (visitas).
// En un cliente con tres correos automáticos y ninguna visita en 18 meses **dan fechas distintas**, y
// esa diferencia es exactamente la información que el dueño necesita.
//
// LO QUE ESTE FICHERO NO HACE: no toca `clientesFueraDeRitmo`. El detector sigue leyendo `citas` con
// `estado='atendida'` como leía ayer, ni una consulta cambiada. Si algún día se le quiere dar de
// comer los contactos, será un encargo con su gate — no un efecto lateral de esta tabla.
//
// DISA NO ESCRIBE AQUÍ. `client_contacts` está fuera de WRITABLE_TABLES a propósito: inventarse un
// contacto es inventarse una conversación, y el dueño acabaría discutiendo con un cliente sobre una
// llamada que nunca ocurrió.
import { countingSalesInvoices } from './ventas-metrics.js';

// ── LOS TIPOS ────────────────────────────────────────────────────────────────────────────────────
// `visita` dice si ese tipo cuenta como «vino». `manual` si se puede apuntar a mano (D3).
// `aviso` es la coletilla honesta que la pantalla enseña: WhatsApp **no está conectado a Bamburu**, y
// eso se dice en vez de fingir una integración que no existe.
export const TIPOS = {
  presencial: { etiqueta: 'Presencial', icon: 'ti-user-check', visita: true,  manual: true },
  cita:       { etiqueta: 'Cita',       icon: 'ti-calendar-event', visita: true,  manual: false },
  telefono:   { etiqueta: 'Teléfono',   icon: 'ti-phone',      visita: false, manual: true },
  whatsapp:   { etiqueta: 'WhatsApp',   icon: 'ti-brand-whatsapp', visita: false, manual: true,
                aviso: 'WhatsApp no está conectado a Bamburu: esto lo apuntas tú.' },
  correo:     { etiqueta: 'Correo',     icon: 'ti-mail',       visita: false, manual: true },
  mensaje:    { etiqueta: 'Mensaje',    icon: 'ti-message',    visita: false, manual: true },
};
export const DIRECCIONES = { entrante: 'Entrante', saliente: 'Saliente' };
const esTipo = t => Object.prototype.hasOwnProperty.call(TIPOS, t);

const ahoraLocal = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const diasEntre = (a, b) => Math.round((Date.parse(a.slice(0, 10) + 'T00:00:00Z') - Date.parse(b.slice(0, 10) + 'T00:00:00Z')) / 86400000);

// ── APUNTAR ──────────────────────────────────────────────────────────────────────────────────────
// `es_visita` NO lo decide quien llama: lo decide el TIPO. Así no puede colarse un correo marcado
// como visita por un fallo de una pantalla, ni un automático contar como que el cliente apareció.
// Un contacto automático NUNCA es visita, aunque su tipo lo fuera.
export function apuntarContacto(db, {
  client_id, tipo, fecha = null, direccion = 'saliente', resultado = '',
  doc_tipo = null, doc_id = null, user_id = null, user_name = '',
  automatico = false, origen = 'manual',
} = {}) {
  if (!esTipo(tipo)) { const e = new Error('No conozco el tipo de contacto "' + tipo + '"'); e.status = 400; throw e; }
  const cli = db.prepare('SELECT id FROM clients WHERE id=?').get(Number(client_id));
  if (!cli) { const e = new Error('Ese cliente no existe'); e.status = 404; throw e; }
  const auto = automatico ? 1 : 0;
  const visita = (TIPOS[tipo].visita && !auto) ? 1 : 0;
  const f = String(fecha || ahoraLocal()).slice(0, 16);
  try {
    const r = db.prepare(
      `INSERT INTO client_contacts (client_id,fecha,tipo,direccion,es_visita,es_automatico,resultado,
                                    doc_tipo,doc_id,user_id,user_name,origen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(Number(client_id), f, tipo, DIRECCIONES[direccion] ? direccion : 'saliente',
          visita, auto, String(resultado || '').slice(0, 2000),
          doc_tipo || null, doc_id == null ? null : Number(doc_id),
          user_id == null ? null : Number(user_id), String(user_name || ''), origen);
    return { id: r.lastInsertRowid, es_visita: !!visita, es_automatico: !!auto };
  } catch (e) {
    // El índice único (doc_tipo, doc_id, tipo) impide que un documento genere dos contactos. Que
    // salte NO es un error: es la red haciendo su trabajo cuando el disparador corre dos veces.
    if (/UNIQUE/i.test(String(e && e.message))) return { id: null, duplicado: true };
    throw e;
  }
}

// ── LOS QUE SE APUNTAN SOLOS (D2) ────────────────────────────────────────────────────────────────
// Se llaman desde donde ya pasa la cosa; son idempotentes por el índice único, así que llamarlos de
// más no ensucia nada. Ninguno lanza: un contacto que no se pudo apuntar NO puede tumbar una factura.
export function contactoDeFactura(db, invoice) {
  try {
    if (!invoice?.client_id) return null;   // mostrador sin cliente no es de nadie
    return apuntarContacto(db, {
      client_id: invoice.client_id, tipo: 'presencial', direccion: 'entrante',
      fecha: String(invoice.issue_date || '').slice(0, 10) + ' 00:00',
      doc_tipo: 'factura', doc_id: invoice.id, origen: 'auto',
      resultado: 'Compró: ' + (invoice.invoice_number || 'factura ' + invoice.id),
    });
  } catch { return null; }
}

export function contactoDeCita(db, cita) {
  try {
    if (!cita?.cliente_id) return null;
    // Atendida cuenta como visita; cancelada y plantón se apuntan igual (pasó algo con ese cliente)
    // pero NO son visita: no pisó el negocio.
    const atendida = cita.estado === 'atendida';
    return apuntarContacto(db, {
      client_id: cita.cliente_id, tipo: atendida ? 'cita' : 'mensaje', direccion: 'entrante',
      fecha: String(cita.fecha || '').slice(0, 10) + ' ' + minutosAHora(cita.inicio_min),
      doc_tipo: 'cita', doc_id: cita.id, origen: 'auto',
      resultado: atendida ? 'Cita atendida'
        : (cita.estado === 'no_show' ? 'No se presentó' : 'Cita cancelada'),
    });
  } catch { return null; }
}

// Un correo que manda BAMBURU (recordatorio, confirmación) va MARCADO COMO AUTOMÁTICO y nunca es
// visita. Uno que escribe una persona desde el CRM es saliente y tampoco es visita, pero sí cuenta
// como contacto de verdad.
export function contactoDeCorreo(db, { client_id, asunto = '', automatico = false, user_id = null, user_name = '', doc_id = null }) {
  try {
    if (!client_id) return null;
    return apuntarContacto(db, {
      client_id, tipo: 'correo', direccion: 'saliente', automatico,
      doc_tipo: doc_id ? 'correo' : null, doc_id, origen: 'auto',
      user_id, user_name, resultado: asunto || (automatico ? 'Correo automático de Bamburu' : 'Correo enviado'),
    });
  } catch { return null; }
}

const minutosAHora = m => {
  const n = Number(m); if (!Number.isFinite(n)) return '00:00';
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
};

// ── LEER EL REGISTRO ─────────────────────────────────────────────────────────────────────────────
// Cronológico, lo más reciente arriba. `tipo` filtra; `soloVisitas` es lo que piden las tarjetas de
// «vino». Devuelve además el HUECO en días respecto de la visita anterior, que es lo que la tarjeta
// «cada cuánto viene» enseña para que la mediana se pueda comprobar a ojo.
export function contactosDe(db, clientId, { tipo = '', soloVisitas = false, desde = 0, cuantos = 50 } = {}) {
  let filas = [];
  try {
    const where = ['client_id=?', 'active=1'];
    const args = [Number(clientId)];
    if (tipo && esTipo(tipo)) { where.push('tipo=?'); args.push(tipo); }
    if (soloVisitas) where.push('es_visita=1');
    filas = db.prepare(
      `SELECT * FROM client_contacts WHERE ${where.join(' AND ')} ORDER BY fecha DESC, id DESC`).all(...args);
  } catch { return { total: 0, eventos: [], hay_mas: false, tipos: [] }; }
  // El hueco se calcula sobre las VISITAS, en orden ascendente, aunque la lista se enseñe al revés.
  const visitas = filas.filter(f => f.es_visita).map(f => f.fecha).sort();
  const hueco = new Map();
  for (let i = 1; i < visitas.length; i++) hueco.set(visitas[i], diasEntre(visitas[i], visitas[i - 1]));
  const eventos = filas.slice(desde, desde + cuantos).map(f => ({
    id: f.id, fecha: f.fecha, tipo: f.tipo, etiqueta: TIPOS[f.tipo]?.etiqueta || f.tipo,
    icon: TIPOS[f.tipo]?.icon || 'ti-point', direccion: f.direccion,
    es_visita: !!f.es_visita, es_automatico: !!f.es_automatico,
    resultado: f.resultado || '', quien: f.es_automatico ? 'Bamburu' : (f.user_name || '—'),
    doc_tipo: f.doc_tipo, doc_id: f.doc_id,
    href: f.doc_tipo === 'factura' && f.doc_id ? '/admin/invoices/' + f.doc_id : null,
    hueco_dias: f.es_visita ? (hueco.get(f.fecha) ?? null) : null,
  }));
  return {
    total: filas.length, eventos, hay_mas: desde + cuantos < filas.length,
    tipos: [...new Set(filas.map(f => f.tipo))].sort(),
    visitas: visitas.length,
  };
}

// ── LAS VISITAS, UNA A UNA, VENGAN DE DONDE VENGAN ──────────────────────────────────────────────
// `contactosDe` solo sabe de esta tabla, que **nace vacía**: lo histórico vive en las facturas y en
// la agenda. Si la tarjeta dijera «última visita: 11 de julio» (leído de las facturas) y al abrirla
// no hubiera ninguna, la ficha se estaría contradiciendo a sí misma en dos clics — y eso es peor que
// no tener el detalle. Así que la lista de visitas se compone de las MISMAS tres fuentes que
// `diasDeVisita`, y por construcción cuadra con ella.
export function visitasDetalle(db, clientId, puede = () => true, ventas = null) {
  const ev = [];
  if (puede('citas.read')) {
    try {
      for (const r of db.prepare(
        "SELECT id, fecha, inicio_min FROM citas WHERE cliente_id=? AND estado='atendida' AND archived=0").all(clientId))
        ev.push({ fecha: String(r.fecha).slice(0, 10) + ' ' + minutosAHora(r.inicio_min), tipo: 'cita',
                  resultado: 'Cita atendida', doc_tipo: 'cita', doc_id: r.id, quien: '—' });
    } catch { /* sin agenda */ }
  }
  if (puede('invoices.read')) {
    try {
      for (const i of (ventas || countingSalesInvoices(db, {}))) {
        if (Number(i.client_id) !== Number(clientId)) continue;
        ev.push({ fecha: String(i.issue_date).slice(0, 10) + ' 00:00', tipo: 'presencial',
                  resultado: 'Compró: ' + (i.invoice_number || 'factura ' + i.id),
                  doc_tipo: 'factura', doc_id: i.id, quien: '—',
                  href: '/admin/invoices/' + i.id });
      }
    } catch { /* sin facturas */ }
  }
  try {
    // Los presenciales apuntados A MANO. Los derivados de factura o cita ya entraron arriba por su
    // documento, así que aquí se dejan fuera para no contarlos dos veces.
    for (const r of db.prepare(
      'SELECT * FROM client_contacts WHERE client_id=? AND active=1 AND es_visita=1 AND doc_id IS NULL').all(clientId))
      ev.push({ fecha: r.fecha, tipo: r.tipo, resultado: r.resultado || 'Vino',
                quien: r.user_name || '—', id: r.id, manual: true });
  } catch { /* tabla aún sin migrar */ }

  // Un día = una visita: si hay factura Y cita el mismo día, se queda la primera y se dice.
  ev.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  const porDia = new Map();
  for (const e of ev) {
    const d = e.fecha.slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, { ...e, dia: d, tambien: 0 });
    else porDia.get(d).tambien++;
  }
  const dias = [...porDia.values()];
  for (let i = 0; i < dias.length; i++) {
    dias[i].hueco_dias = i > 0 ? diasEntre(dias[i].dia, dias[i - 1].dia) : null;
    dias[i].es_visita = true;
    dias[i].etiqueta = TIPOS[dias[i].tipo]?.etiqueta || dias[i].tipo;
    dias[i].icon = TIPOS[dias[i].tipo]?.icon || 'ti-point';
  }
  return dias.reverse();   // lo más reciente arriba, como el resto de la ficha
}

// ── LAS DOS FECHAS QUE PINTAN LAS TARJETAS ───────────────────────────────────────────────────────
// `ultimoContacto` mira TODO (incluido lo automático, marcado como tal para que la pantalla lo diga).
// `ultimaVisita` mira SOLO visitas — y además de la tabla de contactos, los documentos que ya existen,
// porque esta tabla nace vacía y lo histórico vive en las facturas y en la agenda. Nada se recalcula
// hacia atrás (R4): se LEE de donde ya estaba.
export function ultimoContacto(db, clientId, puede) {
  try {
    const f = db.prepare(
      'SELECT * FROM client_contacts WHERE client_id=? AND active=1 ORDER BY fecha DESC, id DESC LIMIT 1')
      .get(Number(clientId));
    if (!f) return null;
    return { fecha: f.fecha, tipo: f.tipo, etiqueta: TIPOS[f.tipo]?.etiqueta || f.tipo,
             es_automatico: !!f.es_automatico, quien: f.es_automatico ? 'Bamburu' : (f.user_name || '—'),
             dias: diasEntre(ahoraLocal(), f.fecha) };
  } catch { return null; }
}

// Los días en los que el cliente VINO, de más antiguo a más nuevo, sin repetir día. Une tres fuentes
// que dicen lo mismo desde sitios distintos: la agenda (que es la que manda donde hay agenda), las
// facturas que cuentan como venta, y los presenciales apuntados a mano.
// `ventas` permite pasar la lista de facturas YA calculada: quien llama (la ficha) la tiene, y
// volver a barrer la tabla entera aquí eran 55 ms de repetir el mismo trabajo.
export function diasDeVisita(db, clientId, puede = () => true, ventas = null) {
  const dias = new Set();
  // CADA FUENTE, SU PERMISO. La agenda solo se lee con `citas.read`: sin él, una fecha de visita
  // sacada de una cita sería información de agenda entrando por la puerta de atrás. Quien no puede
  // ver las citas obtiene el ritmo de lo que SÍ puede ver —sus documentos—, y si tampoco puede ver
  // esos, no obtiene ritmo. Lo que no se puede ver, no viaja.
  if (puede('citas.read')) {
    try {
      for (const r of db.prepare(
        "SELECT fecha FROM citas WHERE cliente_id=? AND estado='atendida' AND archived=0").all(clientId))
        dias.add(String(r.fecha).slice(0, 10));
    } catch { /* sin agenda */ }
  }
  if (puede('invoices.read')) {
    try {
      for (const i of (ventas || countingSalesInvoices(db, {})))
        if (Number(i.client_id) === Number(clientId)) dias.add(String(i.issue_date).slice(0, 10));
    } catch { /* sin facturas */ }
  }
  try {
    for (const r of db.prepare(
      'SELECT fecha FROM client_contacts WHERE client_id=? AND active=1 AND es_visita=1').all(clientId))
      dias.add(String(r.fecha).slice(0, 10));
  } catch { /* tabla aún sin migrar */ }
  return [...dias].sort();
}
