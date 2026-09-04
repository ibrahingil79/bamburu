#!/usr/bin/env node
//
// gate-aviso-copias.mjs — que un fallo de las copias AVISE, y que el aviso llegue al móvil.
//
// DE DÓNDE SALE (4 sep 2026). El 4 de septiembre a las 03:35 la copia secundaria falló por una
// credencial de Drive caducada. El aviso de «corrió y falló» SÍ salió por Telegram, correcto. Pero
// a las 09:04 el vigilante dijo «OK: 2/2 copias al dia» con la secundaria rota, y no mintió:
// cumplía su propia regla. **La regla era el problema** — miraba 48 h sobre copias DIARIAS, así que
// una noche entera sin copia le parecía normal, y además solo avisaba por correo.
//
// QUÉ MIDE, y lo mide EJECUTANDO EL GUION DE VERDAD, no leyéndolo: se le desvía el estado a una
// carpeta de usar y tirar (`BAMBURU_BACKUP_STATE_DIR`) y se le pone el aviso en seco
// (`AVISO_TELEGRAM_SECO=1`), así que no manda nada a nadie y no roza el estado de producción.
//
//   1. Las dos copias al día → NO avisa. (Un vigilante que avisa siempre no avisa de nada.)
//   2. Una copia a 20 h → TAMPOCO. Todavía no ha pasado un día: sería una falsa alarma diaria.
//   3. Una copia a 30 h → AVISA, y por Telegram, nombrando CUÁL de las dos.
//   4. Las dos a 30 h → CRÍTICO, que es otro mensaje distinto: no queda respaldo ninguno.
//   5. LA PRUEBA EN ROJO, DENTRO DEL GATE: con el umbral viejo de 48 h, el caso 3 se queda mudo.
//      Si alguien devuelve ese número, esta línea lo caza.
//   6. El freno no repite el mismo aviso, y SÍ deja pasar uno distinto.
//
//   node scripts/gate-aviso-copias.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dejaPasar, anotar } from '../core/freno-avisos.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEARTBEAT = join(RAIZ, 'scripts', 'bamburu-backup-heartbeat.sh');

let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

const BANCO = mkdtempSync(join(tmpdir(), 'gate-aviso-copias-'));

// Corre el vigilante con las marcas de éxito envejecidas a voluntad. Devuelve su salida.
function correr(horasPrincipal, horasSecundaria, entornoExtra = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  writeFileSync(join(BANCO, 'last-success'), String(ahora - horasPrincipal * 3600));
  writeFileSync(join(BANCO, 'last-success-secondary'), String(ahora - horasSecundaria * 3600));
  // Estados del manifiesto FRESCOS: su aviso es otra pregunta y aquí solo haría ruido.
  writeFileSync(join(BANCO, 'manifiesto.estado.json'), JSON.stringify({ ts: ahora }));
  writeFileSync(join(BANCO, 'manifiesto-secondary.estado.json'), JSON.stringify({ ts: ahora }));
  return execFileSync('bash', [HEARTBEAT], {
    encoding: 'utf8',
    env: { ...process.env, BAMBURU_BACKUP_STATE_DIR: BANCO, AVISO_TELEGRAM_SECO: '1', RESEND_API_KEY: '' },
  });
}

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] CUANDO TODO VA BIEN, SE CALLA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  let s = correr(5, 5);
  ok(/OK: 2\/2 copias al dia/.test(s), 'las dos copias de esta noche → dice OK');
  ok(!/telegram/.test(s), '  y no manda ningún aviso');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] UNA COPIA A 20 h: TODAVÍA NO ES NOTICIA');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  s = correr(5, 20);
  ok(/OK: 2\/2 copias al dia/.test(s), 'aún no ha pasado un día → sigue en OK');
  ok(!/telegram/.test(s), '  y sigue callado: una falsa alarma diaria enseña a ignorar los avisos');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] UNA COPIA A 30 h: UNA NOCHE SIN COPIA, Y SE DICE');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  s = correr(5, 30);
  ok(/AVISO: 1 de 2 copias caidas/.test(s), 'una noche fallada → AVISO');
  ok(/telegram/.test(s), '  y sale por Telegram, no solo por correo');
  ok(/clave=copia-parada-secundaria/.test(s), '  nombrando CUÁL de las dos ha caído',
     (s.match(/clave=[\w-]+/) || [''])[0]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] LAS DOS CAÍDAS: NO QUEDA RESPALDO, Y ES OTRO MENSAJE');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  s = correr(30, 30);
  ok(/CRITICO: las 2 copias estan caidas/.test(s), 'las dos caídas → CRÍTICO');
  ok(/clave=copias-todas-caidas/.test(s), '  con un aviso distinto del de «te queda una»');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] LA PRUEBA EN ROJO, DENTRO DEL GATE: el umbral es quien hace el trabajo');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Si alguien devuelve el umbral a las 48 h de antes, el caso 3 —la avería real de hoy— se queda
  // mudo otra vez. Aquí se comprueba que ESE número es el que sostiene la propiedad, y no otra cosa.
  const conUmbralViejo = execFileSync('bash', ['-c',
    'sed "s/^MAX_AGE_COPIA=.*/MAX_AGE_COPIA=$((48*3600))/" "$1" > "$2/hb-viejo.sh" && bash "$2/hb-viejo.sh"',
    '_', HEARTBEAT, BANCO], {
    encoding: 'utf8',
    env: { ...process.env, BAMBURU_BACKUP_STATE_DIR: BANCO, AVISO_TELEGRAM_SECO: '1', RESEND_API_KEY: '' },
  });
  // (el estado sigue en 30/30 de la prueba anterior; con 48 h las dos parecen sanas)
  ok(/OK: 2\/2 copias al dia/.test(conUmbralViejo),
     'con el umbral viejo de 48 h, DOS noches sin copia siguen dando «OK»',
     'esto es lo que pasó hoy a las 09:04');
  ok(!/telegram/.test(conUmbralViejo), '  y no avisaría a nadie');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] EL FRENO: uno al día, no cien iguales — pero un aviso DISTINTO pasa');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const estado = join(BANCO, 'estado-avisos.json');
  const ventanaMs = 60 * 60 * 1000;
  ok(dejaPasar({ fichero: estado, clave: 'k1', ventanaMs }), 'el primer aviso pasa');
  anotar({ fichero: estado, clave: 'k1' });
  ok(!dejaPasar({ fichero: estado, clave: 'k1', ventanaMs }), '  el mismo, inmediatamente después, NO');
  ok(dejaPasar({ fichero: estado, clave: 'k2', ventanaMs }), '  pero otro distinto SÍ: si cae la otra copia, suena');
  ok(dejaPasar({ fichero: estado, clave: 'k1', ventanaMs, ahora: Date.now() + ventanaMs + 1000 }),
     '  y el mismo, pasada la ventana, vuelve a sonar');
  // ANTE LA DUDA, SE AVISA: un estado ilegible no puede convertirse en silencio.
  writeFileSync(estado, 'esto no es json');
  ok(dejaPasar({ fichero: estado, clave: 'k1', ventanaMs }),
     'con el fichero de estado ROTO, el aviso pasa igual', 'callar por un fichero corrupto sería lo peor');

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  rmSync(BANCO, { recursive: true, force: true });
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
