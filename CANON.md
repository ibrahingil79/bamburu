# CANON — Bamburu (v2: fase de LA ESCALERA)

> Estrategia e identidad del proyecto. El chat/orquestador decide y redacta los encargos; Codex actúa como programador/ejecutor técnico, mantiene el repo y commitea.

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

## 3-bis. Principios de diseño de producto (identidad — no se toca)

> **Leyes permanentes, no tareas.** Guían cada pantalla y cada función de aquí en adelante. Por eso
> viven aquí, con la identidad, y no dentro de la fase: no caducan con ella — **la fase de optimización
> ya terminó (§4-bis) y estas siguen mandando**, ahora sobre la escalera (§4). No se convierten en entradas del TABLERO — se aplican a
> todo lo que se construya, y cualquier tarea que las incumpla está mal planteada.

Referencia: los líderes del sector (Salesforce) priorizan **claridad > eficiencia > consistencia >
belleza**. Bamburu adopta ese estándar y añade la capa que ellos no tienen: **DISA hace el trabajo
por el dueño**. (Es el "cómo" de §1: de los líderes mundiales se copia la estructura, no solo se
mira a la competencia directa.)

- **Fricción mínima (regla de los 2-3 clics).** Toda acción frecuente se resuelve en el mínimo de
  pasos y campos posibles. Si una tarea común pide más de lo necesario, el diseño está roto: el
  usuario acaba metiendo datos basura o abandonando. Menos clics, menos campos obligatorios, menos
  pantallas.
- **Sencillez en la superficie, nunca en el producto.** Lo que se simplifica es la experiencia
  (pantalla limpia, pocos pasos), jamás el alcance. Un producto completo con superficie simple se
  consigue con DISA haciendo el trabajo, no quitando funciones. Prohibido recortar un selector, un
  campo o una opción "para que sea más simple".
  *Desarrolla §2 regla (4) — la simplicidad nace de que el dueño no necesita tocar las cosas, no de
  esconderlas — y cierra la segunda excusa de §3: aquel prohíbe recortar porque el cliente sea
  pequeño; este, recortar por estética. **No es "simplicidad primero" (§5), que va del CÓDIGO.**
  Código mínimo y producto completo no se contradicen: nunca se invoca el uno para justificar
  recortar el otro.*
- **DISA es asistente, no vigilante.** Las propuestas y avisos de DISA existen para servir al dueño,
  no para fiscalizarlo. El tono ayuda ("te conviene hacer X"), nunca reprende. Si una intervención
  de DISA suena a control o a regañina, está mal formulada.
- **El software trabaja, no el humano.** El estándar de cada función es que DISA la ejecute o la deje
  lista sola: leer un dato y crear el registro, preparar un documento, avisar de un problema antes de
  que ocurra. Introducir datos a mano es el último recurso, no el primero.
  *Es "el dueño no opera, decide" (§2) medido en cada función concreta: si para usarla hay que
  teclear, todavía no está terminada.*
- **Una sola verdad, siempre limpia.** Una única fuente de datos fiable en todo momento. DISA detecta
  y corrige duplicados, formatos rotos y datos obsoletos. El usuario nunca debería dudar de si un
  dato es el bueno.
- **Estándar, no Frankenstein.** Bamburu es un producto estándar y mantenible, no un traje a medida
  por cliente que genere dependencia de por vida. La adaptación al oficio se hace por diseño
  (interfaces por profesión, DISA), nunca personalizando el núcleo cliente a cliente.
- **Todo porcentaje dice su base.** Un número que no se puede comprobar es una mentira aunque esté
  bien calculado. Ningún porcentaje de margen —ni de nada que mida rentabilidad— se enseña sin decir
  **sobre qué se divide**, y donde haya dos formas legítimas de contarlo se enseñan **las dos** al
  abrir el detalle, con el importe en euros y con la parte que queda fuera por no tener coste
  conocido. **Sin coste conocido no hay margen: se dice «—», nunca 0 y nunca 100 %** — un 0 diría
  "no ganas nada" y un 100 "es todo beneficio", y las dos cosas serían inventadas.
  *Nace de un fallo publicado (19-ago-2026): la plataforma enseñaba "36,3 % de margen" a un cliente
  con 4.018 € de venta y 1.577 € de coste. Ninguna cuenta con esos dos números da 36,3, porque el
  divisor era un tercero —2.475 €, la parte de la venta con coste conocido— que no aparecía en
  ninguna pantalla. El dueño no podía llegar a esa cifra con lo que tenía delante.*
  *La CONTABILIDAD y la CUENTA DE RESULTADOS quedan fuera de cualquier preferencia del dueño: ahí
  manda siempre "sobre la venta", porque un resultado contable no cambia de definición por un gusto.
  Y esas pantallas lo dicen en voz alta.*
  *Extiende "una sola verdad, siempre limpia": un dato es el bueno cuando además se puede comprobar.*
- **Contacto no es visita.** Saber de un cliente y que el cliente venga son cosas distintas, y
  juntarlas rompe lo que más trabaja para el dueño. Un correo que manda Bamburu solo **no** dice que
  el cliente esté vivo: si contara, tres recordatorios automáticos harían parecer activo a quien
  lleva año y medio sin aparecer, y el detector de clientes que se enfrían dejaría de avisar justo
  de los que se están yendo. **Un aviso que no salta es peor que no tener aviso: nadie lo echa de
  menos.** Por eso «visita» es y seguirá siendo *pisó el negocio o compró* —cita atendida, factura,
  venta de mostrador, presencial apuntado a mano—, y todo lo demás se registra, se enseña y se
  distingue a simple vista, pero no cuenta.
  *De aquí sale también la honestidad sobre lo que Bamburu NO hace: WhatsApp no está conectado, así
  que se apunta a mano y la pantalla lo dice. Nunca se finge una integración que no existe.*
- **Lo que se marca solo no puede mentir.** Toda casilla, checklist o indicador de «esto ya está
  hecho» se **deriva del estado real** del negocio —hay NIF, hay horario, hay servicios con precio,
  la página de reservas está encendida—, **nunca de una bandera que alguien pulsa**. Una casilla que
  se marca a mano se marca por error, por prisa o por probar, y a partir de ese momento el panel deja
  de significar nada: dice «hecho» de algo que no está y el dueño no vuelve a mirarlo. Si un estado
  no se puede derivar, **el paso no se ofrece** hasta que se pueda.
  *Corolario: si un paso lleva a una pantalla, esa pantalla tiene que EXISTIR. Un enlace a un 404 en
  la primera pantalla que ve un dueño nuevo es peor que no ofrecer el paso.*
- **Las dos puertas.** Toda información de negocio tiene **dos puertas**: la **conversacional** (DISA)
  y la **visual** (panel / constructor de analíticas). **Ninguna sustituye a la otra** — quien prefiere
  preguntar, pregunta; quien prefiere ver, ve. **Los gráficos no son cerrados:** el usuario construye
  los suyos sobre sus propios datos, no elige entre los cuatro que alguien decidió por él. **Ambas
  puertas respetan los mismos permisos:** lo que un usuario no puede ver por una pantalla, tampoco
  puede sacarlo por un gráfico.
  *Cierra el hueco que dejaba §2 regla (3): DISA llega con la propuesta hecha, pero el dueño que quiere
  mirar sus números por su cuenta también es el dueño. "El software trabaja, no el humano" no significa
  "el humano no mira".*

## 4. Fase actual: SANEAMIENTO TÉCNICO (la escalera queda aplazada)

La auditoría integral de agosto de 2026 abre una fase de saneamiento antes de continuar el roadmap
funcional. **No se añaden más funciones nuevas hasta cerrarla.** Su finalidad es elevar seguridad,
robustez, calidad de código, coherencia operativa, recuperación, escalabilidad y mantenibilidad al
nivel de un producto profesional comparable con los líderes del mercado. Se trabaja **una tarea cada
vez**. Saneamientos 1 y 2 están cerrados; no hay una tarea posterior iniciada y el siguiente
saneamiento requiere encargo oficial. El Peldaño 9 — Belleza/estética sigue pendiente, pero queda aplazado y
no es la siguiente tarea mientras esta fase permanezca activa.

### La escalera — roadmap funcional aplazado

El orden ya no se decide módulo a módulo, ni por capas: es **UNA escalera numerada** donde cada peldaño
se apoya en el anterior. **No hay lista de "espera" ni capa aparte**: lo que no está hecho está en un
peldaño. Aquí vive el **ORDEN** (decisión del dueño, §6); el **detalle** de cada paso y la colocación de
cada módulo viven en `TABLERO.md`, que sigue siendo la fuente única de tareas (§5).

1. **Sincerar** — que los textos digan la verdad sobre lo que hay construido.
2. **Margen** — enchufar a la analítica el coste que **ya existe** (`products.average_cost` /
   `lastKnownCost`). No hay que inventar el dato: hay que usarlo.
3. **Informes por área** (ventas · compras · clientes) + **plan financiero** (objetivos vs. real), con
   los datos ya preparados.
4. **La puerta visual.** *(a)* **Constructor de analíticas** — catálogo de campos en cristiano (ventas,
   márgenes, clientes, compras, stock, caja…), el usuario elige cómo cruzarlos, elige el tipo de
   gráfico a su estilo y **guarda los suyos**. **Pantalla de panel propia.** *(b)* **Constructor
   avanzado** — cálculos propios, más tipos de gráfico, combinar fuentes, compartir paneles.
5. **DISA predictiva** — previsión de caja, detección de anomalías, agente que avisa. **Usa el motor
   del paso 4 para mostrar**: DISA analiza, no dibuja.
6. **Dashboards personalizables** — el usuario compone su Inicio con sus propios gráficos guardados.
7. **Servicios profesionales (1er oficio)** — agenda + control de tiempo facturable + rentabilidad por proyecto.
8. **Salud/bienestar (2º oficio)** — agenda presencial.
9. **Belleza/estética (3er oficio)** — agenda + caja del día.
10. **Proyectos / partes de horas / servicio de campo** (órdenes de trabajo).
11. **TPV / POS completo.**
12. **Cobro recurrente + domiciliación SEPA.**
13. **Telegram como canal de DISA.**
14. **Mapas (OpenStreetMap).**
15. **App móvil nativa.**
16. **API pública / webhooks.**
17. **Integraciones / marketplace.**
18. **Documentos / suite ofimática ligera.**
19. **Multiempresa · Multi-moneda · Fabricación · Firma digital · Helpdesk.**

**Por qué es una escalera y no una lista:** el margen (2) es el dato que alimenta los informes (3); los
informes fijan qué campos existen, que son el catálogo del constructor (4); el constructor es quien
dibuja, y por eso DISA predictiva (5) puede analizar sin construirse su propio dibujante; y solo cuando
el usuario tiene gráficos guardados (4) tiene sentido dejarle componer su Inicio (6). Los oficios (7-9)
van después porque un oficio sin números no es una cara, es un formulario.

La escalera conserva el orden funcional para cuando termine el saneamiento; no autoriza a iniciar
ningún peldaño durante la fase activa.

Decisión de mercado: cuándo sale Bamburu al mercado lo decide el dueño. El asistente y Codex no recomiendan el momento de lanzar ni lo usan como argumento; solo ejecutan lo que el dueño prioriza.

### 4-bis. Fase anterior: OPTIMIZACIÓN — ✅ CERRADA (A, B y C completos)

> Se conserva entera, no por historia: sus **reglas rectoras** definen qué significa "optimizado" y
> **se siguen aplicando a todo lo que se construya en la escalera**. Lo que caducó es su prioridad
> ("las funciones nuevas ceden al pulido"), porque el pulido terminó: los tres ejes están cerrados.

El objetivo de esta fase ya no es el orden de construcción, sino pulir lo construido. La plataforma es potente pero cruda. Se optimiza en tres ejes: UX, DISA y Seguridad. Las funciones nuevas ceden prioridad al pulido, salvo decisión expresa del dueño.

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
- Simplicidad primero: el código mínimo que resuelve el problema; sin abstracciones ni configurabilidad no pedida. **Es del CÓDIGO, no del producto**: nunca se usa para recortar una función, un campo ni una opción — eso lo prohíbe §3-bis.
- Cambios quirúrgicos: tocar solo lo pedido; aditivo, sin DROP; no tocar huella/Verifactu ni la lógica de documentos salvo autorización.
- Verificación definida siempre: cada tarea especifica su test/gate propio. Ejecutar esa comprobación o cualquier regresión requiere la autorización expresa que fija `RITUAL.md`; el criterio de HECHO no la autoriza por sí solo.
- Fuente única de tareas: TABLERO.md. Notion es solo panel.
- Legal/regulatorio: verificado contra fuente oficial, nunca de memoria.
- Un tema por chat.

## 6. Quién decide qué
- El dueño decide: negocio, producto, prioridades, precios, experiencia de usuario, y cuándo salir al mercado.
- El técnico (chat/orquestador + Codex) decide: base de datos, arquitectura, nombres, orden técnico de programar. Si una duda técnica tiene recomendación clara, se aplica sin preguntar y se explica en una frase simple.

## 7. Mapa de capas (nombra lo construido y el umbral — el orden lo manda §4)
- **Núcleo Operativo**: Pilares 1–4 (Catálogo, Cliente, Inventario, Ventas). **Construido.**
- **El Suelo**: Verifactu, motor contable propio, multiusuario con permisos. **Umbral de admisión al
  mercado.** Lo que aún le falta vive en el Backlog de `TABLERO.md`, no en la escalera.
- **No hay tercera capa.** Lo que se llamaba **"El Foso"** (DISA predictiva/agente, CRM, API, móvil,
  interfaces por profesión) **no era una capa: era una lista de espera sin orden**, y por eso llevaba
  meses sin que nada saliera de ella. Sus funciones **no se pierden**: están repartidas por dependencia
  técnica en los peldaños de **la escalera (§4)**, cada una con su número.

Este mapa **nombra**; no ordena. El orden es la escalera (§4) y la prioridad la decide el dueño (§6).
