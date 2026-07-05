# CANON — Bamburu (v2: fase de optimización)

> Estrategia e identidad del proyecto. La mantiene Claude Code en el servidor y GitHub. El chat decide y redacta; Code ejecuta y commitea.

## 1. Qué es Bamburu (identidad — no se toca)
Software de gestión de primer nivel a un precio que el autónomo sí puede pagar. Bamburu no es "software para pequeños": es software de clase mundial al alcance del autónomo. Los negocios pequeños no son negocios simples; si un autónomo no usa hoy ciertas funciones es porque no podía pagar el software que las tenía — Bamburu rompe eso.
Referencias: las mejoras estructurales se copian de los líderes mundiales (Salesforce, SAP, Odoo, Sage), no solo de la competencia directa (Holded, Quipu).

## 2. DISA (identidad — no se toca)
DISA no es una función: es la inversión que hace a Bamburu disruptivo. Principio: "El dueño no opera, decide."
Cinco reglas: (1) DISA puede operar cualquier función. (2) Las funciones existen para que DISA las use. (3) DISA siempre llega con una propuesta ya preparada, nunca con un formulario en blanco. (4) La simplicidad nace de que el dueño no necesita tocar las cosas, no de esconderlas. (5) DISA prepara y propone; el humano siempre valida las acciones con consecuencias.

## 3. Regla de alcance (no se toca)
Nunca se omite, simplifica ni recorta una función porque el cliente sea pequeño o autónomo. Si algo no encaja ahora es cuestión de orden/tiempo, jamás de capacidad.
Prohibido: desanimar al dueño o enmarcar una idea como "demasiado grande para ti". Si algo no toca ahora, se dice como orden/tiempo, nunca como límite.
Antes de aplazar, recortar o descartar algo, comprueba: ¿mi razón se apoya en que el cliente es pequeño? Si sí, la razón está mal. Rehazla.

## 4. Fase actual: OPTIMIZACIÓN
El objetivo de esta fase ya no es el orden de construcción, sino pulir lo construido. La plataforma es potente pero cruda. Se optimiza en tres ejes: UX, DISA y Seguridad. Las funciones nuevas ceden prioridad al pulido, salvo decisión expresa del dueño.
Decisión de mercado: cuándo sale Bamburu al mercado lo decide el dueño. El asistente y Code no recomiendan el momento de lanzar ni lo usan como argumento; solo ejecutan lo que el dueño prioriza.

### Eje A — UX
Regla rectora: cada pantalla y flujo debe acercar el "el dueño no opera, decide". Menos clics, menos formularios en blanco, más propuestas listas.
Optimizado cuando: hay un sistema visual coherente (tipografía, espaciado, componentes, color); todas las pantallas tienen estados vacíos y de carga cuidados; los mensajes de error son claros y accionables; los flujos clave están medidos en clics y reducidos; funciona bien en móvil; hay onboarding que lleva al dueño al primer valor sin fricción.

### Eje B — DISA
Regla rectora: DISA llega con el trabajo hecho y una decisión que pedir.
Optimizado cuando: DISA cubre de verdad operar cada función; sus propuestas son correctas y bien argumentadas; es proactiva; respeta permisos; su tono es el de Bamburu; responde con latencia razonable y buen contexto.

### Eje C — Seguridad
Regla rectora: el dato del autónomo es sagrado y aislado.
Optimizado cuando: el aislamiento multi-tenant está auditado sin fugas; no hay huecos de permisos ni por URL; sesiones y tokens (incluidos los enlaces del portal) son seguros y caducan; las entradas se validan; los secretos (certificados/claves) se gestionan fuera del código; hay límites de peticiones, registro de auditoría y respaldos automáticos de la BD de cada tenant.

## 5. Reglas de trabajo
- Simplicidad primero: el código mínimo que resuelve el problema; sin abstracciones ni configurabilidad no pedida.
- Cambios quirúrgicos: tocar solo lo pedido; aditivo, sin DROP; no tocar huella/Verifactu ni la lógica de documentos salvo autorización.
- Verificación siempre: cada tarea con test/gate propio y cierre con regresión 0.
- Fuente única de tareas: TABLERO.md. Notion es solo panel.
- Legal/regulatorio: verificado contra fuente oficial, nunca de memoria.
- Un tema por chat.

## 6. Quién decide qué
- El dueño decide: negocio, producto, prioridades, precios, experiencia de usuario, y cuándo salir al mercado.
- El técnico (chat + Code) decide: base de datos, arquitectura, nombres, orden técnico de programar. Si una duda técnica tiene recomendación clara, se aplica sin preguntar y se explica en una frase simple.

## 7. Mapa de capas (referencia, no mandato de orden)
- Núcleo Operativo: Pilares 1–4 (Catálogo, Cliente, Inventario, Ventas).
- El Suelo: Verifactu, motor contable propio, multiusuario con permisos.
- El Foso: DISA como producto predictivo/agente, CRM, API, móvil, interfaces por profesión.
En la fase actual, este mapa es referencia; la prioridad la marca la optimización (§4) y lo que el dueño decida.
