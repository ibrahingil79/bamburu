# Arquitectura — Bamburu

> Fuente de verdad: el repo. Si esto se desvía del código, manda el código.

## Stack
- **Runtime:** Node.js v22, ESM (`"type": "module"`). Sin build, sin bundler, sin framework de front.
- **Web:** Hono 4 + `@hono/node-server` (incluye `serveStatic`).
- **BD:** SQLite vía `better-sqlite3` (**síncrono** — nunca `await` en queries).
- **Dependencias:** `bcrypt` (passwords), `otplib` (2FA TOTP), `qrcode` (QR Verifactu), `resend` (email), `zod` (validación). Dev: `puppeteer` 25 (verificación headless).
- **Front:** HTML + JS en línea servido desde las rutas (sin SPA).

## Multi-tenant (aislamiento por archivo)
- **`data/control.db`** — enrutado de tenants + sesiones de superadmin + topes de plataforma + log de errores.
- **`data/tenants/<slug>.db`** — una BD por negocio; **toda la lógica de negocio y `admin_users` viven aquí**, no en control.db.
- Resolución de tenant por **subdominio** (`<slug>.bamburu.com`) o cookie `btenant` (dev/login). `core/tenant-middleware.js` resuelve la BD y aplica `readOnlyGuard` según el estado del negocio.
- **UNA sola conexión de escritura por BD.** Las conexiones viven en la caché de `core/tenant-middleware.js` (`getTenantDb`, un `Map` slug → `Database`). **Toda escritura pasa por ahí**, incluidas las del superadmin: abrir una segunda conexión de escritura al mismo fichero SQLite las serializa entre sí, y una escritura atascada deja al negocio esperando (`busy_timeout` 5 s). Leer sí se puede con conexiones propias en `readonly: true` — un lector no compite por el bloqueo de escritura. Gate: `verify-superadmin-escrituras.mjs`.
- **WAL:** todas las conexiones de la app se abren con `journal_mode = WAL` y **`journal_size_limit = 4 MiB`** (`WAL_SIZE_LIMIT`, en `core/control-db.js`). Sin ese tope, el fichero `-wal` **nunca se encoge**: se reutiliza en el sitio y se queda para siempre en su marca máxima. Con él, se devuelve al disco. Ojo: **`journal_size_limit` es POR CONEXIÓN, no se guarda en el fichero** — abrir la BD con la consola `sqlite3` enseña `-1`, y eso es normal. Gate: `verify-wal-acotado.mjs`.

## Mapa de carpetas
- **`index.js`** — arranque: middlewares globales (security headers, rate limit), landing pública, monta módulos vía `core/loader.js` (orden: `erp` → `store` → `disa`). Cada módulo exporta `register(app, db)`.
- **`core/`** — infraestructura transversal: `auth.js`, `csrf.js`, `validate.js`, `totp.js`, `mailer.js` (Resend), `llm.js` (transporte único a Claude + topes), `pdf.js` (Chromium compartido), `vat-bands.js` (bandas IVA legales, hoy solo ES), `tenant-middleware.js`, `control-db.js`, `db.js`, `loader.js`, `security-headers.js`, `rate-limit.js`, `tenant-provisioning.js` / `tenant-signup.js` / `signup-schema.js`, `escape.js`.
- **`modules/erp/`** — el panel `/admin`. Motores en la raíz (`cobros.js`, `pagos.js`, `stock.js`, `verifactu.js`, `avisos.js`, `codes.js`, `attachments.js`, `schemas.js`, `models.js`, `ventas-metrics.js`, `layout.js`); endpoints en **`routes/`**; vistas/componentes en **`views/`**.
- **`modules/disa/`** — la IA (`index.js` con tool_use + contexto de negocio; `widget.js` flotante).
- **`modules/registro/`** — alta/onboarding de tenants.
- **`modules/superadmin/`** — panel del dueño en el apex (`/superadmin`), 7 zonas. Lee las `.db` de los negocios en **solo lectura**, con **una excepción**: el **tope de IA** (`setTenantAiCap`) escribe en `platform_limits` de la `.db` del negocio. Esa escritura va por la **conexión cacheada de `tenant-middleware`** (`getTenantDb`), la misma que usa el panel de ese negocio — nunca por una conexión propia, que se serializaría contra la del negocio y podría dejarlo esperando. Suspender/reactivar un negocio escribe en `control.db`, no en su `.db`.
- **`modules/store/`** — tienda pública. **Congelada (Capa 2), no se trabaja.**
- **`scripts/`** — tests, gates y verificadores (ver convenciones.md).
- **`public/`** — estáticos. **`docs/`** — documentación (incluye este `docs/contexto/`).

## Flujo de datos (núcleo)
- **Ciclo de producto:** comprar → almacenar → vender → entregar. El producto es la raíz; su **tipo** (físico / servicio / digital) decide qué parte del ciclo aplica.
- **Stock = libro append-only:** `stock_movements` (delta con signo, inmutable); `products.stock` es **caché derivada** (= suma del libro). Solo físicos llevan kardex. Multi-almacén en datos (`warehouse_id`).
- **Cadena de ventas (nueva):** presupuesto → pedido (`customer_orders`, reserva stock) → albarán (`delivery_notes`, salida real) → factura (`invoices`). Mostrador emite factura simplificada (F2); sustitutiva = F3.
- **Factura:** inmutable; se anula o rectifica con asientos nuevos enlazados a la cadena de hash Verifactu.
- **Cobro:** estado calculado en vivo (`cobros.js`) desde `invoice_payments` + `due_date`; nunca se guarda.

## Infraestructura (producción, desde 2026-06-19)
- **systemd `bamburu.service`** (`User=ubuntu`, `WorkingDirectory=/home/ubuntu/bamburu`, lee `/etc/bamburu.env`).
- **Caddy** proxy inverso → HTTPS con comodín Let's Encrypt `*.bamburu.com` (DNS-01, **Cloudflare**). iptables 80/443.
- **Backup** diario rclone → Google Drive (verificado + prueba de restore + heartbeat). Timers systemd.
- Secretos en `/etc/bamburu.env` (Anthropic, Resend, Notion, `PUBLIC_BASE_DOMAIN`, `HEALTHCHECKS_URL`). `NODE_ENV` sin definir a propósito (DISA sin tope en beta).

## Qué NO existe (todo comprometido, sin construir)
Contabilidad (asientos, conciliación, modelos 303/130…, libros); **envío Verifactu a la AEAT** (hoy solo hash + QR + leyenda); Facturae B2B, SII, TicketBAI; facturación recurrente; pasarela de cobro online; plantillas de documento; CRM (embudo, agenda, portal); RRHH (nóminas, fichaje); proyectos/partes de horas; app móvil; API pública/webhooks; multiempresa; fabricación; stock mínimo/punto de pedido; trazabilidad lote/serie; sync e-commerce; códigos de barras; fiscalidad LATAM (vía proveedor externo). `modules/store/` existe pero está congelado.
