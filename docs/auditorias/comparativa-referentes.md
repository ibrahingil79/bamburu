# Comparativa — Bamburu frente a Salesforce, Odoo y SAP

**Fecha:** 2026-08-31 · **Tipo:** solo lectura. Datos de Bamburu medidos; datos de los referentes
consultados en fuentes públicas (enlaces al final).

**Marco:** los tres tienen entre cientos y decenas de miles de ingenieros. La pregunta útil no es «¿está
al nivel?», sino **en qué ejes su tamaño no da ventaja** — ahí se puede competir— y en cuáles lo es todo.

## 1 · Arquitectura y escalabilidad

- **Bamburu:** un fichero SQLite por negocio, un proceso, un hilo. Medido: 1.590 lecturas/s, 365
  facturas/s, ~60 logins/s. Satura 1 core de 4. 9 negocios, 203 clientes, 922 facturas.
- **Ellos:** Odoo, PostgreSQL con base por cliente + PgBouncer, multiproceso. Salesforce, base
  compartida con miles de orgs por *pod* y *governor limits*. SAP S/4HANA, HANA en memoria.
- **Falta:** sacar la BD del hilo principal y multiproceso con afinidad. Nada más.
- **Veredicto: aficionado en forma, sobrado en capacidad.**

## 2 · Seguridad y protección de datos

- **Bamburu:** aislamiento por fichero, cadena VERI\*FACTU, registro inmutable (0 `UPDATE`/`DELETE`),
  8 dependencias con 0 críticas/altas, auditoría propia con `file:line`. **En contra:** cero cifrado
  en reposo, cero cifrado de backups, sin roles, 600/1.025 rutas sin `requirePerm` visible, sin RGPD
  funcional.
- **Ellos:** aislamiento más débil que el de Bamburu en el caso de Salesforce, compensado con veinte
  años de blindaje. Todos con cifrado en reposo, RBAC maduro, ISO 27001 / SOC 2.
- **Veredicto: élite en aislamiento, aficionado en protección de datos.**

## 3 · UX y facilidad de uso

- **Bamburu:** 65 entradas de menú, `DISEÑO.md` con reglas escritas, cero cuadros de diálogo del
  navegador, oficios que precargan catálogo y vocabulario. DISA como forma principal de uso.
- **Ellos:** SAP es notoriamente duro (implantarlo es un proyecto con consultores). Salesforce sostiene
  una industria de certificaciones. Odoo es el más amable y aun así asume usuario formado.
- **Clave:** ellos **no pueden simplificar** — su interfaz debe servir a la multinacional y al autónomo,
  y gana la multinacional.
- **Veredicto: potencialmente élite. La ventaja no viene de programar mejor, sino de tener un cliente
  más estrecho.**

## 4 · Funcionalidad

- **Bamburu:** 6 módulos, 134 tablas/negocio, 611 rutas. Facturación legal ES completa, contabilidad
  con libros y 303/130, inventario multi-almacén con lotes y WAC, compras con recepciones, CRM,
  agenda con reserva pública, portal de cliente, control horario. Faltan 24 del producto, 12 del
  suelo legal, 4 bloqueadas.
- **Ellos:** decenas de apps y miles de módulos (Odoo); cadenas de suministro globales (SAP);
  plataforma sobre la que se construyen productos (Salesforce).
- **Veredicto: a años luz en amplitud, y da igual.** Lo que falta y sí importa es el **suelo legal**
  (envío real a la AEAT, Facturae firmado, balance, cuentas anuales). Sin eso no se cobra al primer
  cliente serio; con eso, la amplitud de SAP deja de importar.

## 5 · Observabilidad y confiabilidad

- **Bamburu:** cero CI, cero logging estructurado, cero métricas, cero trazas. 22 `console.log`. 267
  comprobaciones que se ejecutan a mano. **A favor:** backups con verificación MD5 y restore-test.
- **Ellos:** estado por instancia publicado, endpoint `/limits`, operación 24/7, SLA contractuales.
- **Veredicto: aficionado, salvo en backups, donde está por encima de la media.** Es el eje más flojo.

## 6 · APIs y extensibilidad

- **Bamburu:** 611 rutas internas, sin versionado, sin OpenAPI, `zod` en 16 sitios, sin sistema de
  extensiones.
- **Ellos:** Salesforce con REST/SOAP/Bulk/Streaming y cuotas diarias documentadas; Odoo con
  XML-RPC/JSON-RPC y un ecosistema de módulos que es media razón de su éxito; SAP con BAPIs y OData.
- **Veredicto: aficionado, pero es el eje más mecánico de arreglar.**

## 7 · Documentación y soporte

- **Bamburu:** documentación interna excepcional (CANON, TABLERO, RITUAL, biblia de contexto,
  auditorías con `file:line`). Documentación externa: ninguna. Soporte: una persona, sin SLA.
- **Ellos:** Trailhead y certificaciones; documentación por versión y red de partners; consultoras.
- **Veredicto: élite hacia dentro, inexistente hacia fuera.**

## ¿Élite en algo?

Sí, en cuatro cosas, y tres son **estructurales** — no dependen de tener más gente:

1. **Aislamiento entre clientes.** Mejor que Salesforce, no «casi». Es una propiedad **vendible**.
2. **Trazabilidad de decisiones.** Equipos grandes no la tienen.
3. **Superficie de dependencias.** 8 paquetes, 0 altas. Un Odoo arrastra cientos.
4. **Verificación de las copias.** Casi nadie prueba el restore; aquí se prueba cada noche, dos veces.

## ¿Aficionado en algo?

Cero CI · cero observabilidad · sin roles · datos personales sin cifrar · sin RGPD funcional · un
hilo y un proceso. **Ninguno es difícil: todos son trabajo pendiente, no problemas sin resolver.**

## Dónde está el potencial real

No en parecerse a ellos, sino donde ellos no llegan por su propio tamaño:

- **Cumplimiento español nativo.** VERI\*FACTU no es un módulo enchufado: es la columna vertebral.
  Odoo lo resuelve con localizaciones de terceros; SAP con un consultor. **Terminar el suelo legal es
  la inversión de mayor retorno del proyecto**: con eso se puede cobrar.
- **La IA como forma de uso, no como añadido.** DISA propone y ejecuta con confirmación humana,
  permisos reales y traza. Los asistentes de los grandes consultan; el suyo opera. No pueden copiarlo
  sin rehacer su producto: su superficie es demasiado grande para dejar que una IA la accione con
  seguridad.
- **El oficio precargado.** Un fisio entra y encuentra su agenda, vocabulario y catálogo montados.

**Advertencia:** lo que mataría el proyecto no es que le falte multi-moneda, sino intentar tenerlo.
Cada función genérica que se persiga aleja de lo único irreplicable: ser el programa que un autónomo
español abre y entiende, con Hacienda resuelta por dentro.

**En una frase:** cimientos de producto serio y acabados de proyecto personal. Los cimientos no se
compran con dinero; los acabados sí.

## Fuentes

- Odoo 19 · Architecture Overview — https://www.odoo.com/documentation/19.0/developer/tutorials/server_framework_101/01_architecture.html
- Salesforce · Execution Governors and Limits — https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm
- Salesforce · Platform Multitenant Architecture — https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-multitenant-architecture.html
- SAP S/4HANA Cloud · arquitectura — https://www.leanix.net/en/wiki/tech-transformation/what-is-s4hana-cloud
