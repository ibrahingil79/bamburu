<!-- PROCEDENCIA — este bloque lo añadió Claude Code el 2 sep 2026. Lo de debajo NO se ha tocado. -->

> # ⚠️ ESTE DOCUMENTO NO ESTABA EN EL REPOSITORIO
>
> Lo escribió **Codex (ChatGPT)** el **25 de agosto de 2026**, entre las 17:52 y las 19:00, en
> respuesta al encargo *«AUDITORÍA INTEGRAL FORENSE DE BAMBURU — SOLO LECTURA»* que Ibrahin le dio
> ese día a las 18:54.
>
> **Nunca llegó a guardarse.** No hay ningún commit suyo, ni fichero, ni rastro en `docs/`. Vivía
> dentro del historial de sesiones de Codex —`~/.codex/sessions/2026/08/25/rollout-2026-08-25T17-52-15-01a03a0d-2808-7070-8a0d-eac3f6141042.jsonl`—
> y se habría perdido con esa carpeta. Se recuperó el **2 de septiembre de 2026** y se guarda aquí
> **íntegro y literal**: 43.028 caracteres, 590 líneas, 22 hallazgos numerados. **Ni una palabra
> corregida, resumida ni actualizada.**
>
> **LÉELO CON SU FECHA DELANTE.** Es del 25 de agosto, y desde entonces han pasado cosas:
>
> - **AUD-001** (barrido nocturno automático) — **cerrado** el 26 ago, commit `bff11d0`.
> - **AUD-017** (rate limiting no persistente) — **cerrado** el 27 ago, commit `2d258c8`.
> - **AUD-008** (copias sin cifrado propio) — **SIGUE ABIERTO** a 2 sep 2026. Comprobado ese día en
>   el servidor: no existen los remotes `crypt` ni el fichero de destinos, y las copias salen en
>   claro. Es el mismo hallazgo que volvió a salir en la auditoría del orquestador nueve días
>   después.
>
> El resto **no se ha contrastado uno a uno**: quien lo use tiene que comprobar cada hallazgo contra
> el código de hoy antes de darlo por vigente o por cerrado. Un informe de hace nueve días leído como
> si fuera de hoy es exactamente la clase de afirmación falsa que este proyecto lleva dos días
> quitando de en medio.

---

# VEREDICTO EJECUTIVO

Bamburu es una base técnicamente seria, con una arquitectura multi-tenant mejor planteada que la habitual en un producto de esta madurez: cada negocio tiene su propia SQLite y el acceso se resuelve mediante contexto de petición, no mediante filtros `tenant_id` dispersos.

No he demostrado ninguna fuga directa entre negocios ni corrupción actual de las bases. Las ocho bases inspeccionadas respondieron `ok` a `PRAGMA quick_check`.

Sin embargo, no considero Bamburu suficientemente endurecido todavía para afirmar que es seguro frente a un atacante profesional o para operar datos sanitarios reales sin trabajo adicional.

No encontré un P0 demostrado, pero sí varios P1: DISA conserva vías demasiado poderosas de escritura; puede borrar conversaciones de todo el negocio; su consulta SQL no impone realmente el límite prometido; sus rutas están fuera del CSRF común; y existe un barrido nocturno automático activo que contradice frontalmente el ritual vigente y ya ha demostrado capacidad para ensuciar datos y agotar disco.

La arquitectura aguanta razonablemente decenas o quizá centenares de negocios, pero no 1.000–10.000 sin revisar conexiones SQLite permanentes, procesos lineales por tenant, rate limits locales y el servidor único.

Las copias están muy bien verificadas, pero no constituyen todavía una recuperación completa: no incluyen configuración, secretos ni certificados, conservan solo 14 días y no aplican cifrado propio antes de subir a Drive.

DISA está bien orientada conceptualmente y tiene defensas valiosas, especialmente aislamiento tenant, permisos reutilizados, tablas sanitarias prohibidas y confirmación humana. Aun así, su superficie de acciones y SQL contradice parcialmente “el dueño no opera, decide”.

Frente al mercado, Bamburu ya transmite un producto inicial serio. Está por detrás en profundidad operativa, pagos, movilidad, integraciones y pulido; está por delante en coherencia potencial entre gestión, fiscalidad española y una IA integrada con control humano.

Lo mejor es el diseño tenant por base, la trazabilidad fiscal, el cuidado de las copias y la reutilización de reglas entre pantallas y DISA.

Lo más preocupante es la combinación de IA con escritura genérica, el automatismo nocturno heredado, la recuperación incompleta y la gran cantidad de complejidad acumulada en archivos monolíticos y piezas archivadas.

# MARCADOR GENERAL

| Área | Nota | Diagnóstico |
|---|---:|---|
| Arquitectura | 7,5 | Base coherente y modular en intención; varios módulos se han convertido en monolitos. |
| Calidad de código | 6,5 | Mucha validación y comentarios útiles, pero complejidad y caminos heredados elevados. |
| Seguridad | 5,5 | Buenas defensas básicas; faltan endurecimiento web y límites estrictos en DISA. |
| Multi-tenant | 8,0 | Separación física por BD y contexto asíncrono; no demostré cruce entre negocios. |
| Integridad de datos | 7,0 | Transacciones, claves y cadenas fiscales; DISA aún puede eludir algunos servicios. |
| DISA | 6,0 | Diseño diferencial real, pero con agencia y SQL excesivos. |
| Privacidad | 5,5 | Protección sanitaria parcial; faltan garantías operativas, cifrado y validación jurídica. |
| Operación/infraestructura | 6,0 | Systemd, alertas y copias sólidas; servidor único y barrido automático contradictorio. |
| Escalabilidad | 5,5 | Adecuada hoy; riesgos claros a partir de cientos/miles de tenants. |
| UX | 6,5 | Amplia y consistente en intención; arrastra formato, accesibilidad y frontend legado. |
| Coherencia documental | 5,0 | Autoridades principales saneadas, pero `docs/contexto` y la operación real contradicen el ritual. |
| Mantenibilidad | 5,5 | Demasiados archivos gigantes, scripts y sistemas archivados coexistiendo. |
| Calidad frente al mercado | 5,5 | Producto inicial serio; aún lejos de la profundidad y acabado líderes. |

# HALLAZGOS CRÍTICOS Y ALTOS

No he demostrado ningún P0.

## AUD-001 — Barrido nocturno automático activo

**ID:** AUD-001  
**Severidad:** P1  
**Área:** Operación / gobernanza  
**Qué he encontrado:** Existe un barrido completo automático habilitado y activo cada madrugada. Contradice la prohibición expresa de ejecutar gates o barridos por iniciativa propia.  
**Evidencia:** `/etc/systemd/system/bamburu-barrido-nocturno.timer`, `OnCalendar=03:15`; `/etc/systemd/system/bamburu-barrido-nocturno.service`, `ExecStart=/home/ubuntu/bamburu/scripts/barrido-nocturno.sh`. `systemctl` confirmó `enabled`, `active` y una ejecución el 25-08-2026. `RITUAL.md:17-84,239-244` y `AGENTS.md:69-83` dicen lo contrario.  
**Por qué importa:** Los gates históricos escriben en la base de desarrollo y ya han dejado clientes, facturas, asientos y otros residuos; varios barridos también contribuyeron al agotamiento de disco documentado.  
**Qué podría pasar:** Corrupción de datos de desarrollo, falsos avisos, correo involuntario, disco lleno o caída del servicio.  
**Probabilidad:** alta  
**Confianza:** alta  
**Solución recomendada:** decisión operativa explícita: retirar el temporizador o modificar el ritual. No deben coexistir ambas normas.  
**Clasificación:** deuda/contradicción existente.

## AUD-002 — DISA puede borrar la conversación de todo el negocio

**ID:** AUD-002  
**Severidad:** P1  
**Área:** DISA / autorización / pérdida de datos  
**Qué he encontrado:** `POST /api/disa/clear` ejecuta `DELETE FROM disa_conversations` sin filtrar por usuario ni hilo. Las rutas de DISA no pasan por el middleware CSRF común del ERP.  
**Evidencia:** `modules/disa/index.js:2780-2783,2852-2853`; el CSRF solo se monta en `modules/erp/routes/index.js:123-124,211-212`.  
**Por qué importa:** Una petición aceptada elimina el historial DISA de todos los usuarios del tenant. `adminAuth` autentica una sesión del panel, pero no convierte esta operación en borrado individual.  
**Qué podría pasar:** Pérdida completa del historial conversacional de un negocio, incluida evidencia de decisiones.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** borrar únicamente el hilo/usuario solicitado, exigir permiso explícito, CSRF y confirmación inequívoca; valorar archivo en vez de borrado.  
**Clasificación:** bug/vulnerabilidad existente.

## AUD-003 — DISA conserva escritura genérica y borrado duro

**ID:** AUD-003  
**Severidad:** P1  
**Área:** DISA / integridad de negocio  
**Qué he encontrado:** DISA ofrece `insert_record`, `update_record` y `delete_record` sobre una lista de tablas. Entre ellas figuran productos, categorías, proveedores, configuración y ajustes. `delete_record` usa `DELETE`, no archivo.  
**Evidencia:** `modules/disa/index.js:212-260,295-309,382-448`.  
**Por qué importa:** El propio principio del proyecto prohíbe destruir datos de tenant y exige servicios validados para las operaciones con consecuencias. Una allowlist reduce el riesgo, pero no sustituye reglas de negocio específicas.  
**Qué podría pasar:** Configuración incompleta, referencias rotas, pérdida de catálogos o divergencia entre la pantalla y DISA.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** eliminar las operaciones genéricas de producción; usar exclusivamente acciones de dominio, con validación, archivo, permisos y confirmación específica.  
**Clasificación:** vulnerabilidad de diseño/deuda existente.

## AUD-004 — DISA modifica stock fuera del libro de movimientos

**ID:** AUD-004  
**Severidad:** P1  
**Área:** Inventario / DISA  
**Qué he encontrado:** `edit_product` actualiza directamente `products.stock`. El camino genérico también permite actualizar columnas de `products`, incluida `stock`.  
**Evidencia:** `modules/disa/index.js:421-437,544-555`; el mismo archivo afirma en `:238-248` que el stock debe moverse mediante servicios validados y `stock_movements`.  
**Por qué importa:** Puede divergir el stock visible del libro que sustenta valoración, reservas y trazabilidad.  
**Qué podría pasar:** existencias y coste incorrectos, ventas sobre stock falso y analítica incoherente.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** impedir cualquier escritura directa de stock y canalizarla por `adjustStock`/libro de movimientos.  
**Clasificación:** bug de integridad existente.

## AUD-005 — La consulta SQL de DISA no aplica el límite prometido

**ID:** AUD-005  
**Severidad:** P1  
**Área:** DISA / privacidad / consumo  
**Qué he encontrado:** La herramienta pide al modelo “usa LIMIT 20”, pero el servidor ejecuta literalmente cualquier `SELECT` autorizado. No añade límite, timeout ni presupuesto de filas.  
**Evidencia:** `modules/disa/index.js:2564-2579,2590-2600`.  
**Por qué importa:** Una inyección de prompt, alucinación o respuesta defectuosa puede cargar y enviar al proveedor IA todos los clientes, facturas o apuntes que el usuario tenga permiso para leer.  
**Qué podría pasar:** exposición masiva dentro del tenant al proveedor, alto consumo de memoria/tokens y respuestas lentas.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** parser SQL defensivo, límite impuesto por servidor, allowlist de columnas/vistas preparadas y presupuesto estricto de filas/bytes.  
**Clasificación:** vulnerabilidad existente.

## AUD-006 — Rutas de DISA sin la protección CSRF común

**ID:** AUD-006  
**Severidad:** P1  
**Área:** Web / DISA  
**Qué he encontrado:** El router se monta directamente en `/admin/disa` y `/api/disa`; no hereda `csrfProtect()` de los routers ERP.  
**Evidencia:** `modules/disa/index.js:2852-2853`; `modules/erp/routes/index.js:58-64,123-124,207-212,269`.  
**Por qué importa:** `SameSite=Lax` reduce ataques cross-site clásicos, pero no es una defensa suficiente frente a orígenes same-site/subdominios, XSS o futuras variaciones de cookies. Las rutas ejecutan acciones y borrados.  
**Qué podría pasar:** ejecución de operaciones DISA usando la sesión de una víctima.  
**Probabilidad:** baja-media  
**Confianza:** alta respecto a la ausencia; media respecto a explotabilidad actual.  
**Solución recomendada:** aplicar CSRF uniformemente a todo endpoint autenticado que cambie estado.  
**Clasificación:** vulnerabilidad defensiva existente.

## AUD-007 — El cargador oculta fallos completos de módulos

**ID:** AUD-007  
**Severidad:** P1  
**Área:** Disponibilidad / observabilidad  
**Qué he encontrado:** Si falla la importación o registro de ERP, tienda, DISA o portal, el proceso solo emite `console.warn` y continúa arrancado.  
**Evidencia:** `core/loader.js:3-12`.  
**Por qué importa:** systemd puede considerar Bamburu sano aunque falte facturación, portal o DISA.  
**Qué podría pasar:** despliegue parcialmente operativo y fallo detectado por clientes antes que por operación.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** fallar el arranque para módulos obligatorios y disponer de health check que compruebe capacidades esenciales.  
**Clasificación:** defecto arquitectónico existente.

## AUD-008 — Recuperación incompleta y copias sin cifrado propio

**ID:** AUD-008  
**Severidad:** P1  
**Área:** Backups / privacidad / continuidad  
**Qué he encontrado:** El backup cubre `control.db`, bases tenant y `uploads`, verifica hash, descarga y apertura; pero no incluye `/etc/bamburu.env`, certificados Verifactu, configuración de Caddy/systemd ni configuración de rclone. Los archivos se suben sin cifrado cliente visible y se conservan 14 días.  
**Evidencia:** `scripts/bamburu-backup.sh:23-38,81-157`; certificados externos en `modules/erp/verifactu-envio.js:71-133`.  
**Por qué importa:** Recuperar datos no equivale a recuperar el servicio. Drive recibe bases con información personal y sanitaria.  
**Qué podría pasar:** restauración imposible o lenta tras pérdida total; exposición del contenido si se compromete la cuenta remota.  
**Probabilidad:** baja-media  
**Confianza:** alta  
**Solución recomendada:** copia cifrada y separada de configuración/certificados, inventario de secretos, retención por capas y simulacro documentado de reconstrucción completa.  
**Clasificación:** deuda operativa existente.

# HALLAZGOS MEDIOS

## AUD-009 — Portal mediante bearer token amplio en URL

**ID:** AUD-009  
**Severidad:** P2  
**Área:** Portal / privacidad  
**Qué he encontrado:** El token aparece en ruta y concede acceso reutilizable al portal, histórico, mensajes y PDFs. Las respuestas no fijan `Cache-Control: no-store`.  
**Evidencia:** `modules/portal/index.js:45-56,101-141`; generación/TTL en `modules/portal/portal.js`.  
**Riesgo:** filtración por historial, logs, capturas, reenvío o caché.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** sesión derivada del enlace, alcance configurable, revocación visible, no-store y política de referer más restrictiva.  
**Clasificación:** riesgo de diseño existente.

## AUD-010 — Abrir el portal modifica el estado de mensajes

**ID:** AUD-010  
**Severidad:** P2  
**Área:** Portal / comunicaciones  
**Qué he encontrado:** `GET /portal/:token` llama a `marcarVisto`.  
**Evidencia:** `modules/portal/index.js:86-90`.  
**Riesgo:** previsualizadores de correo, robots o aperturas accidentales pueden marcar mensajes como vistos sin lectura humana.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** separar la visualización de la confirmación de lectura o usar un evento cliente explícito.  
**Clasificación:** bug semántico existente.

## AUD-011 — Subidas validadas por MIME declarado

**ID:** AUD-011  
**Severidad:** P2  
**Área:** Ficheros / DISA  
**Qué he encontrado:** Se acepta `file.type`; no se verifica la firma real del archivo. Se escribe el binario antes de insertar el metadato y no hay compensación si falla la BD.  
**Evidencia:** `modules/disa/index.js:2809-2827`; `modules/erp/attachments.js:17-27,44-55`.  
**Riesgo:** MIME falso, contenido hostil almacenado y ficheros huérfanos.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** magic bytes, análisis seguro, transacción compensable y permisos explícitos.  
**Clasificación:** deuda de seguridad existente.

## AUD-012 — Ruta de adjunto admite paths absolutos persistidos

**ID:** AUD-012  
**Severidad:** P2  
**Área:** Ficheros  
**Qué he encontrado:** `readAttachmentBuffer` acepta una ruta absoluta procedente de la BD.  
**Evidencia:** `modules/erp/attachments.js:73-79`.  
**Riesgo:** una escritura indebida en `attachments.path` podría convertir el endpoint autorizado en lector de archivos locales.  
**Probabilidad:** baja  
**Confianza:** alta  
**Solución recomendada:** resolver siempre dentro del directorio tenant y rechazar cualquier escape.  
**Clasificación:** vulnerabilidad encadenable existente.

## AUD-013 — CSP débil en la mayor superficie autenticada

**ID:** AUD-013  
**Severidad:** P2  
**Área:** XSS / frontend  
**Qué he encontrado:** El ERP mantiene `script-src 'unsafe-inline'` por aproximadamente 522 manejadores inline. Solo registro, superadmin y reserva pública usan nonce estricto.  
**Evidencia:** `core/security-headers.js:3-20,43-83`.  
**Riesgo:** cualquier XSS en una pantalla autenticada tiene más facilidad para ejecutar JavaScript.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** retirar handlers inline por superficies y pasar todo el ERP a CSP con nonce.  
**Clasificación:** deuda técnica y de seguridad existente.

## AUD-014 — Frenos de IA fail-open y sin timeout

**ID:** AUD-014  
**Severidad:** P2  
**Área:** DISA / costes / disponibilidad  
**Qué he encontrado:** Modelo desconocido cuesta cero a efectos del límite; errores de lectura/registro de gasto no bloquean; `fetch` no tiene `AbortSignal`.  
**Evidencia:** `core/llm.js:29-73,120-149,158-170`.  
**Riesgo:** gasto no contabilizado y peticiones colgadas.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** modelo desconocido = denegado, contabilización conservadora y timeout obligatorio.  
**Clasificación:** deuda existente.

## AUD-015 — Confirmación textual demasiado permisiva

**ID:** AUD-015  
**Severidad:** P2  
**Área:** DISA / control humano  
**Qué he encontrado:** Un mensaje que empiece por “sí”, “ok”, “correcto”, “exacto”, etc. ejecuta la acción pendiente.  
**Evidencia:** `modules/disa/index.js:2652-2677`.  
**Riesgo:** una respuesta conversacional ambigua puede confirmar una operación distinta de la que el usuario cree.  
**Probabilidad:** baja-media  
**Confianza:** alta  
**Solución recomendada:** confirmación estructurada vinculada al hash/resumen de la acción, caducidad y botón visual.  
**Clasificación:** defecto de UX/seguridad existente.

## AUD-016 — Prompt injection sigue siendo una amenaza real

**ID:** AUD-016  
**Severidad:** P2  
**Área:** DISA / GenAI  
**Qué he encontrado:** DISA reintroduce resultados de herramientas, documentos y datos del negocio en el contexto del modelo. La autorización del servidor reduce el impacto, pero el modelo determina consultas y propuestas.  
**Evidencia:** `modules/disa/index.js:2590-2643,2678-2737`; adjuntos en `:2802-2827`.  
**Riesgo:** instrucciones ocultas en documentos o datos pueden manipular respuestas, consultas o acciones propuestas.  
**Probabilidad:** media  
**Confianza:** alta conceptualmente; explotabilidad no probada.  
**Solución recomendada:** tratar contenido recuperado como no confiable, minimizar herramientas y datos, separar modelos/etapas y validar acciones fuera del modelo. Coincide con los riesgos oficiales de [prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) y [exceso de agencia](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).  
**Clasificación:** riesgo inherente no plenamente mitigado.

## AUD-017 — Rate limiting local y no persistente

**ID:** AUD-017  
**Severidad:** P2  
**Área:** Seguridad / escalabilidad  
**Qué he encontrado:** Los límites viven en memoria del proceso.  
**Evidencia:** `core/rate-limit.js`; aplicación global en `index.js:27-44`.  
**Riesgo:** se reinician al caer el proceso y no funcionan coordinadamente si se escala horizontalmente.  
**Probabilidad:** alta al escalar  
**Confianza:** alta  
**Solución recomendada:** almacén compartido o límites en proxy para superficies críticas.  
**Clasificación:** limitación de escalabilidad.

## AUD-018 — Conexiones SQLite tenant sin expulsión

**ID:** AUD-018  
**Severidad:** P2  
**Área:** Escalabilidad  
**Qué he encontrado:** Cada tenant abierto queda indefinidamente en un `Map`.  
**Evidencia:** `core/tenant-middleware.js:8-35,127-130`.  
**Riesgo:** crecimiento de descriptores, memoria y conexiones WAL a medida que aumenten los negocios.  
**Probabilidad:** baja hoy; alta a miles de tenants  
**Confianza:** alta  
**Solución recomendada:** caché LRU, cierre por inactividad y límites observables.  
**Clasificación:** limitación futura, no bug actual.

## AUD-019 — Esquema y ficheros tenant no coinciden por completo

**ID:** AUD-019  
**Severidad:** P2  
**Área:** Datos / higiene  
**Qué he encontrado:** `control.db` registra siete tenants, pero existen ocho bases. `desarrollo.db` no figura en control. La base `desarrollo-bamburu.db` tiene 135 tablas y las demás 134; la diferencia observada es `inventory_movements_legacy`.  
**Evidencia:** consultas SQLite `SELECT slug,db_filename,status FROM tenants`; listado `data/tenants/*.db`.  
**Riesgo:** base huérfana, copia innecesaria, información retenida y posible drift.  
**Probabilidad:** alta, ya existe  
**Confianza:** alta  
**Solución recomendada:** inventario formal y decisión explícita de archivo/conservación; no borrar sin identificar propietario e historia.  
**Clasificación:** deuda de datos existente.

## AUD-020 — Recuperación no prueba el sistema completo

**ID:** AUD-020  
**Severidad:** P2  
**Área:** Continuidad  
**Qué he encontrado:** El backup hace una excelente descarga y `integrity_check`, pero no arranca una restauración aislada ni verifica relaciones funcionales.  
**Evidencia:** `scripts/bamburu-backup.sh:85-143`.  
**Riesgo:** una copia íntegra puede no bastar para recuperar Bamburu.  
**Probabilidad:** baja  
**Confianza:** alta  
**Solución recomendada:** simulacro periódico de reconstrucción completa en entorno aislado.  
**Clasificación:** deuda operativa.

## AUD-021 — Documentación activa contradictoria

**ID:** AUD-021  
**Severidad:** P2  
**Área:** Documentación  
**Qué he encontrado:** `docs/contexto/flujo-de-trabajo.md` todavía ordena a Claude Code tomar la primera tarea “POR HACER”, moverla a “EN CURSO” y ejecutar verificación automática.  
**Evidencia:** `docs/contexto/flujo-de-trabajo.md:13,22-33`; contradice `RITUAL.md:17-84,170-193,239-244` y `AGENTS.md:69-83`.  
**Riesgo:** un agente que lea contexto antiguo puede iniciar trabajo o ejecutar pruebas sin permiso.  
**Probabilidad:** media  
**Confianza:** alta  
**Solución recomendada:** actualizar el documento o encabezarlo inequívocamente como histórico.  
**Clasificación:** deuda documental existente.

## AUD-022 — Automatismos recorren todos los tenants linealmente

**ID:** AUD-022  
**Severidad:** P2  
**Área:** Escalabilidad / operación  
**Qué he encontrado:** avisos, propuestas, recordatorios, caducidad y otros procesos declaran que iteran todas las bases tenant.  
**Evidencia:** unidades `/etc/systemd/system/bamburu-*.service`.  
**Riesgo:** a 1.000–10.000 clientes, una pasada puede solaparse con la siguiente y amplificar uso de disco, CPU, correo y bloqueos.  
**Probabilidad:** baja hoy; alta al escalar  
**Confianza:** alta estructuralmente  
**Solución recomendada:** cola de trabajos, leasing/idempotencia por tenant, métricas de duración y backpressure.  
**Clasificación:** limitación futura.

# DEUDA TÉCNICA Y CÓDIGO BASURA

- Archivos desproporcionados:

  - `modules/erp/routes/citas.js`, aproximadamente 289 KB.
  - `modules/erp/models.js`, aproximadamente 208 KB.
  - `modules/disa/index.js`, aproximadamente 171 KB.
  - `modules/erp/routes/invoices.js`, aproximadamente 139 KB.
  - `modules/erp/layout.js`, aproximadamente 137 KB.
  - `modules/erp/routes/settings.js`, aproximadamente 128 KB.
  - `modules/erp/routes/analytics.js`, aproximadamente 119 KB.
  - `index.js`, aproximadamente 96 KB.

  Esto no es un defecto por tamaño aislado, pero concentra demasiadas responsabilidades y eleva el riesgo de regresión.

- El repositorio conserva sistemas desmontados en vez de retirados: POS/pedidos antiguos, envíos, cupones, feedback, newsletter, reseñas y tienda. Evidencia: rutas comentadas en `modules/erp/routes/index.js:223-253` y múltiples tablas `_archived`/`_legacy`.

- `store` sigue formando parte de `MODULE_ORDER` aunque gran parte de la tienda está desmontada: `core/loader.js:3`; rutas archivadas o comentadas en el módulo y ERP.

- El modelo real mantiene numerosas tablas históricas: `sales_orders_archived`, `sales_items_archived`, `customer_accounts_archived`, `role_permissions_archived`, `feedback_archived`, `inventory_movements_legacy`, etc. Conservar historia puede ser correcto, pero debe existir una política de retención/esquema.

- Hay once copias manuales de saneamientos recientes en `data/copias-limpieza/`, algunas superiores a 4 MB. Son recuperables y útiles, pero forman un sistema paralelo de backups sin retención documentada.

- `docs/contexto/piezas-cerradas.md` mantiene estados antiguos de los pilares y elementos que TABLERO ya presenta como cerrados.

- `docs/contexto/errores-conocidos.md:6` afirma que `CLAUDE.md` conserva `/home/ibrahin`; el `CLAUDE.md` actual ya no presenta ese problema. La advertencia sigue siendo relevante para algunos gates, pero está redactada como estado global actual.

- `RITUAL.md:32-45` conserva cifras antiguas de cantidad/duración de gates frente a recuentos recientes del TABLERO.

- Existe `/etc/systemd/system/bamburu.service.antes-b10`, copia histórica activa en la carpeta de unidades. No está habilitada, pero una copia con apariencia de unidad operativa es una fuente de confusión.

- Los scripts de pruebas son numerosos y varios reconocen que mutan datos, dejan residuos o dependen de datos/fechas. `docs/contexto/errores-conocidos.md:43-50` acredita falsos resultados, caminos muertos y asientos huérfanos. Esto confirma que no deben considerarse evidencia concluyente ni ejecutarse automáticamente.

- No encontré bases, secretos o uploads versionados; `.gitignore` excluye `data/`. La búsqueda de patrones conocidos no mostró claves privadas o tokens evidentes en el árbol Git actual.

# DETALLES DE CALIDAD Y PULIDO

- El portal presenta importes como `€1234.56` en vez de `1.234,56 €`: `modules/portal/index.js:52-55,72-83,106`.
- DISA contiene mensajes sin tildes: “no esta”, “Intentalo”, “accion”, “si”: `modules/disa/index.js:2560,2619,2729-2737`.
- `requirePerm` conserva un `alert('Acceso no permitido')`, contrario a la regla de no usar diálogos nativos: `core/auth.js`.
- La salida de errores del portal se coloca en query string: `modules/portal/index.js:125-126`. Aunque se escapa al mostrarla, queda en historial y logs.
- El portal dice “No tienes facturas pendientes” cuando la consulta puede representar una lista más amplia; revisar que texto y conjunto coincidan: `modules/portal/index.js:57`.
- No aparece ancla `id="hablar"` aunque la redirección usa `#hablar`: `modules/portal/index.js:93-104,124`.
- `toolCalls <= 4` permite cinco iteraciones, mientras el comentario y diseño apuntan a cuatro: `modules/disa/index.js:2604-2606`.
- El esquema completo se envía a DISA como texto. No contiene datos, pero aumenta tokens y acopla el modelo al esquema físico: `modules/disa/index.js:323-343`.
- `getAdminSession` elimina sesiones expiradas durante una lectura: `core/auth.js:79-104`. Es razonable funcionalmente, pero significa que una comprobación aparentemente de lectura puede escribir.
- Las sesiones se almacenan con token en claro en SQLite: `core/auth.js:70-90`. Los tokens aleatorios son fuertes, pero un robo de BD proporciona sesiones reutilizables hasta caducidad.
- La política `Permissions-Policy` desactiva geolocalización globalmente: `core/security-headers.js:35`. Esto puede entrar en conflicto con funciones futuras de mapa/fichaje/servicio de campo que necesiten consentimiento de ubicación.
- `Referrer-Policy: strict-origin-when-cross-origin` no es la política más conservadora para URLs con tokens: `core/security-headers.js:34`.
- Los uploads observados tienen modos diferentes (`0664` y `0700`). Los directorios padre `0700` reducen la exposición, pero la política no es uniforme.
- El frontend depende ampliamente de HTML y JavaScript inline. Esto dificulta accesibilidad, pruebas estructurales y CSP estricta.
- No encontré Stripe en `package.json` ni una implementación de cobro Stripe activa. Es funcionalidad no construida, no un bug.
- No hay aplicación móvil nativa ni experiencia técnica de campo comparable con líderes. Es roadmap pendiente, no defecto del código actual.

# SEGURIDAD

- **Autenticación:** tokens de 256 bits, cookies `HttpOnly; Secure; SameSite=Lax`, bcrypt, migración de hashes antiguos, sesiones de 24 horas, 2FA y códigos de rescate. Base sólida.
- **Recuperación:** tokens caducables y revocación de sesiones al cambiar contraseña. No se probaron activamente.
- **Autorización:** motor común `checkPermission`/`requirePerm`; owner/admin tienen bypass salvo datos clínicos. DISA reutiliza varios permisos, pero sus operaciones genéricas y `/clear` abren excepciones peligrosas.
- **Tenant:** base separada por negocio y `AsyncLocalStorage`; la sesión se enlaza al tenant en `control.db`. No encontré consultas centrales que mezclen datos de tenants.
- **CSRF:** correcto en ERP, ausente en DISA y no aplicable de la misma forma al portal bearer.
- **XSS:** escape HTML ampliamente usado, pero la CSP del ERP mantiene `unsafe-inline`; no puedo descartar XSS almacenado sin pruebas activas.
- **SQL injection:** las rutas de negocio usan mayoritariamente parámetros. La gran excepción deliberada es SQL generado por DISA; su allowlist protege tablas, pero el control es un analizador por expresiones regulares y no un parser SQL.
- **Ficheros:** fuera del árbol público y servidos con permiso; faltan magic bytes, confinamiento estricto de ruta y política uniforme.
- **Secretos:** no encontré secretos obvios versionados. `/etc/bamburu.env` y certificados quedan fuera del repo, correctamente, pero también fuera del backup.
- **Dependencias:** pocas dependencias, lo cual reduce superficie. No ejecuté `npm audit`, no consulté registros de paquetes ni instalé nada; las vulnerabilidades exactas necesitan comprobación posterior.
- **Infraestructura:** Caddy fuerza TLS y sobrescribe `X-Real-IP`; systemd aporta varias restricciones. `NoNewPrivileges=false` se mantiene por Chromium/snap, dejando una defensa importante desactivada.
- **Bases:** permisos `0700` sobre bases y directorios; WAL habilitado, `foreign_keys=ON` y límite de journal. Buen diseño.
- **Marcos de referencia:** la evaluación se orientó por [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/), [OWASP Top 10:2025](https://owasp.org/Top10/) y [OWASP GenAI Top 10 2026](https://genai.owasp.org/initiatives/top-10-for-llm-and-genai/).

# DISA

1. **¿Está bien diseñada?** Parcialmente. La separación entre propuesta, confirmación y servicio validado es buena; SQL y escrituras genéricas rebajan mucho la nota.
2. **¿Respeta “el dueño no opera, decide”?** En parte. Resume y prepara, pero también ejecuta CRUD, stock, pagos y cambios después de una confirmación textual mínima.
3. **¿Puede saltarse permisos?** No encontré cruce tenant ni bypass directo del motor común; sí acciones sin permiso específico y bypass owner/admin muy amplio.
4. **¿Puede filtrar información entre negocios?** No he encontrado un camino estático: opera sobre la conexión tenant activa.
5. **¿Puede ejecutar consecuencias sin confirmación?** Los handoffs se ejecutan inmediatamente porque, según el código, no mueven negocio. Las demás acciones usan confirmación, pero es ambigua.
6. **¿Es vulnerable a prompt injection?** Sí, conceptualmente, de forma directa e indirecta mediante documentos/datos. Las validaciones servidor reducen daño, no eliminan la amenaza.
7. **¿Se validan outputs?** Parcialmente. Se parsean JSON/bloques y varios servicios validan dominio; el SQL libre y CRUD genérico no tienen validación semántica suficiente.
8. **¿Se minimizan datos sensibles?** Los datos clínicos, sesiones y logs están expresamente prohibidos. Clientes, facturas, contabilidad y otra PII pueden enviarse al modelo sin minimización de columnas/filas.
9. **¿Qué ocurre si falla el proveedor?** DISA devuelve error; las funciones ERP normales permanecen independientes.
10. **¿Qué ocurre al agotarse el saldo?** Hay topes tenant/global y respuesta 429; el control falla abierto ante ciertos errores y modelos desconocidos.
11. **¿Dependencia excesiva de IA?** No para el núcleo ERP; sí para captura documental y funciones diferenciales.
12. **¿Preparada para crecer?** No plenamente: conversación grande, esquema completo, consultas sin límite forzado, llamadas sin timeout y contadores locales.

**Conclusión:** DISA no debería considerarse todavía suficientemente segura para manejar indiscriminadamente datos reales sensibles. El bloqueo absoluto de las tablas clínicas es una buena defensa, pero clientes, facturas, documentos y acciones económicas necesitan límites más estrictos.

# PRIVACIDAD Y CUMPLIMIENTO TÉCNICO

- Bamburu implementa consentimiento, antecedentes/notas clínicas y registro `hc_accesos`; DISA bloquea esas tablas incluso a owner/admin.
- La separación por tenant y los permisos específicos son técnicamente apropiados para datos de salud.
- No pude verificar si cada acceso clínico, exportación, impresión, backup y acceso administrativo genera una huella completa.
- No observé cifrado local de bases ni cifrado cliente de backups. Los permisos de sistema no sustituyen cifrado ante robo de disco o cuenta cloud.
- El portal expone datos mediante token bearer reutilizable.
- No hay evidencia suficiente en esta auditoría para validar plazos de conservación, supresión, exportación RGPD, contratos con Anthropic/Resend/Drive ni transferencias internacionales.
- El RGPD exige minimización y seguridad apropiada; los datos sanitarios son categoría especial. Fuentes: [RGPD, artículo 5](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679) y [criterio AEPD sobre trazabilidad sanitaria](https://www.aepd.es/informes-y-resoluciones/criterios-juridicos-aepd/acceso-informacion-de-trazabilidad-datos-de-salud-en-relacion-reglamento-ehds).
- Verifactu dispone de registros encadenados, anulaciones adicionales, cola e integridad. El diseño es compatible en intención con integridad, conservación, trazabilidad e inalterabilidad exigidas por el [Real Decreto 1007/2023](https://www.boe.es/eli/es/rd/2023/12/05/1007). La conformidad legal completa requiere validación profesional y pruebas oficiales; no puede deducirse de los gates.

# COMPARATIVA DE MERCADO

| Área | Bamburu | Holded | Odoo | Zoho One | Jobber | Housecall Pro | ServiceTitan | Fresha | Diagnóstico |
|---|---|---|---|---|---|---|---|---|---|
| Facturación España | Amplia, contabilidad y Verifactu propio | Muy madura | Amplia/localizable | Books, menor foco ES | Básica | Básica | Integrada/externa | POS/pagos | 🟡 Cerca de Holded en ambición, falta validación comercial |
| CRM | Clientes, oportunidades, historia 360° | CRM integrado | CRM modular profundo | CRM muy maduro | Cliente/trabajo | Cliente/pipeline | CRM operativo avanzado | Cliente 360° sectorial | 🟡 Aceptable, por detrás |
| Presupuesto→pedido→entrega→factura | Existe cadena coherente | Maduro | Muy profundo | Repartido entre apps | Flujo central excelente | Flujo central excelente | Excelente | No es su foco | 🟢 Al nivel conceptual; menor pulido |
| Inventario/compras | Multi-almacén, lotes, WAC, compras | Maduro | Muy profundo | Inventory/Books | Limitado | Menor | Muy integrado con campo | Retail sectorial | 🟡 Sólido, por detrás de ERP líderes |
| Proyectos/tiempo/rentabilidad | Construido | Muy maduro | Muy maduro | Projects integrado | Jobs | Jobs/job costing | Muy avanzado | No es su foco | 🟡 |
| Agenda/reservas | Agenda, recursos, portal público | Agenda CRM | Planning/Field Service | Bookings | Muy fuerte | Muy fuerte | Muy fuerte | Referencia sectorial | 🟠 Falta profundidad de campo/belleza |
| Servicio de campo | No desarrollado plenamente | Limitado | Planificación, materiales, firma, rutas | Apps combinables | Referencia pyme | Referencia pyme | Referencia avanzada | No es su foco | Fuera del peldaño actual |
| Portal cliente | Facturas, mensajes, analítica | Portal maduro | Portal amplio | Portales por app | Autoservicio completo | Autoservicio completo | Portal completo | Reservas/pagos | 🟡 Original, pero menos seguro/pulido |
| Pagos integrados | No encontré Stripe activo | Integraciones y tesorería | Pagos múltiples | Zoho Payments/Books | Pagos integrados | Tarjeta/ACH | Fintech propio | Pagos/depositos | 🟠 Carencia importante, pendiente |
| Permisos | Motor común, por módulo/acción | Roles | Muy granular | Muy granular | Por plan/rol | Roles operativos | Enterprise | Equipo/roles | 🟡 Buen comienzo |
| Automatización | Timers y DISA | Automatizaciones | Flujos extensos | Muy extensa | Automatización de trabajos | Automatizaciones | Muy avanzada | Recordatorios/marketing | 🟡 |
| IA | DISA transversal con acciones | IA contable/MCP anunciado | IA modular | Zia en suite | Automatizaciones/IA puntual | IA operativa | Titan Intelligence | Recomendaciones | 🟢 Diferencial real, con mayor riesgo |
| Movilidad | Web responsive | Multidispositivo | Apps/móvil | Apps móviles | App de campo | App de campo | App técnico | Apps consumidor/profesional | 🟠 |
| Ecosistema/API | Muy limitado | API e integraciones | Ecosistema enorme | Suite e integraciones | Integraciones | Integraciones | Ecosistema vertical | Marketplace | 🟠 |
| UX/acabado | Coherente pero legado inline | Muy pulida | Potente/compleja | Fragmentada entre apps | Muy enfocada | Muy enfocada | Potente/compleja | Muy pulida | 🟡 |

Referencias de capacidades actuales: [Holded](https://www.holded.com/es/funcionalidades), [Odoo Field Service](https://www.odoo.com/documentation/saas-19.2/applications/services/planning/field_service.html), [Zoho One](https://www.zoho.com/one/applications/web.html), [Housecall Pro](https://www.housecallpro.com/features/), [ServiceTitan](https://www.servicetitan.com/features), [Fresha](https://www.fresha.com/for-business/features) y [Sage España](https://www.sage.com/es-es/software-contabilidad/).

### Bamburu está claramente por delante en

- Una visión unificada de IA que consulta y actúa sobre el mismo producto, en vez de un chatbot añadido.
- Separación física de datos por negocio, más fácil de razonar y restaurar individualmente.
- Integración explícita entre operación, contabilidad española, Verifactu y DISA.
- Filosofía de propuesta y confirmación humana, aunque la implementación todavía necesite endurecimiento.

### Bamburu está aproximadamente al nivel en

- Cadena documental comercial.
- Inventario básico-avanzado para una pyme.
- Proyectos, tiempos y rentabilidad.
- Roles y permisos de una primera versión comercial.
- Copias verificadas de bases y uploads.

### Bamburu está por detrás en

- Acabado y uniformidad UX.
- Pagos embebidos, depósitos y políticas de no-show.
- Aplicación móvil y operación de campo.
- Integraciones, API pública y ecosistema.
- Dispatch, rutas, firma y seguimiento técnico.
- Automatización configurable por el usuario.
- Observabilidad, alta disponibilidad y escalado.
- Madurez demostrable de seguridad y cumplimiento.

### Funciones fuera del orden actual que no son bugs

- Profundidad específica de belleza: comisiones, cabinas, formularios sectoriales, depósitos y no-show.
- Field service, rutas, firma técnica y geolocalización.
- Marketplace, marketing avanzado y campañas.
- Pagos integrados.
- Nómina completa.
- Aplicación móvil nativa.
- Ecosistema de integraciones comparable con Odoo/Zoho.

### Cosas que no recomiendo copiar

- La fragmentación entre decenas de aplicaciones de Zoho.
- La complejidad de configuración de Odoo o ServiceTitan.
- Convertir cada automatización en una opción que el autónomo deba operar.
- Dependencia forzada del procesador de pagos o marketplace.
- Cobrar por funciones esenciales mediante una acumulación de complementos.

# POSICIÓN DEL PRODUCTO

**Producto inicial serio.**

La arquitectura, el modelo de datos, la facturación, inventario, agenda, proyectos, contabilidad, copias y DISA superan claramente un prototipo o MVP superficial.

No transmite todavía producto comercial maduro por cuatro motivos: seguridad no validada activamente, operación sobre un único servidor, deuda histórica considerable y UX menos pulida que los referentes.

Por áreas:

- Facturación/inventario: producto inicial avanzado.
- Arquitectura tenant: cercana a producto comercial.
- DISA: innovación prometedora en fase temprana.
- Operación/seguridad: pre-madurez comercial.
- Belleza y servicio de campo: todavía roadmap.

# LAS 10 COSAS QUE MÁS ME PREOCUPAN

1. DISA escribiendo y borrando mediante CRUD genérico.
2. Stock modificable fuera de su libro de movimientos.
3. Barrido nocturno automático activo y contradictorio.
4. Borrado global de conversaciones DISA sin CSRF.
5. SQL de DISA sin límite real de filas.
6. Recuperación incompleta y backups sin cifrado propio.
7. CSP permisiva en todo el ERP.
8. Arranque que tolera módulos esenciales ausentes.
9. Complejidad acumulada en archivos monolíticos y sistemas archivados.
10. Escalado lineal por tenant y conexiones nunca cerradas.

# LAS 10 COSAS QUE BAMBURU ESTÁ HACIENDO MEJOR

1. Base SQLite independiente por negocio.
2. Contexto tenant centralizado mediante `AsyncLocalStorage`.
3. Prohibición absoluta de datos clínicos en DISA.
4. Reutilización del motor de permisos entre interfaz y DISA.
5. Cadena comercial y contable conectada.
6. Verifactu diseñado con registros adicionales, huella y trazabilidad.
7. Backup con snapshot consistente, verificación remota y descarga de restauración.
8. Cookies, tokens aleatorios, 2FA y revocación de sesiones razonablemente diseñados.
9. Núcleo ERP capaz de funcionar aunque el proveedor IA falle.
10. Confirmación humana como principio explícito para acciones de DISA.

# QUÉ ARREGLARÍA PRIMERO

1. Resolver el barrido nocturno automático y la contradicción de autoridad.
2. Retirar CRUD genérico y escritura directa de stock de DISA.
3. Corregir `/clear`, aplicar CSRF y confirmaciones vinculadas a una acción concreta.
4. Sustituir SQL libre por herramientas/vistas acotadas y límites impuestos por servidor.
5. Completar y cifrar la estrategia de recuperación.
6. Endurecer CSP y revisar sistemáticamente XSS.
7. Hacer que los módulos obligatorios fallen al arrancar y añadir health checks.
8. Unificar política segura de adjuntos.
9. Resolver base huérfana, drift y retención de copias manuales.
10. Dividir progresivamente los grandes monolitos sin reabrir producto.
11. Sanear documentación activa contradictoria.
12. Diseñar conexiones y procesos tenant para 1.000+ negocios.

# COSAS QUE NO PUDE VERIFICAR

- Ningún flujo real en navegador.
- Ningún login, rol, IDOR o ataque CSRF/XSS activo.
- Aislamiento mediante dos sesiones reales de negocios diferentes.
- Correcto renderizado móvil, accesibilidad WCAG o funcionamiento de botones.
- Envío real a AEAT, Resend, Anthropic, Stripe o cualquier proveedor.
- Restauración completa en otro servidor.
- Integridad funcional completa de facturas, contabilidad, stock y citas.
- Carga, latencia, consumo de memoria o concurrencia.
- Bloqueos SQLite bajo tráfico.
- Limpieza real después de gates.
- Drift de columnas, índices y constraints entre todas las bases; solo comparé tablas y `quick_check`.
- `foreign_key_check` completo de cada tenant.
- Estado o vulnerabilidades publicadas de dependencias mediante `npm audit`.
- Secretos históricos eliminados de toda la historia Git.
- Contenido de logs de producción, para evitar exponer datos.
- Configuración y cifrado efectivo de la cuenta Google Drive/rclone.
- Existencia, permisos y copia de certificados Verifactu.
- Estado contractual y protección de datos de Anthropic, Resend y Google.
- Exactitud jurídica de RGPD, historia clínica y Verifactu: requiere profesional especializado.
- Conformidad oficial de Verifactu: los gates históricos no bastan.
- Entregabilidad y supresiones actuales de Resend.
- Comportamiento de DISA ante prompt injection real.
- Que todas las tareas marcadas HECHO cumplan su criterio en producción.

Todas estas cuestiones quedan como **“Necesita comprobación posterior — no ejecutada por restricción de solo lectura”**.

No modifiqué archivos, bases, servicios, configuración, Notion ni producción; no ejecuté gates, tests, barridos o regresiones. El repositorio terminó limpio según `git status --short`.
