// ════════════════════════════════════════════════════════════════════════════════════════════════
// DESCUENTOS, PROMOCIONES Y BONOS — el motor · punto 11, 23 ago 2026
//
// LA DECISIÓN QUE LO GOBIERNA TODO: **un descuento es una LÍNEA del documento**, con importe
// negativo y el MISMO tipo de IVA que lo que rebaja. No una columna de la cabecera.
//   · No toca el motor fiscal: `computeTotals` ya suma líneas negativas —el subtotal baja, el IVA
//     baja en proporción y el desglose por tipo cuadra—, así que ni el sello ni VERI*FACTU cambian.
//   · Y en el papel SE LEE: el cliente ve qué le has descontado y por qué, en vez de un total más
//     bajo sin explicación. Un descuento escondido en la cabecera es un número que nadie puede
//     comprobar.
//
// LA SEGUNDA DECISIÓN: **el motor PROPONE, el usuario CONFIRMA** (CANON). `proponer()` devuelve
// líneas; NO las mete en ningún documento. Quien emite decide, y por eso `aplicar` no existe.
//
// EL IVA DE UN DESCUENTO no se elige: se reparte. Si el documento lleva líneas al 21 % y al 10 %,
// un 10 % de descuento genera DOS líneas de descuento, una por cada tipo, en proporción a su base.
// Meterlo todo al tipo más alto rebajaría más IVA del que corresponde, y eso es un error de
// declaración. Con un solo tipo, sale una sola línea, que es el caso normal.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const hoyISO = () => new Date().toISOString().slice(0, 10);

// ── PROMOCIONES ─────────────────────────────────────────────────────────────────────────────────
export function listarPromociones(db, { soloActivas = false } = {}) {
  try {
    return db.prepare(
      'SELECT * FROM promociones' + (soloActivas ? ' WHERE activa=1' : '') + ' ORDER BY activa DESC, id DESC'
    ).all();
  } catch { return []; }
}
export function getPromocion(db, id) {
  try { return db.prepare('SELECT * FROM promociones WHERE id=?').get(id) || null; } catch { return null; }
}
const err = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };

export function guardarPromocion(db, { id = null, nombre, codigo = '', tipo = 'porcentaje', valor = 0,
                                       desde = null, hasta = null, minimo = 0, alcance = 'todo',
                                       categoria_id = null, product_id = null, usos_max = null, activa = 1 }) {
  const n = String(nombre || '').trim();
  if (!n) throw err('La promoción necesita un nombre.');
  if (!['porcentaje', 'importe'].includes(tipo)) throw err('El tipo solo puede ser porcentaje o importe.');
  const v = Number(valor) || 0;
  if (v <= 0) throw err('El valor tiene que ser mayor que cero.');
  // UN PORCENTAJE MAYOR QUE 100 NO ES UN DESCUENTO, ES UN REGALO CON VUELTAS. Se para aquí.
  if (tipo === 'porcentaje' && v > 100) throw err('Un porcentaje de descuento no puede pasar del 100 %.');
  if (!['todo', 'categoria', 'producto'].includes(alcance)) throw err('Alcance no válido.');
  if (alcance === 'categoria' && !categoria_id) throw err('Elige la categoría a la que se aplica.');
  if (alcance === 'producto' && !product_id) throw err('Elige el producto al que se aplica.');
  if (desde && hasta && String(hasta) < String(desde)) throw err('La fecha de fin es anterior a la de inicio.');
  const args = [n, String(codigo || '').trim().toUpperCase(), tipo, v, desde || null, hasta || null,
                Number(minimo) || 0, alcance, alcance === 'categoria' ? categoria_id : null,
                alcance === 'producto' ? product_id : null, usos_max == null || usos_max === '' ? null : Number(usos_max),
                activa ? 1 : 0];
  if (id) {
    db.prepare(`UPDATE promociones SET nombre=?, codigo=?, tipo=?, valor=?, desde=?, hasta=?, minimo=?,
                  alcance=?, categoria_id=?, product_id=?, usos_max=?, activa=? WHERE id=?`).run(...args, id);
    return { id: Number(id) };
  }
  const r = db.prepare(`INSERT INTO promociones (nombre,codigo,tipo,valor,desde,hasta,minimo,alcance,
                          categoria_id,product_id,usos_max,activa) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...args);
  return { id: Number(r.lastInsertRowid) };
}
// «Borrar» una promoción es APAGARLA: su histórico de usos es un dato, y la regla del proyecto es
// archivar, nunca destruir.
export function archivarPromocion(db, id) {
  const p = getPromocion(db, id); if (!p) throw err('Esa promoción no existe.', 404);
  db.prepare('UPDATE promociones SET activa=0 WHERE id=?').run(id);
  return { id: Number(id), activa: 0 };
}

// ¿Está viva HOY? Fecha dentro de ventana, activa, y con usos disponibles.
export function promocionVigente(p, hoy = hoyISO()) {
  if (!p || !p.activa) return false;
  if (p.desde && hoy < String(p.desde)) return false;
  if (p.hasta && hoy > String(p.hasta)) return false;
  if (p.usos_max != null && Number(p.usos) >= Number(p.usos_max)) return false;
  return true;
}

// ── BONOS ───────────────────────────────────────────────────────────────────────────────────────
export function bonosDe(db, clientId, { soloVivos = false } = {}) {
  try {
    const filas = db.prepare('SELECT * FROM bonos WHERE client_id=? ORDER BY activo DESC, id DESC').all(clientId);
    const hoy = hoyISO();
    return filas.map(b => ({
      ...b,
      quedan: Math.max(0, Number(b.sesiones) - Number(b.usadas)),
      caducado: !!(b.caduca && hoy > String(b.caduca)),
    })).filter(b => !soloVivos || (b.activo && b.quedan > 0 && !b.caducado));
  } catch { return []; }
}
export function crearBono(db, { client_id, nombre, product_id = null, sesiones, importe = 0, invoice_id = null, caduca = null }) {
  if (!client_id || !db.prepare('SELECT 1 FROM clients WHERE id=?').get(client_id)) throw err('Ese cliente no existe.', 404);
  const n = String(nombre || '').trim(); if (!n) throw err('El bono necesita un nombre.');
  const s = Number(sesiones) || 0; if (s <= 0) throw err('Un bono tiene que traer al menos una sesión.');
  const r = db.prepare(`INSERT INTO bonos (client_id,nombre,product_id,sesiones,importe,invoice_id,caduca)
                        VALUES (?,?,?,?,?,?,?)`).run(client_id, n, product_id || null, s, Number(importe) || 0,
                                                     invoice_id || null, caduca || null);
  return { id: Number(r.lastInsertRowid) };
}
// CONSUMIR NO EMITE FACTURA: el ingreso se declaró al vender el bono. Aquí solo baja el contador y
// se apunta el consumo, para que «¿cuándo gastó las cinco?» tenga respuesta.
export function consumirBono(db, bonoId, { sesiones = 1, fecha = null, cita_id = null, nota = '', user_id = null } = {}) {
  const b = db.prepare('SELECT * FROM bonos WHERE id=?').get(bonoId);
  if (!b) throw err('Ese bono no existe.', 404);
  const quedan = Number(b.sesiones) - Number(b.usadas);
  const n = Number(sesiones) || 1;
  if (!b.activo) throw err('Ese bono está archivado.');
  if (b.caduca && hoyISO() > String(b.caduca)) throw err('Ese bono caducó el ' + b.caduca + '.');
  if (n > quedan) throw err('Al bono le quedan ' + quedan + ' sesión(es), y se piden ' + n + '.');
  const tx = db.transaction(() => {
    db.prepare('UPDATE bonos SET usadas = usadas + ? WHERE id=?').run(n, bonoId);
    db.prepare(`INSERT INTO bono_consumos (bono_id,fecha,sesiones,cita_id,nota,user_id)
                VALUES (?,?,?,?,?,?)`).run(bonoId, fecha || hoyISO(), n, cita_id || null, String(nota || ''), user_id || null);
  });
  tx();
  return { id: Number(bonoId), usadas: Number(b.usadas) + n, quedan: quedan - n };
}
// Deshacer un consumo: se BORRA el apunte y se devuelve la sesión. Es el único borrado del módulo, y
// tiene motivo: un consumo apuntado por error le quita al cliente algo que pagó.
export function deshacerConsumo(db, consumoId) {
  const c = db.prepare('SELECT * FROM bono_consumos WHERE id=?').get(consumoId);
  if (!c) throw err('Ese consumo no existe.', 404);
  const tx = db.transaction(() => {
    db.prepare('UPDATE bonos SET usadas = MAX(0, usadas - ?) WHERE id=?').run(c.sesiones, c.bono_id);
    db.prepare('DELETE FROM bono_consumos WHERE id=?').run(consumoId);
  });
  tx();
  return { ok: true, bono_id: c.bono_id };
}
export function consumosDe(db, bonoId) {
  try { return db.prepare('SELECT * FROM bono_consumos WHERE bono_id=? ORDER BY fecha DESC, id DESC').all(bonoId); }
  catch { return []; }
}

// ── EL MOTOR: QUÉ DESCUENTOS TOCAN, Y EN QUÉ LÍNEAS SE CONVIERTEN ──────────────────────────────
// `lineas` es lo que ya lleva el documento: [{description, quantity, unit_price, tax_rate, product_id}]
// Devuelve { propuestas: [...], lineas: [...] } — las líneas ya listas para añadir, y el porqué
// de cada una. NO escribe nada.
export function proponer(db, { clientId = null, lineas = [], codigo = '', hoy = hoyISO(), incluirCliente = true } = {}) {
  const base = [];
  for (const l of (lineas || [])) {
    const b = r2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
    if (b <= 0) continue;                       // una línea que ya es un descuento no se re-descuenta
    base.push({ ...l, _base: b, _rate: Number(l.tax_rate) || 0, _pid: l.product_id || null });
  }
  const baseTotal = r2(base.reduce((s, l) => s + l._base, 0));
  const propuestas = [];
  if (baseTotal <= 0) return { propuestas, lineas: [], baseTotal };

  // (1) EL DESCUENTO DEL CLIENTE — el que lleva siempre, si lo tiene.
  const cli = clientId ? db.prepare('SELECT id, name, descuento_pct FROM clients WHERE id=?').get(clientId) : null;
  if (incluirCliente && cli && Number(cli.descuento_pct) > 0) {
    propuestas.push({ origen: 'cliente', id: cli.id, nombre: 'Descuento de cliente',
      motivo: cli.name + ' tiene un ' + Number(cli.descuento_pct) + ' % fijo en su ficha',
      tipo: 'porcentaje', valor: Number(cli.descuento_pct), sobre: base });
  }

  // (2) LAS PROMOCIONES VIGENTES. Las que llevan CÓDIGO solo entran si se ha tecleado el suyo: una
  // promoción con código que se aplicara sola no sería un código, sería una rebaja.
  for (const p of listarPromociones(db, { soloActivas: true })) {
    if (!promocionVigente(p, hoy)) continue;
    if (p.codigo && String(p.codigo).toUpperCase() !== String(codigo || '').trim().toUpperCase()) continue;
    let sobre = base;
    if (p.alcance === 'producto') sobre = base.filter(l => l._pid && Number(l._pid) === Number(p.product_id));
    if (p.alcance === 'categoria') {
      const ids = new Set(db.prepare('SELECT id FROM products WHERE category_id=?').all(p.categoria_id).map(x => x.id));
      sobre = base.filter(l => l._pid && ids.has(Number(l._pid)));
    }
    const baseSobre = r2(sobre.reduce((s, l) => s + l._base, 0));
    if (baseSobre <= 0) continue;
    // El MÍNIMO se mide sobre el documento entero, no sobre lo que la promo alcanza: es lo que
    // significa «pedido mínimo».
    if (Number(p.minimo) > 0 && baseTotal < Number(p.minimo)) continue;
    propuestas.push({ origen: 'promocion', id: p.id, nombre: p.nombre,
      motivo: p.codigo ? ('código ' + p.codigo) : ('promoción vigente' + (p.hasta ? ' hasta el ' + p.hasta : '')),
      tipo: p.tipo, valor: Number(p.valor), sobre });
  }

  // (3) DE PROPUESTA A LÍNEAS. Cada una se reparte entre los tipos de IVA que toca, en proporción.
  const out = [];
  for (const pr of propuestas) {
    const baseSobre = r2(pr.sobre.reduce((s, l) => s + l._base, 0));
    if (baseSobre <= 0) continue;
    // Un descuento de importe fijo NUNCA puede dejar la base en negativo: se recorta a lo que hay.
    const total = pr.tipo === 'porcentaje' ? r2(baseSobre * pr.valor / 100) : Math.min(r2(pr.valor), baseSobre);
    if (total <= 0) continue;
    const porTipo = new Map();
    for (const l of pr.sobre) porTipo.set(l._rate, r2((porTipo.get(l._rate) || 0) + l._base));
    const tipos = [...porTipo.entries()];
    let repartido = 0;
    tipos.forEach(([rate, b], i) => {
      // El último se lleva el resto: así la suma de las partes es EXACTAMENTE el total, sin céntimos
      // perdidos por redondeo. Es la misma regla que usa el reparto de IVA del documento.
      const trozo = i === tipos.length - 1 ? r2(total - repartido) : r2(total * b / baseSobre);
      repartido = r2(repartido + trozo);
      if (trozo <= 0) return;
      out.push({
        description: pr.nombre + (tipos.length > 1 ? ' (IVA ' + rate + ' %)' : '') + ' — ' + pr.motivo,
        quantity: 1, unit_price: -trozo, tax_rate: rate, product_id: null,
        _descuento: { origen: pr.origen, id: pr.id },
      });
    });
    pr.importe = total;
  }
  return { propuestas, lineas: out, baseTotal };
}

// Cuando un documento se emite CON una promoción, su contador sube. Se llama desde quien emite, no
// desde el motor: el motor no sabe si al final se emitió.
export function apuntarUso(db, promocionId) {
  try { db.prepare('UPDATE promociones SET usos = usos + 1 WHERE id=?').run(promocionId); } catch {}
}
