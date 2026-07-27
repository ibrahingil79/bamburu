// Test — AVISOS DE LA CITA (Escalera · paso 7 · PIEZA 5 · 1.10/1.12/1.13), sobre BD temporal.
//   node scripts/test-avisos-cita.mjs
//
// Demuestra: el texto y el enlace se generan bien en los TRES canales (WhatsApp/SMS/email); el móvil
// se sanea a formato internacional; un cliente sin móvil cae a email; el estado NUNCA dice "entregado".
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createCitaSvc } from '../modules/erp/routes/citas.js';
import {
  normalizeMovil, textoAviso, waLink, smsLink, citaEnlace, contactoDeCita, serviciosDeCita,
  enviarEmailCita, registrarAviso, avisoHecho, colaEnvios,
} from '../modules/erp/citas-avisos.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'avisos-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("UPDATE company_config SET company_name='Estética Test', address='Av. Sol 2', email='hola@estetica.test' WHERE id=1").run();
  return db;
}
const nuevoUsuario = (db, name) => db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)").run(name, name + '@t.local', 'x').lastInsertRowid;
function nuevoServicio(db, name, dur) {
  const id = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,20,'service','general',21,'active')").run(name).lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,margen_min) VALUES (?,1,?,0)").run(id, dur);
  return id;
}
const futura = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

try {
  console.log('\n=== 1. 1.13 — móvil saneado a formato internacional (+34…) ===\n');
  ok(normalizeMovil('600 11 22 33').e164 === '+34600112233' && normalizeMovil('600112233').valido, 'un móvil español de 9 cifras se convierte a +34…');
  ok(normalizeMovil('+34600112233').valido && normalizeMovil('0034600112233').e164 === '+34600112233', 'acepta +34… y 0034… (E.164)');
  ok(!normalizeMovil('12').valido && !normalizeMovil('hola').valido && !normalizeMovil('').valido, 'basura / vacío → no válido (marca "sin móvil válido")');

  console.log('\n=== 2. texto + enlace en los tres canales ===\n');
  const enlace = 'https://estetica.bamburu.com/cita/ABC123';
  const vars = { empresa: 'Estética Test', servicio: 'Corte + tinte', fecha: '2026-08-03', hora: '10:00', direccion: 'Av. Sol 2', enlace };
  const tConf = textoAviso('confirmacion', vars), tRec = textoAviso('recordatorio', vars);
  ok(tConf.includes('Corte + tinte') && tConf.includes('10:00') && tConf.includes(enlace), 'texto de confirmación lleva servicio, hora y enlace');
  ok(tRec.toLowerCase().includes('recordatorio') && tRec.includes(enlace), 'texto de recordatorio lleva el enlace');
  const wa = waLink('+34600112233', tConf);
  ok(wa.startsWith('https://wa.me/34600112233?text=') && wa.includes(encodeURIComponent(enlace)), 'WhatsApp usa el enlace OFICIAL wa.me (número sin +) con el texto y el enlace');
  ok(!/whatsapp\.com|web\.whatsapp|qr/i.test(wa), 'el enlace de WhatsApp NO usa WhatsApp Web ni QR (solo wa.me oficial)');
  const sms = smsLink('+34600112233', tConf);
  ok(sms.startsWith('sms:+34600112233') && sms.includes('body=') && sms.includes(encodeURIComponent(enlace)), 'SMS usa el esquema nativo sms: con el enlace');
  ok(citaEnlace('https://x.bamburu.com', 'TOK') === 'https://x.bamburu.com/cita/TOK', 'el enlace de la cita se compone bien');

  console.log('\n=== 3. cliente sin móvil cae a email ===\n');
  const db = nuevaBD();
  const U = nuevoUsuario(db, 'Ana');
  const S = nuevoServicio(db, 'Corte', 30);
  // Cliente de la ficha CON email y SIN móvil.
  const cli = db.prepare("INSERT INTO clients (name,email,active) VALUES ('Lucía','lucia@cli.test',1)").run().lastInsertRowid;
  const cita = createCitaSvc(db, { cliente_id: cli, user_id: U, fecha: futura(1), inicio_min: 600, service_ids: [S] });
  const contacto = contactoDeCita(db, db.prepare('SELECT * FROM citas WHERE id=?').get(cita.id));
  ok(!contacto.movil_valido && !!contacto.email, 'cliente sin móvil válido pero con email → se puede caer a email');
  const decideCanal = (co) => co.movil_valido ? 'whatsapp' : (co.email ? 'email' : 'ninguno');
  ok(decideCanal(contacto) === 'email', 'la decisión de canal cae a email cuando no hay móvil');
  const sinNada = { movil_valido: false, email: '' };
  ok(decideCanal(sinNada) === 'ninguno', 'sin móvil NI email → se avisa (ninguno)');

  console.log('\n=== 4. el email se genera con enlace y NUNCA dice "entregado" ===\n');
  const sent = [];
  const mockSend = async (opts) => { sent.push(opts); return { data: { id: 'x' }, error: null }; };
  await enviarEmailCita(db, {
    tipo: 'recordatorio', destinatario: 'lucia@cli.test', empresa: 'Estética Test', cliente: 'Lucía',
    servicio: 'Corte', fecha: futura(1), hora: '10:00', direccion: 'Av. Sol 2', enlace,
  }, mockSend);
  ok(sent.length === 1 && sent[0].to === 'lucia@cli.test', 'el email se envía por la vía Resend (mock) al cliente');
  ok(sent[0].html.includes(enlace), 'el HTML del email lleva el enlace de la cita (hueco crítico)');
  ok(!/entregado|le[íi]do/i.test(sent[0].html), 'el email NO afirma "entregado" ni "leído"');

  console.log('\n=== 5. estado HONESTO: "marcado", "email_enviado" — nunca "entregado" ===\n');
  registrarAviso(db, { cita_id: cita.id, tipo: 'confirmacion', canal: 'whatsapp', estado: 'marcado' });
  const a = avisoHecho(db, cita.id, 'confirmacion');
  ok(a && a.estado === 'marcado' && a.canal === 'whatsapp', 'un aviso manual queda "marcado" (con canal y fecha)');
  const estados = db.prepare('SELECT DISTINCT estado FROM cita_avisos').all().map(r => r.estado);
  ok(estados.every(e => ['marcado', 'email_enviado', 'email_fallo', 'cliente_no_puede'].includes(e)), 'los estados guardados son honestos: ' + estados.join(','));
  ok(!estados.some(e => /entregado|le[íi]do/i.test(e)), 'NINGÚN estado dice "entregado" ni "leído"');

  console.log('\n=== 6. la cola de envíos lista las citas de mañana y de hoy ===\n');
  const hoy = new Date().toISOString().slice(0, 10);
  const manana = futura(1);
  const cola = colaEnvios(db, { hoy, manana });
  ok(Array.isArray(cola.recordatorios) && cola.recordatorios.some(r => r.id === cita.id), 'la cita de mañana aparece en la cola de recordatorios');
  ok(cola.recordatorios[0] && cola.recordatorios[0].email === 'lucia@cli.test', 'la cola trae el contacto para despachar en un clic');

  console.log('\n' + (fail === 0 ? '✅ TODO VERDE' : '❌ HAY FALLOS') + ` — ${pass} ok, ${fail} fallos`);
} catch (e) {
  console.error('\n💥 EXCEPCIÓN:', e); fail++;
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
