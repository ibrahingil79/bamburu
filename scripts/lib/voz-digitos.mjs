// ─────────────────────────────────────────────────────────────────────────────────────────────────
// «PROHIBIDO INVENTAR CIFRAS» — la comprobación, en un solo sitio.
//
// LA REGLA (cabecera de modules/erp/voz.js): en el texto de un aviso, los únicos dígitos permitidos
// son los que vienen del HALLAZGO — su `cifra`, su `fecha` y los campos de su `ref`. Cualquier otro
// dígito es un número que se ha inventado la voz, y eso es exactamente lo que no puede pasar.
//
// POR QUÉ VIVE AQUÍ. La comprobación estaba escrita DOS veces (test-voz y verify-voz) y las dos
// copias se habían quedado cortas del mismo modo: quitaban `cifra`, `fecha` y dos códigos, y NADA
// MÁS de `ref`. Los detectores de agenda escriben en la frase el porcentaje de ocupación y los
// tramos libres —campos limpios de `ref`, permitidos por la regla— así que las dos daban
// **287/290 desde que existe la agenda**, en rojo, por un fallo suyo y no del producto. Medido el
// 23 ago 2026 comparando contra el código de antes: el rojo era idéntico.
//
// AHORA SE APLICA LA REGLA TAL Y COMO ESTÁ ESCRITA: se quita `cifra`, `fecha` (en las dos formas, la
// de guardar y la de decir) y **todos los valores escalares de `ref`**. Lo que quede con dígitos es
// inventado de verdad. Esto NO ablanda la guarda: la ensancha hasta donde la regla dice, ni un paso
// más — un número que no salga del hallazgo sigue tumbándola.

// Los valores de texto/número que hay dentro de `ref`, sin bajar a objetos anidados.
function escalaresDe(ref) {
  if (!ref || typeof ref !== 'object') return [];
  return Object.values(ref).filter(v => typeof v === 'string' || typeof v === 'number').map(String);
}

// `dinero` y `fechaEs` se pasan desde fuera: son los del PRODUCTO (voz.js), no una copia. Si un día
// cambia el formato, esto lo sigue solo.
export function sinDigitosInventados(texto, aviso, { dinero, fechaEs }) {
  let t = ' ' + texto + ' ';
  const trozos = [
    aviso.moneda ? dinero(aviso.cifra) : null,
    aviso.cifra == null ? null : String(aviso.cifra),
    aviso.fecha ? fechaEs(aviso.fecha) : null,
    aviso.fecha || null,
    ...escalaresDe(aviso.ref),
    ...(aviso.ref ? [aviso.ref.fecha ? fechaEs(aviso.ref.fecha) : null] : []),
  ].filter(x => x != null && x !== '');
  // LOS MÁS LARGOS PRIMERO, siempre: si no, la cifra «20» borraría el «20» de la fecha «2026-…» y
  // dejaría un dígito huérfano que parecería inventado sin serlo.
  trozos.sort((a, b) => b.length - a.length);
  for (const q of trozos) t = t.split(q).join(' ');
  const resto = t.match(/\d/g);
  return { limpio: !resto, resto: resto || [] };
}
