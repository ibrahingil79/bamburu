#!/usr/bin/env node
//
// bamburu-propuestas.mjs — D5 / D5b (Eje B) · generación diaria de las PROPUESTAS DE DISA.
//
// Proceso programado (systemd timer). ITERA cada BD de tenant igual que el cron de avisos y, por cada una:
//   1. Asegura el esquema (runMigrations idempotente — el script no pasa por el middleware).
//   2. Genera las propuestas que falten, de los SEIS tipos:
//      · recordatorio_impago (D5)  — factura de VENTA vencida con retraso ≥ dias_recordatorio_impago
//        (por defecto 7) → borrador de email de cobro. NO lo envía: lo deja para que el dueño apruebe.
//      · pago_por_vencer   (D5b)  — factura de COMPRA con importe pendiente cuyo vencimiento cae
//        dentro de los próximos dias_aviso_pago (por defecto 7) → propuesta de registrar el pago.
//        NO paga nada: el pago lo registra el dueño desde el panel, por el modal de "Pagar" de siempre.
//      · emitir_recurrente (D5c)   — la iguala/cuota que TOCA y sigue sin emitir (ocurrencia en
//        'borrador'). NO emite nada: emitir es un clic del dueño, por la vía de siempre.
//      · cliente_dormido   (D5d)   — el que te compraba a un ritmo y dejó de hacerlo. NO escribe a
//        nadie: aprobar REDACTA el borrador, y enviarlo es un segundo clic del dueño.
//      · vencimiento_fiscal (D5e)  — el modelo (IVA 303, IRPF 130, retenciones 111/115, resúmenes
//        anuales) que TOCA presentar pronto, SOLO de los que el tenant declara en su ficha fiscal.
//        NO presenta nada a la AEAT: deja el modelo preparado para que el dueño lo revise y lo presente.
//      · reposicion_stock  (D5f)   — un proveedor con productos bajo SU mínimo de stock (por almacén) →
//        borrador de orden de compra con esos productos. NO lo envía: aprobar CREA el borrador y el
//        dueño lo revisa y lo envía. Solo con proveedor habitual; sin él, avisa pero no propone.
//
// UN SOLO TIMER para los seis: cada tipo nuevo reutiliza este mecanismo, no añade un segundo cron.
//
// IDEMPOTENTE: los índices únicos (invoice_id/supplier_invoice_id/occurrence_id, type) impiden
// duplicar; lo ya propuesto —o descartado— no se vuelve a proponer. El de cliente dormido es distinto
// a propósito (índice PARCIAL sobre las pendientes + descanso de 90 días): un cliente SÍ puede volver
// a dormirse, y merece que se te recuerde otra vez. Correr dos veces el mismo día, o correr después de
// que el panel ya haya generado, no crea nada de más.
//
// AISLAMIENTO: una BD por negocio; jamás se cruzan datos entre tenants.
//
// Este proceso NO manda emails ni mueve dinero (a diferencia del cron de avisos): solo PREPARA. Toda
// acción con consecuencias la aprueba el dueño en /admin/propuestas. No necesita RESEND_API_KEY.
//
//   node scripts/bamburu-propuestas.mjs            # todos los tenants
//   node scripts/bamburu-propuestas.mjs --dry-run  # calcula y reporta, NO inserta
//   PROPUESTAS_DB=data/tenants/x.db node scripts/bamburu-propuestas.mjs   # un solo tenant (pruebas)
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../modules/erp/models.js';
import { generarPropuestasImpago, generarPropuestasPago, generarPropuestasRecurrentes, generarPropuestasDormidos, generarPropuestasFiscales } from '../modules/erp/propuestas.js';
import { generarPropuestasReposicion } from '../modules/erp/reposicion.js';
import { hoyLocal } from '../modules/erp/avisos.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.argv.includes('--dry-run');
const TODAY = hoyLocal();
const log = (...a) => console.log('[bamburu-propuestas]', ...a);

function tenantDbs() {
  if (process.env.PROPUESTAS_DB) return [process.env.PROPUESTAS_DB];
  return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f));
}

// Genera los DOS tipos de propuesta del tenant. Un solo barrido, un solo timer: D5b reutiliza el
// mecanismo de D5 en vez de añadir un segundo cron. En seco, todo va dentro de una transacción que
// se revierte, así se cuenta lo que crearía sin escribir nada.
function generarTodo(db) {
  const impago = generarPropuestasImpago(db, { today: TODAY });
  const pago = generarPropuestasPago(db, { today: TODAY });
  const recurrente = generarPropuestasRecurrentes(db, { today: TODAY });
  const dormido = generarPropuestasDormidos(db, { today: TODAY });
  // Vencimientos fiscales (D5e): solo de los modelos que el tenant DECLARA en su ficha fiscal. Sin
  // ficha (configured_at NULL) devuelve 0 sin tocar nada — seguro de correr para todos los tenants.
  const fiscal = generarPropuestasFiscales(db, { today: TODAY });
  // Reposición de stock (D5f): una propuesta por proveedor con productos bajo su mínimo. Sin niveles
  // configurados no hay nada bajo mínimo → 0, sin tocar nada. Seguro de correr para todos los tenants.
  const reposicion = generarPropuestasReposicion(db, { now: TODAY + 'T08:00:00.000Z' });
  return { impago, pago, recurrente, dormido, fiscal, reposicion };
}

function processTenant(path) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  try {
    runMigrations(db);   // idempotente: garantiza disa_proposals y las columnas de los umbrales
    let r;
    if (DRY) {
      db.exec('BEGIN');
      r = generarTodo(db);
      db.exec('ROLLBACK');
    } else {
      r = generarTodo(db);
    }
    const pre = DRY ? '[dry-run] ' : '';
    const verbo = DRY ? 'crearía ' : 'creadas ';
    log(slug + ': ' + pre + 'impago (umbral ' + r.impago.umbral + 'd tras vencer) · candidatas ' + r.impago.candidatas
      + ' → ' + verbo + r.impago.creadas + ', ya tenían ' + r.impago.yaTenian + ', sin email ' + r.impago.sinEmail);
    log(slug + ': ' + pre + 'pago (umbral ' + r.pago.umbral + 'd antes de vencer) · candidatas ' + r.pago.candidatas
      + ' → ' + verbo + r.pago.creadas + ', ya tenían ' + r.pago.yaTenian);
    log(slug + ': ' + pre + 'recurrentes (borradores que tocan) · candidatas ' + r.recurrente.candidatas
      + ' → ' + verbo + r.recurrente.creadas + ', ya tenían ' + r.recurrente.yaTenian
      + ', sin líneas ' + r.recurrente.sinLineas);
    log(slug + ': ' + pre + 'dormidos (dejaron de comprar) · candidatas ' + r.dormido.candidatas
      + ' → ' + verbo + r.dormido.creadas + ', ya tenían ' + r.dormido.yaTenian
      + ', descansando ' + r.dormido.enDescanso + ', sin email ' + r.dormido.sinEmail);
    log(slug + ': ' + pre + 'fiscales (modelos que vencen) · candidatas ' + r.fiscal.candidatas
      + ' → ' + verbo + r.fiscal.creadas + ', ya tenían ' + r.fiscal.yaTenian
      + (r.fiscal.sinPerfil ? ', sin ficha fiscal declarada' : ''));
    log(slug + ': ' + pre + 'reposición (proveedores con productos bajo mínimo) · candidatas ' + r.reposicion.candidatas
      + ' → ' + verbo + r.reposicion.creadas + ', ya tenían ' + r.reposicion.yaTenian
      + ', expiradas ' + r.reposicion.expiradas + ', bajo mínimo sin proveedor ' + r.reposicion.sinProveedor);
    return {
      slug, creadasImpago: r.impago.creadas, creadasPago: r.pago.creadas,
      creadasRecurrente: r.recurrente.creadas, creadasDormido: r.dormido.creadas,
      creadasFiscal: r.fiscal.creadas, creadasReposicion: r.reposicion.creadas,
      sinEmail: r.impago.sinEmail,
    };
  } finally {
    db.close();
  }
}

let totalImpago = 0, totalPago = 0, totalRecurrente = 0, totalDormido = 0, totalFiscal = 0, totalReposicion = 0, totalSinEmail = 0, fallos = 0;
for (const path of tenantDbs()) {
  try {
    const r = processTenant(path);
    totalImpago += r.creadasImpago; totalPago += r.creadasPago;
    totalRecurrente += r.creadasRecurrente; totalDormido += r.creadasDormido;
    totalFiscal += r.creadasFiscal; totalReposicion += r.creadasReposicion; totalSinEmail += r.sinEmail;
  } catch (e) {
    fallos++;
    log(basename(path) + ': EXCEPCIÓN: ' + e.message);
  }
}
log('Resumen ' + TODAY + ': recordatorios de impago nuevos=' + totalImpago + ', propuestas de pago nuevas=' + totalPago
  + ', facturas recurrentes por emitir=' + totalRecurrente
  + ', clientes dormidos=' + totalDormido
  + ', vencimientos fiscales=' + totalFiscal
  + ', reposiciones de stock=' + totalReposicion
  + ', facturas sin email del cliente=' + totalSinEmail + ', fallos=' + fallos + (DRY ? ' (dry-run)' : ''));
