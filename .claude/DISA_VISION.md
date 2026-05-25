# DISA — Visión Definitiva

## Filosofía

DISA NO es un chatbot. Es el CTO virtual de Bamburu.
- Vigila el negocio
- Vigila la plataforma
- Construye la web
- Ejecuta tareas

## 3 Cerebros

### Cerebro 1 — Vigilante del Negocio
Analiza el negocio cada hora y sugiere mejoras:
- Stock bajo
- Clientes inactivos > 30 días
- Productos sin descripción/imagen
- Margen < 10%
- Pedidos sin enviar > 3 días
- Reportes pendientes (fin de mes)
- Precios fuera de mercado

### Cerebro 2 — Vigilante de la Plataforma
Monitoriza el código y servidor:
- Lee logs (sudo journalctl)
- Detecta errores 500
- Identifica queries SQL lentas
- Detecta memory leaks
- Reporta bugs visibles (productos sin precio, etc.)
- SOLO REPORTA — no modifica código

### Cerebro 3 — Constructor Web
Construye la tienda del cliente:
- Plantillas predefinidas
- Generación conversacional ("Quiero tienda de velas")
- Auto-conexión con ERP (productos, categorías)
- SEO automático
- Optimización móvil
- Hosting partner (Vercel/Netlify)
- Dominio asistido
- A/B testing

## Estética (NO chatbot)

- Sidebar derecho permanente (no flotante)
- Cards de sugerencias con acciones
- Métricas en vivo
- Chat solo cuando es necesario
- Diseño ejecutivo, no conversacional

## Capacidades de Ejecución

DISA puede hacer TODO lo que un admin hace:
- Crear/editar productos, clientes, proveedores
- Aplicar descuentos
- Generar facturas
- Cambiar precios
- Enviar emails
- Etc.

### Niveles de confirmación:
- Reversible → sin confirmación
- Afecta datos → confirmación simple
- Masivo → doble confirmación

## Roadmap

- SPRINT 2A: Sidebar + estética
- SPRINT 2B: Vigilante de negocio (7 reglas)
- SPRINT 2C: Vigilante de plataforma
- SPRINT 2D: Ejecutor (catálogo acciones)
- SPRINT 3: Constructor web

## Restricción de Seguridad

DISA solo REPORTA bugs de código. NO modifica archivos
en producción. El admin (Ibrahin) aprueba y aplica fixes.
