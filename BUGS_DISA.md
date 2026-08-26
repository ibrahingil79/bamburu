# BUGS DISA — Diagnóstico & Estado

## BUG #1: DISA no leía datos de la BD — RESUELTO

**Síntoma original:**
- Usuario preguntaba: "¿Cuánto he vendido?"
- DISA respondía: "No tengo datos disponibles"
- Pero el dashboard mostraba €2229.23, 14 pedidos

**Causa raíz:**
- buildBusinessContext solo pasaba un resumen fijo y agregado
- Para consultas específicas fuera de ese resumen, el modelo no tenía datos
- Secundario: query topProducts usaba status='completado' en lugar de NOT IN (cancelado, reembolsado, borrador), dando 0 cuando había pedidos en_preparacion/enviado

**Solución aplicada (2026-05-22):**
1. Implementado tool_use con herramienta query_database
   - DISA puede ejecutar SELECT arbitrarios en tiempo real
   - Tablas de sistema protegidas (admin_users, admin_sessions, etc.)
   - Solo SELECTs permitidos
   - Máximo 4 llamadas por mensaje para evitar loops
2. Schema completo de BD inyectado en systemPrompt (via getDbSchema)
3. topProducts corregido a filtro consistente con ventas
4. Añadido topProductsAllTime (histórico) junto a topProductsMes

**Archivos modificados:**
- modules/disa/index.js — getDbSchema(), runQueryTool(), loop tool_use, systemPrompt

---

## BUG #2: DISA no podía gestionar todas las entidades — SOLUCIÓN HISTÓRICA RETIRADA

**Síntoma original:**
- "crear categoría" → "no puedo hacer eso"
- "crear etiqueta" → "no puedo hacer eso"
- Cualquier entidad sin case hardcodeado → respuesta de rechazo

**Causa raíz:**
- executeAction con cases individuales hardcodeados
- Cada entidad nueva requería añadir código manualmente

**Solución aplicada (2026-05-22):**
1. Tres operaciones genéricas en executeAction:
   - insert_record: inserta en cualquier tabla de WRITABLE_TABLES
   - update_record: actualiza por id en cualquier tabla permitida
   - delete_record: elimina por id con verificación de cambios
2. WRITABLE_TABLES whitelist cubre todas las entidades de negocio
3. Tablas de sistema excluidas del whitelist
4. systemPrompt actualizado con documentación de las tres operaciones
5. Schema dinámico permite al modelo conocer los campos exactos de cada tabla

**Archivos modificados:**
- modules/disa/index.js — WRITABLE_TABLES, insert_record, update_record, delete_record

**Estado vigente (Saneamiento 2, 2026-08-26):** esa solución genérica se retiró porque permitía
escribir tablas directamente y saltarse servicios e invariantes de negocio. DISA conserva solo
acciones dedicadas, con permisos y confirmación del servidor. Este bloque se mantiene como historia,
no como contrato activo.

---

## BUG #3: Widget flotante no enviaba mensajes — RESUELTO

**Síntoma original:**
- Botón de envío no respondía al click
- Sin errores visibles en consola

**Causa raíz (dos bugs simultáneos):**
1. `\n` dentro de template literal JS → browser recibía regex con newline literal → SyntaxError silencioso → IIFE completo nunca ejecutaba → sin listeners
2. msgs.insertBefore(wrap, typing) con #bam-disa-typing fuera de #bam-disa-msgs → NotFoundError

**Solución aplicada:**
1. `\\n` en lugar de `\n` dentro de template literals que emiten JS al browser
2. #bam-disa-typing movido al interior de #bam-disa-msgs en el HTML del widget

**Archivos modificados:**
- modules/disa/widget.js

---

## BUG #4: Auto-login tras onboarding no funcionaba — RESUELTO

**Síntoma original:**
- Tras completar /registro, el usuario llegaba al panel sin sesión activa

**Solución aplicada:**
- core/autologin-store.js: Map en memoria con TTL 10 min, limpieza cada 60s
- modules/registro/index.js: genera token tras provisionTenant, redirige a slug.bamburu.com/admin/autologin?token=
- modules/erp/routes/auth.js: GET /admin/autologin valida token, crea sesión, setea cookie, redirige a /admin

---

## BUG #5: Analytics mostraba cifras incorrectas — RESUELTO

**Síntoma original:**
- Analytics mostraba todos los pedidos incluyendo cancelados y reembolsados

**Causa raíz:**
- Filtros usaban NOT IN ('cancelled','refunded','draft') en inglés
- Los status en la BD están en español → el filtro nunca excluía nada

**Solución aplicada:**
- Corregido a NOT IN ('cancelado','reembolsado','borrador') en analytics.js y disa/index.js

---

## Console.logs de debug en widget — RESUELTO (Saneamiento 2, 2026-08-26)

**Estado:** Cerrado. Se retiraron los valores y objetos de error completos de los logs de DISA; los
mensajes operativos restantes no incluyen prompts, parámetros, SQL, PII ni secretos.

Los logs añadidos durante el debugging siguen en widget.js:
- [DISA Widget] Script cargado
- [DISA Widget] Elementos:
- [DISA] Send clicked
- [DISA] Key pressed:
- [DISA] send() ejecutado
- [DISA] Fetch error:

Y en index.js buildBusinessContext:
- [DISA] Usando BD:
- [DISA] Productos encontrados:
- [DISA] Pedidos completados:

La lista anterior se conserva como diagnóstico histórico.
