// plan.js — EL PRECIO DE BAMBURU VIVE AQUÍ Y EN NINGÚN OTRO SITIO.
//
// QUÉ PROBLEMA RESUELVE. El criterio 1 de la tarea `suscripcion-plan-y-alta` no pide "que haya un
// plan de 9,90 €": pide que **el precio viva en un solo sitio configurable, no repetido por el
// código**. Un precio repetido se cambia en cuatro sitios y se olvida en el quinto — y el quinto es
// siempre el que ve el cliente. Así que aquí no hay solo un número: están el IVA, los días de
// prueba, el día de cobro y **los textos ya escritos**, para que ninguna pantalla tenga que
// componer "9,90 €/mes + IVA" por su cuenta.
//
// ⚠️ SI VAS A ENSEÑAR UN PRECIO EN CUALQUIER PANTALLA, CORREO O DOCUMENTO: llama a `textoPrecio()`
// o a `desglose()`. No escribas "9,90" a mano en ninguna parte. `scripts/test-suscripcion.mjs`
// barre el árbol buscando precios sueltos y cae si encuentra uno.
//
// LA DECISIÓN DE IBRAHIN SOBRE EL IVA (2 sep 2026), que es la que da forma a este fichero:
//   «9,90 €/mes + IVA (21%). En pantalla y en todo texto de precio se muestra "9,90 €/mes + IVA".
//    Al cobrar, el cliente paga 11,98 € y su factura de suscripción desglosa base e IVA.»
// Verificada contra el mercado: Holded y el sector entero anuncian sin IVA. Por eso el precio que se
// ANUNCIA y el que se COBRA son dos números distintos a propósito, y los dos salen de aquí.
//
// POR QUÉ EN CÉNTIMOS ENTEROS. El dinero no va en coma flotante: 9.90 * 1.21 en binario da
// 11.979000000000001, y de ahí sale un céntimo de diferencia con Stripe —que también trabaja en
// enteros— justo en la factura. Todo lo de aquí es `number` entero de céntimos.

import { controlDb } from './control-db.js';

// ── Los valores por defecto, y son LOS ÚNICOS literales de precio del producto ────────────────────
const POR_DEFECTO = {
  precio_base_centimos: 990,   // 9,90 € — la decisión de Ibrahin del 2 sep 2026
  iva_porcentaje: 21,          // España, tipo general
  dias_prueba: 15,             // prueba gratis SIN tarjeta
  dia_de_cobro: 5,             // el día 5 de cada mes
};

// Las claves de `settings` (control.db) que permiten cambiarlos sin tocar código. Se leen en cada
// llamada a propósito: un precio cacheado en memoria sobrevive al cambio y sigue cobrando el viejo
// hasta que alguien reinicia — y nadie relaciona las dos cosas.
const CLAVE = {
  precio_base_centimos: 'suscripcion_precio_base_centimos',
  iva_porcentaje: 'suscripcion_iva_porcentaje',
  dias_prueba: 'suscripcion_dias_prueba',
  dia_de_cobro: 'suscripcion_dia_de_cobro',
};

// Lee un ajuste numérico de control.db. Si no está, está vacío o no es un número válido, devuelve el
// valor por defecto: un ajuste corrupto NO puede dejar el producto sin precio.
function ajuste(nombre, db = controlDb) {
  const defecto = POR_DEFECTO[nombre];
  try {
    const fila = db.prepare('SELECT value FROM settings WHERE key = ?').get(CLAVE[nombre]);
    if (!fila || fila.value == null || String(fila.value).trim() === '') return defecto;
    const n = Number(String(fila.value).trim());
    if (!Number.isFinite(n) || n < 0) return defecto;
    return n;
  } catch {
    return defecto;
  }
}

export function precioBaseCentimos(db = controlDb) { return Math.round(ajuste('precio_base_centimos', db)); }
export function ivaPorcentaje(db = controlDb)      { return ajuste('iva_porcentaje', db); }
export function diasDePrueba(db = controlDb)       { return Math.round(ajuste('dias_prueba', db)); }
export function diaDeCobro(db = controlDb)         { return Math.round(ajuste('dia_de_cobro', db)); }

// El IVA de una base, en céntimos enteros. Redondeo al céntimo más cercano, con el medio hacia
// arriba — que es lo que hace Hacienda y lo que hace Stripe.
export function ivaDe(baseCentimos, db = controlDb) {
  return Math.round((baseCentimos * ivaPorcentaje(db)) / 100);
}

// El total que se cobra de verdad a la tarjeta: base + IVA. 990 + 208 = 1198 → 11,98 €.
export function totalConIvaCentimos(baseCentimos, db = controlDb) {
  return baseCentimos + ivaDe(baseCentimos, db);
}

// ── Formato español. Gemelo de `fmtEur` (modules/erp/margen.js), reescrito aquí a propósito ───────
// `core/` no puede importar de `modules/`: sería invertir la dependencia y dejar el núcleo colgando
// de una pantalla. Son cuatro líneas y el resultado es idéntico (mismo `toLocaleString('es-ES')`,
// mismos dos decimales, mismo separador de miles).
export function eur(centimos) {
  return (centimos / 100).toLocaleString('es-ES',
    { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
}

// ── LOS TEXTOS. Nadie compone un precio por su cuenta ─────────────────────────────────────────────

/** Lo que se ANUNCIA, en pantalla y en todo texto de precio: «9,90 €/mes + IVA». */
export function textoPrecio(db = controlDb) {
  return `${eur(precioBaseCentimos(db))}/mes + IVA`;
}

/** Lo que se COBRA de verdad a la tarjeta, con su desglose dicho en palabras. */
export function textoPrecioCobrado(db = controlDb) {
  const base = precioBaseCentimos(db);
  return `${eur(totalConIvaCentimos(base, db))} (${eur(base)} + ${ivaPorcentaje(db)} % de IVA)`;
}

/**
 * El desglose completo de un importe de base dada. Es lo que usan la factura de suscripción y la
 * pantalla: base, IVA y total, cada uno en céntimos y ya formateado.
 * Si no se pasa base, se usa la del plan (un mes entero).
 */
export function desglose(baseCentimos = null, db = controlDb) {
  const base = baseCentimos == null ? precioBaseCentimos(db) : Math.round(baseCentimos);
  const cuotaIva = ivaDe(base, db);
  return {
    base_centimos: base,
    iva_centimos: cuotaIva,
    total_centimos: base + cuotaIva,
    iva_porcentaje: ivaPorcentaje(db),
    base: eur(base),
    iva: eur(cuotaIva),
    total: eur(base + cuotaIva),
  };
}

/** Todo el plan de una vez, para pintar una pantalla sin hacer seis llamadas. */
export function plan(db = controlDb) {
  return {
    precio_base_centimos: precioBaseCentimos(db),
    iva_porcentaje: ivaPorcentaje(db),
    dias_prueba: diasDePrueba(db),
    dia_de_cobro: diaDeCobro(db),
    texto_precio: textoPrecio(db),
    texto_precio_cobrado: textoPrecioCobrado(db),
    desglose_mes: desglose(null, db),
  };
}
