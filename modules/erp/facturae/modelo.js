// MODELO NEUTRO DE FACTURA — capa intermedia entre la BD de Bamburu y CUALQUIER sintaxis de salida.
//
// Por qué existe: RD 238/2026 admite cuatro sintaxis (CII · UBL · EDIFACT · Facturae) y obliga a
// remitir una copia en **UBL** a la solución pública. Si el serializador leyera la BD directamente,
// añadir UBL sería rehacerlo todo. Aquí: `buildInvoiceModel()` resuelve los datos una vez, y cada
// serializador (facturae322.js, y mañana ubl.js) solo traduce este objeto a su sintaxis.
//
// Este fichero NO sabe nada de XML. No importa nada de facturae322.js.
//
// ARITMÉTICA — leída del esquema oficial castellano v3.2.x, no de la intuición:
//   TotalGrossAmountBeforeTaxes = TotalGrossAmount − descuentos + recargos
//   InvoiceTotal            = TotalGrossAmountBeforeTaxes + TotalTaxOutputs − TotalTaxesWithheld
//   TotalOutstandingAmount  = InvoiceTotal − (subvenciones + anticipos)
//   TotalExecutableAmount   = TotalOutstandingAmount − AmountsWithheld − PaymentInKind
//                             + suplidos + gastos financieros
// `TotalTaxesWithheld` es la retención FISCAL (IRPF). `AmountsWithheld` es otra cosa distinta:
// «cantidades que retiene el pagador hasta el buen fin de la operación» (retención de garantía).
// Bamburu no tiene subvenciones, anticipos, retenciones de garantía, pagos en especie, suplidos ni
// gastos financieros → **los tres totales coinciden** y valen `invoices.total` (= base + IVA − IRPF).
//
// (Corrige a docs/facturae/investigacion.md §3.5, que afirmaba que InvoiceTotal no descuenta el
//  IRPF. El XSD dice lo contrario, literal: «Resultado de: TotalGrossAmountBeforeTaxes +
//  TotalTaxOutputs - TotalTaxesWithheld».)

import { normalizarPais, alpha3, tipoResidencia } from './iso-paises.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── Tipo de persona ───────────────────────────────────────────────────────────
// PersonTypeCode: "F" física · "J" jurídica. Se deriva del propio NIF, que es obligatorio en
// Facturae, así que no hace falta guardarlo aparte ni puede desincronizarse con un snapshot.
//   Persona física: DNI (8 dígitos + letra) · NIE (X/Y/Z + 7 + letra) · K/L/M + 7 + letra.
//   Persona jurídica (CIF): A B C D E F G H J N P Q R S U V W + 7 dígitos + control.
// `client_type` ('particular'/'empresa') se usa solo como desempate cuando el NIF no encaja en
// ninguno de los dos patrones (p. ej. un VAT extranjero).
export function tipoPersona(nif, clientType = null) {
  const v = String(nif || '').trim().toUpperCase().replace(/[\s.-]/g, '');
  if (/^[0-9]{8}[A-Z]$/.test(v)) return 'F';          // DNI
  if (/^[XYZKLM][0-9]{7}[A-Z]$/.test(v)) return 'F';  // NIE y asimilados
  if (/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(v)) return 'J';   // CIF
  if (clientType === 'particular') return 'F';
  if (clientType === 'empresa') return 'J';
  return 'J';
}

// ── Partes ────────────────────────────────────────────────────────────────────
// Regla de oro: si la factura tiene el dato CONGELADO, manda el congelado. Solo se cae a los datos
// vivos cuando la factura es anterior a esta pieza (columnas snapshot vacías). Quien llama sabe
// distinguirlo por `usedLiveData`, y la UI lo avisa.
function resolverParte({ snapshot, vivo, clientType }) {
  const usedLive = !snapshot.taxId && !!(vivo && vivo.taxId);
  const src = usedLive ? vivo : snapshot;
  const alpha2 = normalizarPais(src.country);
  const nifLimpio = String(src.taxId || '').trim().toUpperCase().replace(/[\s.-]/g, '');
  const residencia = alpha2 ? tipoResidencia(alpha2) : null;
  return {
    usedLive,
    name: String(src.name || '').trim(),
    // Intracomunitario ("U") → el NIF va precedido de las dos letras del país. Residente ("R") y
    // extranjero ("E") → NIF tal cual. Esquema oficial §2.1.1.3.
    taxId: residencia === 'U' && nifLimpio && !nifLimpio.startsWith(alpha2) ? alpha2 + nifLimpio : nifLimpio,
    personType: tipoPersona(nifLimpio, clientType),
    residenceType: residencia,
    address: {
      street: String(src.address || '').trim(),
      postCode: String(src.postalCode || '').trim(),
      town: String(src.city || '').trim(),
      province: String(src.province || '').trim(),
      countryCode: alpha2 ? alpha3(alpha2) : null,
    },
  };
}

function faltantesDeParte(p, etiqueta) {
  const out = [];
  if (!p.name) out.push(`${etiqueta}: nombre`);
  if (!p.taxId || p.taxId.length < 3) out.push(`${etiqueta}: NIF`);
  if (!p.address.street) out.push(`${etiqueta}: calle`);
  if (!/^[0-9]{5}$/.test(p.address.postCode)) out.push(`${etiqueta}: código postal (5 dígitos)`);
  if (!p.address.town) out.push(`${etiqueta}: municipio`);
  if (!p.address.province) out.push(`${etiqueta}: provincia`);
  if (!p.address.countryCode) out.push(`${etiqueta}: país`);
  return out;
}

// ── Modelo ────────────────────────────────────────────────────────────────────
export function buildInvoiceModel(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if (!inv) { const e = new Error('Factura no encontrada'); e.status = 404; throw e; }

  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const cliente = inv.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id) : null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(invoiceId);

  const seller = resolverParte({
    snapshot: {
      name: inv.company_name, taxId: inv.company_fiscal_id, address: inv.company_address,
      postalCode: inv.company_postal_code, city: inv.company_city,
      province: inv.company_province, country: inv.company_country,
    },
    vivo: {
      name: cfg.company_name, taxId: cfg.fiscal_id, address: cfg.address,
      postalCode: cfg.postal_code, city: cfg.city, province: cfg.province, country: cfg.country,
    },
  });

  const buyer = resolverParte({
    snapshot: {
      name: inv.client_name, taxId: inv.client_fiscal_id, address: inv.client_address,
      postalCode: inv.client_postal_code, city: inv.client_city,
      province: inv.client_province, country: inv.client_country,
    },
    vivo: cliente ? {
      name: cliente.name, taxId: cliente.fiscal_id, address: cliente.address,
      postalCode: cliente.postal_code, city: cliente.city,
      province: cliente.province, country: cliente.country,
    } : null,
    clientType: cliente?.client_type,
  });

  // Líneas. Las facturas antiguas (motor viejo) guardaron `invoice_items` sin tax_rate/tax_amount:
  // se completan con el tipo de la cabecera. No se inventa nada: se reconstruye lo que ya implicaba.
  const headerRate = Number(inv.tax_rate) || 0;
  const lines = items.map(it => {
    const base = r2(it.total_price);
    const rate = it.tax_rate == null ? headerRate : Number(it.tax_rate) || 0;
    const tax = it.tax_amount == null ? r2(base * rate / 100) : r2(it.tax_amount);
    return {
      description: String(it.description || '').slice(0, 2500),
      quantity: Number(it.quantity) || 0,
      unitPrice: r2(it.unit_price),
      totalCost: base,      // sin descuentos de línea: TotalCost = GrossAmount
      grossAmount: base,
      taxRate: rate,
      taxAmount: tax,
    };
  });

  // Desglose de IVA por tipo (una factura puede mezclar 21/10/4).
  const porTipo = new Map();
  for (const l of lines) {
    const k = l.taxRate;
    const a = porTipo.get(k) || { rate: k, base: 0, amount: 0 };
    a.base = r2(a.base + l.grossAmount);
    a.amount = r2(a.amount + l.taxAmount);
    porTipo.set(k, a);
  }
  const taxesOutputs = [...porTipo.values()].sort((a, b) => b.rate - a.rate);

  const grossAmount = r2(lines.reduce((s, l) => s + l.grossAmount, 0));
  const taxOutputs = r2(taxesOutputs.reduce((s, t) => s + t.amount, 0));
  const withheldAmount = r2(inv.irpf_amount);
  const taxesWithheld = withheldAmount > 0
    ? { taxTypeCode: '04', rate: r2(inv.irpf_rate), base: grossAmount, amount: withheldAmount }
    : null;

  const invoiceTotal = r2(grossAmount + taxOutputs - withheldAmount);
  const totals = {
    grossAmount,
    grossBeforeTaxes: grossAmount,
    taxOutputs,
    taxesWithheld: withheldAmount,
    invoiceTotal,
    outstanding: invoiceTotal,   // sin subvenciones ni anticipos
    executable: invoiceTotal,    // sin retención de garantía, pagos en especie, suplidos ni gastos financieros
  };

  const original = inv.rectifies_invoice_id
    ? db.prepare('SELECT invoice_number, series, issue_date FROM invoices WHERE id=?').get(inv.rectifies_invoice_id)
    : null;

  return {
    id: inv.id,
    invoice: {
      number: inv.invoice_number,
      seriesCode: inv.series || null,
      issueDate: inv.issue_date,
      currency: inv.currency || 'EUR',
      language: 'es',
      tipoFactura: inv.tipo_factura || (inv.record_type === 'rectificativa' ? (inv.rectification_type || 'R1') : 'F1'),
      esRectificativa: inv.record_type === 'rectificativa',
      rectificationMode: inv.rectification_mode || null,   // 'S' sustitución · 'I' diferencias
      rectifies: original ? { number: original.invoice_number, seriesCode: original.series, issueDate: original.issue_date } : null,
      status: inv.status,
    },
    seller,
    buyer,
    lines,
    taxesOutputs,
    taxesWithheld,
    totals,
    // Trazabilidad para la UI y para el informe: ¿de dónde salieron los datos de cada parte?
    usedLiveData: { seller: seller.usedLive, buyer: buyer.usedLive },
    // Cuadre contra lo que la factura tiene guardado. Es la comprobación que el XSD NO hace.
    stored: { subtotal: r2(inv.subtotal), taxAmount: r2(inv.tax_amount), total: r2(inv.total) },
  };
}

/**
 * ¿Se puede exportar esta factura a Facturae? Devuelve el veredicto en un objeto, sin lanzar:
 *   { ready, blocked, reason, missing[], usedLiveData }
 * Preferimos bloquear a emitir un documento con valor legal relleno de suposiciones.
 */
export function facturaeStatus(model) {
  const missing = [];

  // Una factura simplificada (ticket) no tiene destinatario identificado. Facturae exige BuyerParty
  // con NIF y dirección: no hay forma honesta de generarla. Se emite la factura completa y punto.
  if (model.invoice.tipoFactura === 'F2') {
    return {
      ready: false, blocked: true, missing: [],
      reason: 'Las facturas simplificadas (tickets) no identifican al destinatario, y Facturae lo exige. ' +
              'Emite primero la factura completa desde este mismo ticket.',
      usedLiveData: model.usedLiveData,
    };
  }
  if (model.invoice.status === 'anulada') {
    return {
      ready: false, blocked: true, missing: [],
      reason: 'Esta factura está anulada. No se exporta a Facturae.',
      usedLiveData: model.usedLiveData,
    };
  }
  if (!model.lines.length) {
    return { ready: false, blocked: true, missing: [], reason: 'La factura no tiene líneas.', usedLiveData: model.usedLiveData };
  }

  missing.push(...faltantesDeParte(model.seller, 'Tu empresa'));
  missing.push(...faltantesDeParte(model.buyer, 'Cliente'));

  if (model.invoice.esRectificativa && !model.invoice.rectifies) {
    missing.push('Rectificativa: no consta la factura original rectificada');
  }

  // Los datos que faltan van PRIMERO: es lo único que el usuario puede arreglar por su cuenta.
  if (missing.length) {
    return {
      ready: false, blocked: true, missing,
      reason: 'Faltan datos fiscales obligatorios en Facturae.',
      usedLiveData: model.usedLiveData,
    };
  }

  // El cuadre de importes. Si las líneas no reconstruyen el total guardado, algo está mal en los
  // datos y NO se genera: un descuadre de céntimos llega intacto a la Administración. El XSD no
  // comprueba aritmética — solo tipos —, así que esta es la única red que hay.
  const t = model.totals, s = model.stored;

  // Caso concreto y frecuente: facturas anteriores al motor actual, cuyas líneas se guardaron con
  // IVA 0 mientras la cabecera declara un tipo. No se "reconstruye" el desglose a partir de la
  // cabecera: sería inventarse el reparto por tipos en un documento con valor legal.
  if (t.taxOutputs === 0 && s.taxAmount > 0.01) {
    return {
      ready: false, blocked: true, missing: [],
      reason: `Las líneas de esta factura no llevan el desglose de IVA (la cabecera declara ${s.taxAmount} ` +
              'pero las líneas suman 0). Es una factura anterior al motor de facturación actual: ' +
              'no podemos reconstruir el desglose sin inventarlo.',
      usedLiveData: model.usedLiveData,
    };
  }

  const desc = [];
  if (Math.abs(t.grossAmount - s.subtotal) > 0.02) desc.push(`base ${t.grossAmount} ≠ ${s.subtotal}`);
  if (Math.abs(t.taxOutputs - s.taxAmount) > 0.02) desc.push(`IVA ${t.taxOutputs} ≠ ${s.taxAmount}`);
  if (Math.abs(t.invoiceTotal - s.total) > 0.02) desc.push(`total ${t.invoiceTotal} ≠ ${s.total}`);
  if (desc.length) {
    return {
      ready: false, blocked: true, missing: [],
      reason: 'Los importes de las líneas no cuadran con los totales guardados (' + desc.join(' · ') + '). ' +
              'No generamos un documento legal con un descuadre.',
      usedLiveData: model.usedLiveData,
    };
  }

  return { ready: true, blocked: false, missing: [], reason: null, usedLiveData: model.usedLiveData };
}
