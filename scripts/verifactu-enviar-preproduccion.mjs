// VERI*FACTU · Tarea 2 (Fase A) — ENVÍO REAL al entorno de PRUEBAS (preproducción) de la AEAT.
//   node scripts/verifactu-enviar-preproduccion.mjs <tenant-slug> [registroId]
//
// Paso de cierre que dispara el envío REAL contra prewww1.aeat.es usando el certificado FNMT del
// entorno (VERIFACTU_CERT_PATH + VERIFACTU_CERT_PASS). Sin certificado configurado → avisa y sale
// SIN romper (el motor está probado contra simulador con scripts/verify-verifactu-t2.mjs).
//
// Sin registroId → envía todos los ALTA aún no aceptados (idempotente: no reenvía lo 'correcto').
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { enviarRegistro, certStatus, sistemaInformaticoFaltantes, ESTADO } from '../modules/erp/verifactu-envio.js';

const slug = process.argv[2];
const registroId = process.argv[3] ? Number(process.argv[3]) : null;
if (!slug) { console.error('Uso: node scripts/verifactu-enviar-preproduccion.mjs <tenant-slug> [registroId]'); process.exit(2); }

const cs = certStatus();
if (!cs.present) {
  console.error('⛔ No se puede enviar a la AEAT: ' + cs.reason);
  console.error('   Configura VERIFACTU_CERT_PATH (.p12/.pfx del FNMT) y VERIFACTU_CERT_PASS en /etc/bamburu.env.');
  process.exit(1);
}
const faltan = sistemaInformaticoFaltantes();
if (faltan.length) console.warn('⚠️  SistemaInformatico incompleto (se enviará igualmente si insistes): ' + faltan.join(', '));

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
