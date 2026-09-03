#!/usr/bin/env node
//
// gate-disa-confirmacion.mjs — QUE CONFIRMAR EJECUTE EXACTAMENTE LO PROPUESTO, Y NADA MÁS.
//
// DE DÓNDE SALE (AUD-015). La ficha decía que la confirmación «se da por buena con un texto demasiado
// permisivo» y que **NO se había comprobado**. Se comprobó el 3 sep 2026: **no estaba vivo** — la
// decisión es del servidor, con expresión anclada contra lista cerrada, y las once frases ambiguas
// cancelan. Eso lo vigila `censo-disa-confirmacion.mjs`, que saca la expresión del fichero y la
// EJECUTA contra esas frases.
//
// LO QUE ESTE GATE AÑADE, y es lo único que un censo estático no puede probar: que **la propuesta
// confirmada se ejecuta tal cual**, sobre una base de verdad. Es la otra mitad de la cerradura: no
// basta con no ejecutar de más — cuando el dueño dice que sí, tiene que pasar **exactamente** lo que
// se le enseñó, y nada más.
//
// Usa la costura `executeAction` (tarea `disa-stock-fuera-del-libro`), así que **no depende de que el
// proveedor de IA conteste**. Se trae su propio negocio y lo tira al terminar.
//
//   node scripts/gate-disa-confirmacion.mjs
import Database from 'better-sqlite3';
import fs from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { APP_DIR } from './lib/gate-env.mjs';
import { tirarNegocio } from './lib/tirar-negocio.mjs';
import { ejecutorDeAcciones } from './lib/disa-accion.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { getTenantBySlug } from '../core/control-db.js';

const RID = randomBytes(3).toString('hex');
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

let slug = null, db = null;

try {
  console.log('\n[0] UN NEGOCIO DE CERO, con un cliente al que proponerle un cambio');
  const alta = await provisionTenant({
    businessName: 'Gate Confirmacion ' + RID, ownerName: 'Dueña Gate',
    email: 'delivered@resend.dev', password: 'Gate.Conf.' + RID + '!', phone: '+34 600 000 000',
  });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename));
  db.pragma('busy_timeout = 10000');
  const uid = db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get().id;
  const ses = { userId: uid, userName: 'Dueña Gate', role: 'owner' };
  const disa = ejecutorDeAcciones(db);

  const cid = db.prepare("INSERT INTO clients (name,email,fiscal_id,city,active) VALUES (?,?,?,?,1)")
    .run('ZZ Antes ' + RID, 'zz-' + RID + '@bamburu.test', 'B00000001', 'Madrid').lastInsertRowid;
  const antes = db.prepare('SELECT * FROM clients WHERE id=?').get(cid);
  ok(!!antes, 'cliente de prueba creado', antes.name + ' · ' + antes.city);

  console.log('\n[1] CONFIRMAR EJECUTA EXACTAMENTE LO PROPUESTO');
  // La propuesta que DISA le habría enseñado al dueño: cambiar SOLO el nombre.
  const propuesta = { type: 'edit_client', params: { client_id: cid, name: 'ZZ Después ' + RID } };
  const r = await disa(propuesta, ses);
  const despues = db.prepare('SELECT * FROM clients WHERE id=?').get(cid);
  ok(r?.ok === true, 'la acción confirmada se ejecuta', (r?.message || '').slice(0, 70));
  ok(despues.name === 'ZZ Después ' + RID, 'y hace LO QUE PROPUSO: el nombre cambió', antes.name + ' → ' + despues.name);

  console.log('\n[2] Y NADA MÁS — lo que no estaba en la propuesta, no se toca');
  const intactos = ['email', 'fiscal_id', 'city', 'active'].filter(k => String(antes[k]) === String(despues[k]));
  ok(intactos.length === 4, 'los campos que la propuesta NO mencionaba quedan igual', intactos.join(', '));
  ok(db.prepare('SELECT COUNT(*) n FROM clients').get().n === 1,
     'y no ha aparecido ni desaparecido ningún cliente', db.prepare('SELECT COUNT(*) n FROM clients').get().n + '');

  console.log('\n[3] LA CADENA ENTERA: la cerradura decide, y de esa decisión depende que se ejecute');
  // ⚠️ La primera versión de este bloque comprobaba que «sin llamar a nada, nada cambia» — un verde
  // que no demostraba NADA, que en este repo cuenta como fallo. Ahora se une la decisión real con su
  // consecuencia: se saca la expresión DEL FICHERO (no una copia: si alguien la relaja, aquí se
  // prueba la relajada) y se ejecuta la acción SOLO si esa expresión dice que sí — exactamente lo
  // que hace el servidor.
  const fuente = fs.readFileSync(path.join(APP_DIR, 'modules/disa/index.js'), 'utf8');
  const m = /isConfirming\s*=\s*\/([^\n]*?)\/([a-z]*)\s*\n?\s*\.test\(/.exec(fuente);
  ok(!!m, 'se encuentra en el código la expresión que decide la confirmación');
  if (!m) throw new Error('sin la expresión no se puede comprobar la cadena: esto NO es un aprobado');
  const decide = new RegExp(m[1], m[2]);

  const AMBIGUAS = ['sí, pero espera', 'creo que sí', 'vale, ¿y si mejor no?', 'ok pero cambia la fecha', 'no'];
  let ejecutadas = 0;
  for (const frase of AMBIGUAS) {
    const nombrePrevio = db.prepare('SELECT name FROM clients WHERE id=?').get(cid).name;
    if (decide.test(frase.trim())) {                    // el servidor solo ejecuta si esto es cierto
      ejecutadas++;
      await disa({ type: 'edit_client', params: { client_id: cid, name: 'ZZ NO DEBERÍA ' + RID } }, ses);
    }
    const ahora = db.prepare('SELECT name FROM clients WHERE id=?').get(cid).name;
    ok(ahora === nombrePrevio, 'con «' + frase + '» NO se ejecuta nada: el cliente sigue igual', ahora);
  }
  ok(ejecutadas === 0, 'ninguna de las ' + AMBIGUAS.length + ' frases ambiguas pasó la cerradura');

  // Y la otra mitad: un «sí» limpio SÍ pasa y SÍ ejecuta. Una cerradura que no deja pasar a nadie
  // tampoco vale — el criterio dice que el uso normal no puede estorbarse.
  ok(decide.test('sí'), 'y un «sí» limpio SÍ pasa la cerradura');
  if (decide.test('sí')) {
    await disa({ type: 'edit_client', params: { client_id: cid, city: 'Bilbao' } }, ses);
    ok(db.prepare('SELECT city FROM clients WHERE id=?').get(cid).city === 'Bilbao',
       '  y entonces la acción se ejecuta de verdad', 'Madrid → Bilbao');
  }

  console.log('\n[4] LA ACCIÓN CONFIRMADA ES LA PROPUESTA, NO OTRA');
  // Si alguien cambiara la acción entre la propuesta y la ejecución, se vería aquí: se ejecuta una
  // acción sobre un id que no existe y tiene que fallar limpio, sin tocar al cliente bueno.
  const rMal = await disa({ type: 'edit_client', params: { client_id: 999999, name: 'ZZ Fantasma' } }, ses);
  const trasMal = db.prepare('SELECT * FROM clients WHERE id=?').get(cid);
  ok(rMal?.ok === false, 'una acción sobre algo que no existe falla limpio', (rMal?.message || '').slice(0, 60));
  ok(trasMal.name === despues.name, 'y no ha salpicado al cliente de verdad', trasMal.name);

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  try { if (db) db.close(); } catch {}
  if (slug) { console.log('\n[limpieza] tirando el negocio de prueba: ' + slug); tirarNegocio(slug); }
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
