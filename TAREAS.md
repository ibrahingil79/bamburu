
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
- [ ] Rediseño: Bamburu como SO (no ERP intimidante) → SPRINT 2

### SPRINT 2 (próximas 2 semanas) — DISA Especializada
- [x] ~~Debuggear DISA context~~ → bug no existe, DISA funciona correctamente ✅
- [x] Multi-agentes: DISA Admin, Ventas, Web, Finanzas
- [x] Selector de agente en UI
- [x] Instrucciones especializadas por agente
- [ ] Acciones específicas por agente (20+)
- [ ] Onboarding DISA → auto-login
- [ ] Rediseño UX: Bamburu como SO (trasladado de Sprint 1)

### SPRINT 3 (2 semanas) — Constructor Web
- [ ] MVP constructor web (arrastrar/soltar)
- [ ] Plantillas predefinidas
- [ ] Integración productos desde ERP
- [ ] Editor visual sin código
- [ ] Integración hosting partner (Vercel/Netlify)
- [ ] Deploy automático + DNS
- [ ] Modelo de referido configurado

### SPRINT 4 (1 semana) — Telegram MVP
- [ ] Webhook POST /api/webhook/telegram
- [ ] Vinculación segura (UUID + expiración 15min)
- [ ] DISA por Telegram (readonly primero)
- [ ] OCR de facturas (v1.1)

### SPRINT 5+ — Inteligencia Empresarial
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

### DISA (Básico)
- [x] Chat flotante en panel
- [x] Perfil del negocio (business_type, sector, goals)
- [x] Contexto dinámico (ventas, stock, clientes)
- [x] Sistema de acciones con confirmación
- [x] Contador mensajes/mes (50 plan gratuito)
- [x] Login/register sin errores en consola
- [x] Acciones de seguridad: check_2fa_status, disable_2fa_user, list_users_security

---

## 🔴 PENDIENTES CRÍTICOS — SPRINT 1

### Seguridad (Código) ✅ COMPLETADO
- [x] SEC-03: core/rate-limit.js — X-Real-IP priority
- [x] SEC-04: index.js — cleanupControlSessions interval
- [x] SEC-05: index.js — hostname 127.0.0.1
- [x] SEC-06: auth.js + store/routes.js — Secure flag

### 2FA & Recuperación ✅ COMPLETADO
- [x] 2FA TOTP (tabla admin_users + totp_secret, totp_enabled)
- [x] QR code generator en setup (`qrcode` + `core/totp.js` custom)
- [x] Recuperación contraseña (email link con token vía Resend)
- [x] Token expiración 1 hora (`password_reset_tokens`)
- [x] Página unificada `/admin/security` (contraseña + 2FA) para todos los roles
- [x] DISA: acciones check_2fa_status, disable_2fa_user, list_users_security
- [x] Nudge 2FA tras cambio de contraseña forzado (→ `/admin/security?tab=2fa`)

### Roles & Permisos ✅ COMPLETADO
- [x] Tablas: `permissions`, `roles`, `role_permissions`, `user_permissions`, `user_roles`
- [x] 16 permisos predefinidos (products, orders, clients, invoices, admin)
- [x] Middleware `checkPermission(db, session, module, action)` en `core/permission-check.js`
- [x] UI: asignación de permisos individuales por usuario (píldoras por módulo, Todos/Ninguno)
- [x] API: `GET/POST /api/erp/users/:id/permissions`

### UX & Rediseño
- [ ] Dashboard menos abrumador
- [ ] DISA primero en entrada
- [ ] Menú lateral: solo opciones según permisos
- [ ] Colores/iconos alineados con landing

---

## 🟡 BUGS CONOCIDOS

| Bug | Severity | Sprint | Status |
|-----|----------|--------|--------|
| DISA no lee contexto | 🔴 Crítico | 2 | ✅ Resuelto (era falso positivo — funciona correctamente) |
| CSP bloqueaba widget | 🟢 Resuelto | - | ✅ |
| Widget scope variables | 🟢 Resuelto | - | ✅ |

---

## 📋 DOCUMENTOS CLAVE

- BUGS_DISA.md — diagnóstico de bugs
- BUSINESS_MODEL.md — ingresos detallados
- STRATEGIC_PILLARS.md — arquitectura DISA + Web
