#!/usr/bin/env node
// verify-correo-freno.mjs — EL FRENO DE CORREO PARA DE VERDAD.
//
// POR QUÉ. El 24 ago 2026 salieron 174 correos en un día contra una línea base de 2, y no había nada
// que lo parara: cada proceso mandaba lo suyo y ninguno veía el conjunto. Este freno cuenta en
// `control.db`, que es el único sitio compartido, y para al llegar al tope.
//
// SE PRUEBA CONTRA UNA BASE DE MENTIRA, no contra la de control: ensayar el freno de verdad exigiría
// meter 120 filas en el negocio real, que es la basura que este encargo viene a quitar.

import Database from 'better-sqlite3';
import { registrarYDecidir, enviadosUltimaHora, TOPE_HORA, ASUNTO_FRENO, olvidarAviso,
         esImposible, desviarImposibles, SIMULACION } from '../core/correo-freno.js';

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✓ ' + m + (d ? ' — ' + d : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (d ? ' — ' + d : '')); } };

function baseDeMentira() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE correo_envios (id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
           destino TEXT NOT NULL DEFAULT '', asunto TEXT NOT NULL DEFAULT '', frenado INTEGER NOT NULL DEFAULT 0)`);
  return db;
}

console.log('\n[1] Deja pasar mientras no se llega al tope');
{
  const db = baseDeMentira();
  let ultimo;
  for (let i = 0; i < TOPE_HORA; i++) ultimo = registrarYDecidir({ to: 'a@b.test', subject: 'n' + i }, db);
  ok(ultimo.parar === false, 'el envío número ' + TOPE_HORA + ' todavía pasa', 'llevaba ' + ultimo.enviados + ' de ' + TOPE_HORA);
  ok(enviadosUltimaHora(db) === TOPE_HORA, 'y quedan apuntados los ' + TOPE_HORA, String(enviadosUltimaHora(db)));
}

console.log('\n[2] Y PARA al pasarse');
{
  const db = baseDeMentira();
  for (let i = 0; i < TOPE_HORA; i++) registrarYDecidir({ to: 'a@b.test', subject: 'n' + i }, db);
  const r = registrarYDecidir({ to: 'a@b.test', subject: 'el que sobra' }, db);
  ok(r.parar === true, 'el que hace ' + (TOPE_HORA + 1) + ' se para', 'contados ' + r.enviados + ', tope ' + r.tope);
  ok(enviadosUltimaHora(db) === TOPE_HORA, 'y el frenado NO cuenta como enviado (sigue en ' + TOPE_HORA + ')', String(enviadosUltimaHora(db)));
  const frenados = db.prepare('SELECT COUNT(*) n FROM correo_envios WHERE frenado=1').get().n;
  ok(frenados === 1, 'pero SÍ queda apuntado que se frenó, para poder contarlo después', frenados + ' fila(s)');
}

console.log('\n[3] El aviso del freno nunca se frena a sí mismo');
{
  const db = baseDeMentira();
  for (let i = 0; i < TOPE_HORA + 50; i++) registrarYDecidir({ to: 'a@b.test', subject: 'n' + i }, db);
  const r = registrarYDecidir({ to: 'ibrahingil@gmail.com', subject: ASUNTO_FRENO }, db);
  ok(r.parar === false, 'con el freno pasadísimo, el propio aviso sigue saliendo',
     'si se frenara a sí mismo, el freno saltaría en silencio y no serviría de nada');
}

console.log('\n[4] Avisa UNA vez por hora, no una por intento');
{
  const db = baseDeMentira();
  olvidarAviso();
  for (let i = 0; i < TOPE_HORA; i++) registrarYDecidir({ to: 'a@b.test', subject: 'n' + i }, db);
  const primeros = [];
  for (let i = 0; i < 5; i++) primeros.push(registrarYDecidir({ to: 'a@b.test', subject: 'sobra' + i }, db).primeraVez);
  ok(primeros.filter(Boolean).length === 1, 'de cinco frenados seguidos, solo uno manda aviso',
     'avisos: ' + primeros.filter(Boolean).length + ' — si avisara en cada uno, la avalancha sería de avisos');
}

console.log('\n[5] Si no puede contar, DEJA PASAR el correo y lo grita');
{
  const rota = new Database(':memory:');   // sin la tabla: cualquier consulta revienta
  const chillidos = [];
  const antes = console.error; console.error = m => chillidos.push(String(m));
  const r = registrarYDecidir({ to: 'a@b.test', subject: 'x' }, rota);
  console.error = antes;
  ok(r.parar === false, 'el correo del producto sale igual aunque el freno esté ciego',
     'un vigilante roto no puede dejar al negocio sin mandar facturas');
  ok(chillidos.some(c => c.includes('correo-freno')), 'pero lo dice por stderr, no se lo calla',
     chillidos[0] ? chillidos[0].slice(0, 70) : '(no dijo nada)');
}

console.log('\n[6] Solo cuenta la ÚLTIMA hora');
{
  const db = baseDeMentira();
  const viejo = new Date(Date.now() - 2 * 3600_000).toISOString();
  for (let i = 0; i < TOPE_HORA + 20; i++)
    db.prepare('INSERT INTO correo_envios (ts, destino, asunto, frenado) VALUES (?,?,?,0)').run(viejo, 'a@b.test', 'viejo');
  const r = registrarYDecidir({ to: 'a@b.test', subject: 'ahora' }, db);
  ok(r.parar === false, 'una avalancha de hace dos horas no bloquea la de ahora',
     'contados en la última hora: ' + r.enviados);
}

console.log('\n[7] Las direcciones que NO pueden existir se desvían a simulación');
{
  const imposibles = ['ana@t.local', 'x@bamburu.test', 'y@ejemplo.com', 'z@algo.invalid', 'w@cosa.example'];
  ok(imposibles.every(esImposible), 'reconoce los dominios reservados y los nuestros de pega',
     imposibles.join(', '));
  const reales = ['ibrahingil@gmail.com', 'alguien@bamburu.com', 'a@empresa.es', 'b@holded.com'];
  ok(reales.every(d => !esImposible(d)), 'y NO toca una dirección real', reales.join(', '));
  ok(!esImposible('delivered@resend.dev'), 'ni la propia dirección de simulación');

  const uno = desviarImposibles('ana@t.local');
  ok(uno.to === SIMULACION && uno.desviados.length === 1, 'una sola dirección se desvía entera', uno.to);

  const varias = desviarImposibles(['ana@t.local', 'ibrahingil@gmail.com']);
  ok(Array.isArray(varias.to) && varias.to[0] === SIMULACION && varias.to[1] === 'ibrahingil@gmail.com',
     'y en una lista se desvía SOLO la imposible, la real se queda', JSON.stringify(varias.to));

  const nada = desviarImposibles('ibrahingil@gmail.com');
  ok(nada.to === 'ibrahingil@gmail.com' && nada.desviados.length === 0,
     'sin imposibles, no cambia nada de nada', String(nada.to));
}

console.log('\n' + '─'.repeat(70));
console.log('=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail === 0 ? 0 : 1);
