> ⚠️ **HISTÓRICO — NO ES EL PLAN ACTUAL.**
> Roadmap viejo de 6 sprints. La fuente de verdad estratégica es **CANON.md**
> y el plan de trabajo activo es **TABLERO.md**. Este archivo se conserva como
> registro de lo hecho, no como guía de lo siguiente.
>
> **Último trabajo (registro, no plan) — 21 jul 2026:** escalera (CANON §4) con peldaños 1-6 cerrados y
> validados. **Peldaño 7 (servicios profesionales · 1er oficio) en curso:** PIEZA 1 (el proyecto: entidad
> + pantalla) y PIEZA 2 (registro de tiempo: cronómetro + manual, importe con la tarifa de la persona,
> vista semanal) validadas y cerradas; PIEZA 3 (facturar horas: horas facturables → factura REAL
> reutilizando el motor createInvoice; agrupa una línea por tarea+tarifa; "facturada" en vivo; anular
> libera) **entregada, pendiente de validación de Ibrahim** (test-facturar-horas 31/0, gate 21/0, grupo
> `servicios` 7/7, Ventas 973.267,93 € intacto). Detalle vivo en **TABLERO.md** y **session.json** — esta
> es solo la nota de "qué se hizo".

# TAREAS BAMBURU — Roadmap Estratégico

## 📊 VISIÓN

Bamburu = Sistema Operativo para empresas hispanohablantes.
- ERP completo (✅ hecho)
- DISA: Agente IA especializado (🔄 en desarrollo)
- Constructor Web: Tienda online sin código (📋 backlog)
- Telegram: ERP desde el móvil (📋 backlog)

---

## 💰 MODELO DE INGRESOS

### Stream 1: Suscripción DISA
- Starter: Gratuito (50 msgs/mes, ERP básico)
- Pro: €29/mes (500 msgs/mes + constructor web)
- Enterprise: Custom (API + soporte)

### Stream 2: Marketing de Afiliados
- Hosting (Vercel/Netlify): 20-25% comisión
- Dominio (Namecheap): 15%
- Email (SendGrid): 10%
- CRM (HubSpot): 20%
- Contabilidad (Sage): 15%

### Stream 3: Implementación Empresarial
- Consultoría: €150-300/hora
- Desarrollo custom: €3k-10k
- Integraciones legacy: €5k-20k
- Formación: €2k/jornada

### Stream 4: Marketplace (v2.0)
- Extensiones de terceros: 30% comisión

---

## 🎯 ROADMAP POR SPRINTS

### SPRINT 1 — COMPLETADO ✅
- [x] SEC-03: Rate limiter — priorizar X-Real-IP
- [x] SEC-04: Limpieza sesiones en control.db
- [x] SEC-05: Node escucha solo 127.0.0.1
- [x] SEC-06: Flag Secure en cookies
- [x] 2FA TOTP (Google Authenticator)
- [x] Recuperación de contraseña (Resend)
- [x] Permisos granulares por usuario (ACL)

### SPRINT 2 — COMPLETADO ✅ (2026-05-25)
- [x] Multi-agentes: DISA Admin, Ventas, Web, Finanzas
- [x] Selector de agente en UI
- [x] Instrucciones especializadas por agente
- [x] Sistema de permisos completo (backend + frontend + menú + modal)
- [x] DISA: chat in-place con artifacts (kpi_dashboard, action_list, big_number)
- [x] DISA: historial de conversaciones con threads
- [x] DISA: renombrar conversaciones (doble clic inline)
- [x] DISA: fijar conversaciones favoritas (pin con separadores Fijadas/Recientes)
- [x] Widget flotante DISA (movible, redimensionable, carga historial)
- [x] Chips de acceso rápido persistentes en BD (disa_quick_chips)
- [x] Iconos SVG en menú lateral
- [x] Git inicializado con .gitignore
- [x] Landing: GSAP parallax + 6 secciones nuevas (panel, permisos, países, facturación, tienda, Telegram)
- [x] Wiki /docs completa con enlace en landing y sidebar plataforma
- [x] Logs debug DISA eliminados

### SPRINT 3 (próximo) — DISA Vigilante + Constructor Web
- [ ] DISA Vigilante de Negocio (job cada hora, 7 reglas, alerts table, cards dinámicas)
- [ ] DISA Vigilante de Plataforma (logs, bugs, errores del sistema)
- [ ] Constructor Web MVP (arrastrar/soltar, plantillas, integración productos)
- [ ] Editor visual sin código + deploy automático

### SPRINT 4 — Telegram MVP
- [ ] Webhook POST /api/webhook/telegram
- [ ] Vinculación segura (UUID + expiración 15min)
- [ ] DISA por Telegram (readonly primero)
- [ ] OCR de facturas (v1.1)

### SPRINT 5 — Panel Administración
- [ ] admin-panel.bamburu.com
- [ ] Gestión de tenants, facturación, soporte

### SPRINT 6+ — Inteligencia Empresarial
- [ ] Dashboard predictivo
- [ ] Recomendaciones automáticas
- [ ] Workflow automation
- [ ] Marketplace de extensiones

---

## ✅ COMPLETADAS EN SESIONES ANTERIORES

### Infraestructura & Seguridad (Servidor)
- [x] Backup semanal Backblaze B2
- [x] DNS Cloudflare + wildcard *.bamburu.com
- [x] TLS automático certbot-dns-cloudflare
- [x] Usuario bamburu: sudo removido, grupo wheel removido
- [x] Permisos: data/ 750, *.db 640
- [x] Node.js bind 127.0.0.1 (no 0.0.0.0)

### Producto — ERP Core
- [x] Multi-país: ES (EUR, IVA 21%), MX (MXN, 16%), CO (COP, 19%)
- [x] Variantes de producto (2 ejes + stock independiente)
- [x] Conectadas a POS, Inventario, Pedidos
- [x] Facturación Verifactu (hash SHA-256 encadenado)
- [x] Número de seguimiento en pedidos
- [x] Proveedor por producto (supplier_id)
- [x] Descuentos, Clientes, Proveedores, Compras

### UX & Onboarding
- [x] Landing oscura con DISA protagonista
- [x] Botón "Acceso" → /admin/login
- [x] Formulario registro: conserva campos al fallar
- [x] Banner beta en panel
- [x] Feedback form integrado

### DISA (Completo al 2026-05-25)
- [x] Chat flotante en panel (widget movible + redimensionable)
- [x] Perfil del negocio (business_type, sector, goals)
- [x] Contexto dinámico (ventas, stock, clientes)
- [x] Sistema de acciones con confirmación
- [x] Contador mensajes/mes (50 plan gratuito)
- [x] Acciones de seguridad: check_2fa_status, disable_2fa_user, list_users_security
- [x] Chat in-place con artifacts (kpi_dashboard, action_list, big_number)
- [x] Historial de conversaciones con threads (crear, cargar, eliminar)
- [x] Renombrar conversaciones (doble clic inline)
- [x] Fijar conversaciones favoritas (pin, separadores Fijadas/Recientes)
- [x] Chips de acceso rápido persistentes (disa_quick_chips en BD)
- [x] Widget flotante carga historial del thread activo

---

## 🟡 BUGS CONOCIDOS

| Bug | Severity | Sprint | Status |
|-----|----------|--------|--------|
| DISA no lee contexto | 🔴 Crítico | 2 | ✅ Resuelto (era falso positivo) |
| CSP bloqueaba widget | 🟢 Resuelto | - | ✅ |
| Widget scope variables | 🟢 Resuelto | - | ✅ |
| Ghost thread tras borrar | 🟢 Resuelto | 2 | ✅ |
| Chips SyntaxError onclick | 🟢 Resuelto | 2 | ✅ |
| Módulo tienda | 🟡 Por verificar | 3 | ⏳ Pendiente revisión |

---

## 📋 DOCUMENTOS CLAVE

- BUGS_DISA.md — diagnóstico de bugs
- BUSINESS_MODEL.md — ingresos detallados
- STRATEGIC_PILLARS.md — arquitectura DISA + Web
