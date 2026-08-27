// SERIALIZADOR Facturae 3.2.2 — modelo neutro (modelo.js) → XML.
//
// Solo traduce. No lee la BD, no decide si la factura es exportable (eso es `facturaeStatus`).
// Añadir UBL en el futuro = otro fichero hermano que consume el MISMO modelo.
//
// El XSD oficial se descargó y se parseó para escribir esto (docs/facturae/investigacion.md):
//   https://www.facturae.gob.es/content/dam/facturae/formato/versiones/Facturaev3_2_2.xml
//
// Dos trampas del formato, por si alguien lo toca:
//  1. El `targetNamespace` PARECE una URL pero no lo es: no se puede descargar (404). Es un
//     identificador. No lo "arregles".
//  2. `elementFormDefault` no está declarado → **los hijos van SIN prefijo**. Solo la raíz lleva
//     `fe:`. Si cualificas los hijos, el XSD te rechaza.
//  3. Los bloques son `xs:sequence`: el ORDEN de los elementos es obligatorio, no decorativo.
//
// La firma (`ds:Signature`) es `minOccurs="0"`: este XML VALIDA sin firmar. No confundir "valida"
// con "presentable en FACe" — eso exige XAdES-EPES y certificado (fuera de este encargo).

const NS = 'http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const n2 = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

// ── Mapeo tipo AEAT (L2) → Facturae. Decisión técnica documentada ──────────────
//
// F1/F2/F3 y R1–R5 son la taxonomía de la AEAT (Verifactu). Facturae no la conoce: usa
// `InvoiceDocumentType` (FC completa · FA abreviada · AF autofactura) e `InvoiceClass`
// (OO original · OR rectificativa · OC recapitulativa · CO/CR/CC copias).
//
//  F1 → FC + OO   factura completa ordinaria.
//  F2 → FA + OO   simplificada. Se mapea por completitud, pero `facturaeStatus` la BLOQUEA:
//                 FACe/Facturae exigen BuyerParty identificado y una simplificada no lo tiene.
//  F3 → FC + OO   factura completa emitida en sustitución de simplificadas. NO es `OC`
//                 (recapitulativa): `OC` agrupa varias operaciones del mismo destinatario en un
//                 periodo (art. 13 RD 1619/2012); una F3 de Bamburu sustituye exactamente UN
//                 ticket (`substitutes_invoice_id` es un único id). Es una factura completa normal.
//  R1..R5 → FC + OR  rectificativa, con bloque `Corrective`.
const DOC_CLASS = {
  F1: { documentType: 'FC', invoiceClass: 'OO' },
  F2: { documentType: 'FA', invoiceClass: 'OO' },
  F3: { documentType: 'FC', invoiceClass: 'OO' },
  R1: { documentType: 'FC', invoiceClass: 'OR' },
  R2: { documentType: 'FC', invoiceClass: 'OR' },
  R3: { documentType: 'FC', invoiceClass: 'OR' },
  R4: { documentType: 'FC', invoiceClass: 'OR' },
  R5: { documentType: 'FC', invoiceClass: 'OR' },
};

// `ReasonCode` de Facturae describe QUÉ se corrige (lista 01–16, 80–85). R1–R5 de la AEAT describen
// POR QUÉ (causas del art. 80 LIVA). **No existe tabla de equivalencia oficial** — verificado: no
// está ni en el XSD ni en el manual de FACe. Esta es la correspondencia que adopta Bamburu.
//
// OJO: `ReasonDescription` NO es texto libre. Es una **enumeración** cuyos valores están alineados
// por posición con `ReasonCode`; escribir otra cosa hace fallar la validación contra el XSD (nos
// pasó). Por eso el código AEAT original (R1–R5 + artículo) se conserva en
// `AdditionalReasonDescription`, que sí admite texto libre: así no se pierde nada.
//
// El código 85 («cuotas repercutidas no satisfechas. Auto de declaración de concurso») cubre en un
// solo valor los dos supuestos que la AEAT separa: concurso (R2, art. 80.Tres) e incobrables
// (R3, art. 80.Cuatro). Se usa para ambos, y el matiz viaja en AdditionalReasonDescription.
const RECT = {
  R1: { code: '16', desc: 'Base imponible', aeat: 'AEAT R1 — error fundado en derecho o causas del art. 80.Uno, .Dos y .Seis LIVA' },
  R2: { code: '85', desc: 'Base imponible modificada cuotas repercutidas no satisfechas. Auto de declaración de concurso', aeat: 'AEAT R2 — concurso de acreedores, art. 80.Tres LIVA' },
  R3: { code: '85', desc: 'Base imponible modificada cuotas repercutidas no satisfechas. Auto de declaración de concurso', aeat: 'AEAT R3 — créditos incobrables, art. 80.Cuatro LIVA' },
  R4: { code: '16', desc: 'Base imponible', aeat: 'AEAT R4 — resto de causas' },
  R5: { code: '16', desc: 'Base imponible', aeat: 'AEAT R5 — rectificativa en factura simplificada' },
};

// `CorrectionMethod` — confirmado: sustitución → 01, diferencias → 02. `CorrectionMethodDescription`
// también es enumeración: los literales son exactamente estos.
const CORRECTION_METHOD = {
  S: { code: '01', desc: 'Rectificación íntegra' },
  I: { code: '02', desc: 'Rectificación por diferencias' },
};

/** Periodo impositivo del bloque `Corrective`: el mes natural de la factura rectificada. */
function taxPeriod(fecha) {
  const d = String(fecha || '').slice(0, 10);
  const [y, m] = d.split('-').map(Number);
  if (!y || !m) return { start: d, end: d };
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${d.slice(0, 7)}-01`, end: `${d.slice(0, 7)}-${String(ultimo).padStart(2, '0')}` };
}

function parteXml(p, tag) {
  // Persona física → `Individual` (Name + FirstSurname). Jurídica → `LegalEntity` (CorporateName).
  // Partir un nombre libre por el primer espacio inventa apellidos ("María del Carmen" → "del"),
  // así que para una persona física se usa el nombre completo como `Name` y `FirstSurname` recibe
  // el resto solo si el nombre trae más de una palabra. Es lo menos malo sin campos separados.
  const partes = p.name.trim().split(/\s+/);
  const identidad = p.personType === 'F'
    ? `        <Individual>
          <Name>${esc(partes[0].slice(0, 40))}</Name>
          <FirstSurname>${esc((partes.slice(1).join(' ') || partes[0]).slice(0, 40))}</FirstSurname>`
    : `        <LegalEntity>
          <CorporateName>${esc(p.name.slice(0, 80))}</CorporateName>`;
  const cierre = p.personType === 'F' ? '</Individual>' : '</LegalEntity>';

  // AddressInSpain vs OverseasAddress: el XSD tiene estructuras distintas.
  const dir = p.address.countryCode === 'ESP'
    ? `          <AddressInSpain>
            <Address>${esc(p.address.street.slice(0, 80))}</Address>
            <PostCode>${esc(p.address.postCode)}</PostCode>
            <Town>${esc(p.address.town.slice(0, 50))}</Town>
            <Province>${esc(p.address.province.slice(0, 20))}</Province>
            <CountryCode>${esc(p.address.countryCode)}</CountryCode>
          </AddressInSpain>`
    : `          <OverseasAddress>
            <Address>${esc(p.address.street.slice(0, 80))}</Address>
            <PostCodeAndTown>${esc((p.address.postCode + ' ' + p.address.town).trim().slice(0, 50))}</PostCodeAndTown>
            <Province>${esc(p.address.province.slice(0, 20))}</Province>
            <CountryCode>${esc(p.address.countryCode)}</CountryCode>
          </OverseasAddress>`;

  return `    <${tag}>
      <TaxIdentification>
        <PersonTypeCode>${p.personType}</PersonTypeCode>
        <ResidenceTypeCode>${p.residenceType}</ResidenceTypeCode>
        <TaxIdentificationNumber>${esc(p.taxId)}</TaxIdentificationNumber>
      </TaxIdentification>
${identidad}
${dir}
        ${cierre}
    </${tag}>`;
}

const taxXml = (t, indent) =>
  `${indent}<Tax>
${indent}  <TaxTypeCode>${t.taxTypeCode || '01'}</TaxTypeCode>
${indent}  <TaxRate>${n2(t.rate ?? t.taxRate)}</TaxRate>
${indent}  <TaxableBase><TotalAmount>${n2(t.base ?? t.grossAmount)}</TotalAmount></TaxableBase>
${indent}  <TaxAmount><TotalAmount>${n2(t.amount ?? t.taxAmount)}</TotalAmount></TaxAmount>
${indent}</Tax>`;

/**
 * Serializa el modelo neutro a Facturae 3.2.2 SIN FIRMAR.
 * Asume que `facturaeStatus(model).ready === true`; no vuelve a validar reglas de negocio.
 */
export function serializeFacturae322(model) {
  const { invoice: iv, seller, buyer, lines, taxesOutputs, taxesWithheld, totals } = model;
  const mapa = DOC_CLASS[iv.tipoFactura] || DOC_CLASS.F1;

  // Bloque Corrective (solo rectificativas). Orden EXACTO del XSD: InvoiceNumber, InvoiceSeriesCode,
  // ReasonCode, ReasonDescription, TaxPeriod, CorrectionMethod, CorrectionMethodDescription,
  // AdditionalReasonDescription, InvoiceIssueDate.
  let corrective = '';
  if (mapa.invoiceClass === 'OR') {
    const rect = RECT[iv.tipoFactura] || RECT.R4;
    const metodo = CORRECTION_METHOD[iv.rectificationMode] || CORRECTION_METHOD.I;
    const per = taxPeriod(iv.rectifies?.issueDate || iv.issueDate);
    corrective = `
        <Corrective>
          <InvoiceNumber>${esc(iv.rectifies.number)}</InvoiceNumber>${iv.rectifies.seriesCode ? `
          <InvoiceSeriesCode>${esc(iv.rectifies.seriesCode)}</InvoiceSeriesCode>` : ''}
          <ReasonCode>${rect.code}</ReasonCode>
          <ReasonDescription>${esc(rect.desc)}</ReasonDescription>
          <TaxPeriod>
            <StartDate>${per.start}</StartDate>
            <EndDate>${per.end}</EndDate>
          </TaxPeriod>
          <CorrectionMethod>${metodo.code}</CorrectionMethod>
          <CorrectionMethodDescription>${esc(metodo.desc)}</CorrectionMethodDescription>
          <AdditionalReasonDescription>${esc(rect.aeat)}</AdditionalReasonDescription>${iv.rectifies.issueDate ? `
          <InvoiceIssueDate>${esc(iv.rectifies.issueDate)}</InvoiceIssueDate>` : ''}
        </Corrective>`;
  }

  const lineasXml = lines.map(l => `        <InvoiceLine>
          <ItemDescription>${esc(l.description)}</ItemDescription>
          <Quantity>${l.quantity}</Quantity>
          <UnitPriceWithoutTax>${n2(l.unitPrice)}</UnitPriceWithoutTax>
          <TotalCost>${n2(l.totalCost)}</TotalCost>
          <GrossAmount>${n2(l.grossAmount)}</GrossAmount>
          <TaxesOutputs>
${taxXml(l, '            ')}
          </TaxesOutputs>${l.fiscalTreatment === 'exempt' || l.fiscalTreatment === 'non_subject' ? `
          <SpecialTaxableEvent>
            <SpecialTaxableEventCode>${l.fiscalTreatment === 'exempt' ? '01' : '02'}</SpecialTaxableEventCode>
            <SpecialTaxableEventReason>${esc('01 ' + (l.fiscalLegalText || l.fiscalCode || ''))}</SpecialTaxableEventReason>
          </SpecialTaxableEvent>` : ''}
        </InvoiceLine>`).join('\n');

  const withheldXml = taxesWithheld ? `
      <TaxesWithheld>
${taxXml(taxesWithheld, '        ')}
      </TaxesWithheld>` : '';
  const legal = [...new Set(lines.filter(l => l.fiscalTreatment !== 'taxable' || l.fiscalReverseCharge)
    .map(l => l.fiscalLegalText || (l.fiscalReverseCharge ? 'Inversión del sujeto pasivo' : l.fiscalCode)).filter(Boolean))];
  const legalXml = legal.length ? `
      <LegalLiterals>${legal.map(x => `<LegalReference>${esc(x).slice(0,250)}</LegalReference>`).join('')}</LegalLiterals>` : '';

  // `UnitOfMeasure` es [0..1] en el XSD: se omite a propósito. `PaymentDetails` también es opcional
  // y hoy `payment_method` es texto libre sin equivalencia fiable con `PaymentMeans` → se omite
  // antes que adivinarlo.
  return `<?xml version="1.0" encoding="UTF-8"?>
<fe:Facturae xmlns:fe="${NS}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <FileHeader>
    <SchemaVersion>3.2.2</SchemaVersion>
    <Modality>I</Modality>
    <InvoiceIssuerType>EM</InvoiceIssuerType>
    <Batch>
      <BatchIdentifier>${esc(seller.taxId + iv.number)}</BatchIdentifier>
      <InvoicesCount>1</InvoicesCount>
      <TotalInvoicesAmount><TotalAmount>${n2(totals.invoiceTotal)}</TotalAmount></TotalInvoicesAmount>
      <TotalOutstandingAmount><TotalAmount>${n2(totals.outstanding)}</TotalAmount></TotalOutstandingAmount>
      <TotalExecutableAmount><TotalAmount>${n2(totals.executable)}</TotalAmount></TotalExecutableAmount>
      <InvoiceCurrencyCode>${esc(iv.currency)}</InvoiceCurrencyCode>
    </Batch>
  </FileHeader>
  <Parties>
${parteXml(seller, 'SellerParty')}
${parteXml(buyer, 'BuyerParty')}
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader>
        <InvoiceNumber>${esc(iv.number.slice(0, 20))}</InvoiceNumber>${iv.seriesCode ? `
        <InvoiceSeriesCode>${esc(String(iv.seriesCode).slice(0, 20))}</InvoiceSeriesCode>` : ''}
        <InvoiceDocumentType>${mapa.documentType}</InvoiceDocumentType>
        <InvoiceClass>${mapa.invoiceClass}</InvoiceClass>${corrective}
      </InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>${esc(iv.issueDate)}</IssueDate>
        <InvoiceCurrencyCode>${esc(iv.currency)}</InvoiceCurrencyCode>
        <TaxCurrencyCode>${esc(iv.currency)}</TaxCurrencyCode>
        <LanguageName>${esc(iv.language)}</LanguageName>
      </InvoiceIssueData>
      <TaxesOutputs>
${taxesOutputs.map(t => taxXml(t, '        ')).join('\n')}
      </TaxesOutputs>${withheldXml}
      <InvoiceTotals>
        <TotalGrossAmount>${n2(totals.grossAmount)}</TotalGrossAmount>
        <TotalGrossAmountBeforeTaxes>${n2(totals.grossBeforeTaxes)}</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>${n2(totals.taxOutputs)}</TotalTaxOutputs>
        <TotalTaxesWithheld>${n2(totals.taxesWithheld)}</TotalTaxesWithheld>
        <InvoiceTotal>${n2(totals.invoiceTotal)}</InvoiceTotal>
        <TotalOutstandingAmount>${n2(totals.outstanding)}</TotalOutstandingAmount>
        <TotalExecutableAmount>${n2(totals.executable)}</TotalExecutableAmount>
      </InvoiceTotals>
      <Items>
${lineasXml}
      </Items>${legalXml}
    </Invoice>
  </Invoices>
</fe:Facturae>
`;
}

/** Nombre de fichero estable. `.xml` y no `.xsig`: sin firmar no es un `.xsig`. */
export function facturaeFilename(model) {
  return `Facturae_${String(model.invoice.number).replace(/[^\w.-]/g, '_')}.xml`;
}
