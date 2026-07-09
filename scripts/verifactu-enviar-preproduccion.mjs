// VERI*FACTU · Tarea 2 (Fase A) — ENVÍO REAL al entorno de PRUEBAS (preproducción) de la AEAT.
//   node scripts/verifactu-enviar-preproduccion.mjs <tenant-slug> [registroId]
//
// Paso de cierre que dispara el envío REAL contra prewww1.aeat.es usando el certificado FNMT del
// entorno (VERIFACTU_CERT_PATH + VERIFACTU_CERT_PASS). Sin certificado configurado → avisa y sale
// SIN romper (el motor está probado contra simulador con scripts/verify-verifactu-t2.mjs).
//
// Sin registroId → envía todos los ALTA aún no aceptados (idempotente: no reenvía lo 'correcto').
//
// La CONTRASEÑA del .p12 nunca se escribe en un fichero. Si VERIFACTU_CERT_PASS no viene del
// entorno, este script la pide por teclado SIN eco: no queda en el historial del shell, ni en
// `ps`, ni en /etc/bamburu.env. Vive solo en la memoria de este proceso.
import Database from 'better-sqlite3';
import readline from 'node:readline';
import { runMigrations } from '../modules/erp/models.js';
import { enviarRegistro, certStatus, sistemaInformaticoFaltantes, ESTADO } from '../modules/erp/verifactu-envio.js';

// Pide una contraseña por teclado ocultando lo que se teclea.
function pedirOculto(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error('No hay terminal interactiva: pasa la contraseña en VERIFACTU_CERT_PASS solo para este comando.'));
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(prompt, respuesta => { rl.close(); process.stdout.write('\n'); resolve(respuesta); });
    rl._writeToOutput = () => {};   // desde aquí, ni un carácter de eco
  });
}

const slug = process.argv[2];
const registroId = process.argv[3] ? Number(process.argv[3]) : null;
if (!slug) { console.error('Uso: node scripts/verifactu-enviar-preproduccion.mjs <tenant-slug> [registroId]'); process.exit(2); }

const cs = certStatus();
if (!cs.present) {
  console.error('⛔ No se puede enviar a la AEAT: ' + cs.reason);
  console.error('   Apunta VERIFACTU_CERT_PATH al .p12/.pfx del FNMT (fuera del repo, permisos 600).');
  console.error('   La CONTRASEÑA no va en ningún fichero: se pide por teclado, o en el entorno de este único comando.');
  process.exit(1);
}
const faltan = sistemaInformaticoFaltantes();
if (faltan.length) {
  // Ojo: esto NO es solo un aviso. El motor marca cada registro 'bloqueado_datos' y NO envía nada.
  console.error('⛔ SistemaInformatico incompleto: ' + faltan.join(', '));
  console.error('   Con esto, el motor marca cada registro como "bloqueado_datos" y NO sale ninguna petición a la AEAT.');
  console.error('   Configura VERIFACTU_PRODUCTOR_NOMBRE y VERIFACTU_PRODUCTOR_NIF (no son secretos) antes de enviar.');
  process.exit(1);
}

// La contraseña del certificado: del entorno si viene, y si no se pide por teclado sin eco.
if (!process.env.VERIFACTU_CERT_PASS) {
  try {
    process.env.VERIFACTU_CERT_PASS = await pedirOculto('Contraseña del certificado .p12 (no se muestra): ');
  } catch (e) {
    console.error('⛔ ' + e.message);
    process.exit(1);
  }
}

const db = new Database(`data/tenants/${slug}.db`);
runMigrations(db);

const ids = registroId
  ? [registroId]
  : db.prepare(`SELECT r.id FROM verifactu_registros r LEFT JOIN verifactu_envios e ON e.registro_id=r.id
               WHERE r.record_type='alta' AND (e.estado IS NULL OR e.estado NOT IN ('correcto','aceptado_con_errores'))
               ORDER BY r.id`).all().map(r => r.id);

console.log(`Enviando ${ids.length} registro(s) al entorno de PRUEBAS de la AEAT (${slug})...\n`);
let okc = 0, errc = 0;
for (const id of ids) {
  try {
    const e = await enviarRegistro(db, id, { entorno: 'pruebas' });
    const linea = `registro ${id}: ${e.estado}${e.csv ? ' · CSV ' + e.csv : ''}${e.codigo_error ? ' · error ' + e.codigo_error + ' ' + (e.descripcion_error || '') : ''}${e.aviso ? ' · ' + e.aviso : ''}`;
    if (e.estado === ESTADO.CORRECTO || e.estado === ESTADO.CON_ERRORES) { okc++; console.log('  ✓ ' + linea); }
    else { errc++; console.error('  ✗ ' + linea); }
  } catch (err) { errc++; console.error(`  ✗ registro ${id}: ${err.message}`); }
}
db.close();
console.log(`\nHecho: ${okc} aceptado(s) / ${errc} con problema.`);
process.exit(errc ? 1 : 0);
