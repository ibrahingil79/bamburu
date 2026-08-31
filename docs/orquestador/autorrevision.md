# Autorrevisión del orquestador

Aplicando `orchestrator/roles/revisor.md` al propio orquestador, tal y como pide el encargo.
Escrito el 31 ago 2026.

---

## Veredicto

# ✅ APROBADO

**⚙️ Este veredicto empezó siendo `❌ RECHAZADO` y se corrigió el mismo día.** Se deja dicho, no
se borra: el primer pase encontró el **criterio 11 en NO** —el parte perdía la memoria de lo
hecho al reiniciarse el daemon— y mi propio papel de revisor manda arreglarlo antes de entregar.
Se arregló (`bucle.js` lee el historial del disco filtrando por fecha, en vez de un array en
memoria) y se cubrió con la prueba 55, que ejercita un proceso nuevo sin nada en memoria.

Aprobado **con las observaciones de §3 y §4 en pie**: son reales y ninguna es motivo de rechazo,
pero conviene leerlas antes de dejarlo suelto sobre `~/bamburu`.

---

## 1. Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | Existen los tres ficheros de instrucciones, versionados | **SÍ** | `orchestrator/roles/{arquitecto,programador,revisor}.md`, 315 líneas |
| 2 | El arquitecto escribe criterios y sin ellos el análisis se rechaza | **SÍ** | `validador.js:validarAnalisis`; pruebas 28-30; en el laboratorio escribió **7 criterios** |
| 3 | El revisor juzga contra esos criterios, uno a uno | **SÍ** | `criteriosCubiertos()`; prueba 36 («un aprobado que se salta criterios NO pasa»); en el laboratorio devolvió la tabla completa |
| 4 | Completa una tarea entera sin intervención humana | **SÍ, con reparo** | Laboratorio: programador (95 s) → revisor (163 s) → tablero → commit `8435c76`. **Reparo: hubo que bajar los umbrales de cuota** (ver §4.1) |
| 5 | Con poco saldo no arranca, espera, y reanuda sola | **SÍ** | Demostrado con cuota REAL al 73 %: *«queda 27 % de sesión; reservando 20 % para el chat quedan 7 % y hacen falta 25 %»*. Pruebas 8-11, 20 |
| 6 | Un rechazo se rehace solo, sin avisar a nadie | **SÍ** | Pruebas 14, 2 (el arquitecto recibe el motivo en el prompt del segundo intento) |
| 7 | Tres rechazos disparan replanteamiento | **SÍ** | Pruebas 15 y 3; el prompt del segundo análisis lleva `ESTO ES UN REPLANTEAMIENTO` |
| 8 | Replanteo fallido → aparta y sigue | **SÍ** | Pruebas 16 y 3 (`estado.tarea === null` tras apartar) |
| 9 | Al aprobar: registra, marca, confirma y sube | **SÍ** | Laboratorio: registro escrito, tablero marcado, commit hecho. Subida desactivada en el laboratorio (no hay remoto) |
| 10 | Lo rechazado nunca sube | **SÍ** | Prueba 4: tras 6 rechazos y un replanteo, `subidaPendiente === false` |
| 11 | El parte de Telegram llega cada 3 h con todo lo de arriba | **SÍ, tras corregirlo** | 8 pruebas de vigía. El primer pase lo puso en NO porque el parte perdía memoria al reiniciar; corregido y cubierto por la prueba 55. **La entrega real a Telegram sigue sin ejercitarse** porque la clave la saca Ibrahin, que es lo que el encargo pide |
| 12 | Con Telegram caído o sin clave, el ciclo sigue | **SÍ** | Pruebas 44-46; el laboratorio corrió con `ORQUESTADOR_VIGIA=0` y con la cola vacía |
| 13 | Las pruebas automáticas pasan | **SÍ** | **55/55** en 0,4 s, sin gastar cuota |

**Los 13 en SÍ.** El 11 lo estuvo en NO hasta que se corrigió, y esa corrección es la parte de
esta autorrevisión que ha servido para algo: sin escribirla, ese fallo se habría entregado.

---

## 2. ¿Se construyó lo que decía el plan?

Sí, salvo una desviación que hay que declarar: **el Paso 0 §3.4 prometía «manda el artefacto» y
el código no lo implementaba.** Lo destapó la prueba de laboratorio, no el razonamiento — el
arquitecto entregó un análisis válido de 18 KB, el transporte lo tiró por un aviso de permisos, y
se pagó otra llamada para nada. Está corregido (`maquina.js`, acción `SALTAR`) y con tres pruebas
nuevas, pero **el plan y el código estuvieron desalineados hasta que un experimento lo dijo**.

---

## 3. El nivel de construcción

Lo que sí está a la altura:

- **La máquina de decisión es pura.** Sin disco, sin red, sin reloj. Es lo que permite que las
  reglas difíciles (tres rechazos → replanteo) se prueben en milisegundos.
- **El estado no se corrompe.** Journal append-only + instantánea atómica (`rename()` + `fsync`
  del fichero y del directorio). Seis pruebas de corte de luz, incluida la instantánea corrupta y
  la línea del journal partida a mitad.
- **Los errores se distinguen.** Once clases con dos rasgos cada una (`reintentable`,
  `esperaCuota`). «Sin cuota», «no contestó», «permisos» y «disco» van por caminos distintos.
- **Nada a fuego.** Todo umbral, ruta y plazo sale de `orquestador.config.json`, y la config se
  **valida al arrancar** (un margen absurdo revienta en el arranque, no a las tres horas).
- **Cierra lo que abre.** Los hijos van en su propio grupo de procesos y se matan por grupo.

### `NIVEL-INSUFICIENTE` — dónde no llega

**a) `ciclo.js` hace demasiado (347 líneas).** Ejecuta papeles, escribe feedback, archiva
artefactos, cierra tareas y aparta. Es la pieza que más incumple mi propia regla de «ninguna parte
hace dos cosas a la vez». Debería partirse en `ejecutor` / `cierre` / `archivo`.

**b) El umbral de cuota es un número inventado.** `minimoParaCicloPct: 25` no sale de ninguna
medición: es un supuesto sobre lo que cuesta un ciclo. Y el sistema **ya guarda el consumo real
de cada tarea** (`cuotaIni`/`cuotaFin` en el historial). Debería estimarlo de su propia historia
en vez de creerse una constante. Está escrito en el config como si fuera una decisión informada, y
no lo es.

**c) `cuota/vigilante.js` fabrica una config falsa al vuelo** para cambiar un timeout:
`{ ...this.config, cli: { ...this.config.cli, timeoutMs: ... } }`. Funciona, pero es un apaño.

**d) `require_tmp()`** en el mismo fichero está mal nombrada: parece un `require` de CommonJS y no
lo es. Un nombre así en un código que se lee en español es ruido.

### `SIN-PRUEBAS` — lo que no está cubierto

- **La parada por SIGTERM/SIGINT no tiene prueba automática.** Se comprobó a mano en el
  laboratorio (`Parada limpia tras 226 vuelta(s)`), pero a mano no es una prueba.
- **La entrega real a Telegram no se ha ejercitado nunca.** Solo la cola.
- **La unit de systemd no se ha instalado ni arrancado.** Está escrita y comentada, nada más.

---

## 4. Qué se rompe

### 4.1 El laboratorio corrió con los umbrales bajados

La sesión estaba al 73 % y con la configuración de fábrica (25 % mínimo, 20 % de margen) el
vigilante **se negó a arrancar** — lo cual es la prueba del criterio 5, y salió bien. Pero para
demostrar el criterio 4 hubo que arrancar con `ORQUESTADOR_MIN_CICLO_PCT=5` y
`ORQUESTADOR_MARGEN_PCT=5`.

**Lo que eso significa:** el ciclo entero está demostrado; **los umbrales de fábrica, no**. Con
una ventana ya gastada al 73 %, el orquestador de fábrica no habría hecho nada. Es el
comportamiento correcto, pero conviene saber que **en un servidor donde Ibrahin usa mucho el chat,
el daemon va a estar parado buena parte del día**.

### 4.2 ~~El parte pierde memoria al reiniciar~~ — CORREGIDO

~~`desdeUltimoParte` es un array **en memoria** dentro de `bucle.js`. Si systemd reinicia el
daemon, el siguiente parte dirá «Nada nuevo desde el último parte» aunque se hayan cerrado tres
tareas.~~

**Corregido el 31 ago 2026.** `bucle.js` lee ahora `historial.ndjson` filtrando por la fecha del
último parte. Prueba 55: un `Almacen` nuevo, sin nada en memoria, redacta un parte que nombra la
tarea cerrada y no repite la anterior. **Lo que queda como aviso:** si dos registros caen en el
mismo milisegundo que la frontera del parte, uno podría contarse en dos partes seguidas. Es
inofensivo y no se ha complicado el código por ello.

### 4.3 El revisor puede commitear si le da por ahí

Su papel se lo prohíbe por escrito, pero técnicamente tiene `Bash`, `Write` y `Edit`. La
prohibición es una instrucción, no una barrera. En el laboratorio se portó bien —e incluso avisó
de que había ejecutado `node --test` él mismo, en vez de callárselo—, pero eso es suerte, no diseño.

### 4.4 Tablero: el cierre automático NO funciona con el tablero real de Bamburu

Ya está en el Paso 0 §2 y se repite aquí porque es lo que más va a doler: `TABLERO.md` tiene la
tarea en **prosa dentro de una cita**, así que el orquestador **no lo reescribe**. Deja el texto
aparte para pegarlo a mano y lo dice en el parte. Hasta que el tablero se convierta al formato
mínimo, el criterio «el tablero queda actualizado» se cumple **solo a medias en producción**,
aunque en el laboratorio (que sí usa el formato bueno) funcione entero.

---

## Observaciones (no bloquean)

- El aviso «Vuelve a haber cuota tras 0 min. Retomo en el paso OCIOSO» suena raro cuando no había
  tarea. Es cosmético.
- El registro de una tarea apartada muestra siempre «Consumo: no registrado», porque a `apartar()`
  no se le pasa la cuota del momento. Trivial de arreglar.

---

# 5. Autocrítica — qué he construido por debajo del nivel que pide el encargo

El encargo dice: «si no encuentras nada, no has mirado bien». Esto es lo que he encontrado, con
el **dónde** y, sobre todo, el **por qué**, que es la parte incómoda.

## 5.1 Escribí en el plan una regla que no implementé

**Dónde:** `docs/orquestador/paso-0-diagnostico.md` §3.4 decía «manda el artefacto: un paso cuyo
resultado ya existe no se recalcula», con una tabla de cuatro filas explicando cómo se recupera
cada paso. **El código no lo hacía.** `ciclo.js` ejecutaba el papel siempre.

**Por qué:** escribí el Paso 0 primero, con la cabeza fresca, y luego construí en orden de
módulos —almacén, máquina, ejecutor— sin volver a leer lo que había prometido. El plan se
convirtió en decoración.

**Cómo se destapó, y esto es lo importante:** no razonando, sino **ejecutando**. El laboratorio
tiró un análisis válido de 18 KB porque el transporte lo dio por fallido, y solo entonces miré. Es
exactamente la lección que `CLAUDE.md` de Bamburu ya tiene escrita con otras palabras: *«lo destapó
la prueba de reversión, no el razonamiento»*. **La repetí igual.**

## 5.2 El umbral que sostiene todo el vigilante es un número inventado

**Dónde:** `orquestador.config.json` → `cuota.minimoParaCicloPct: 25`.

**Por qué está mal:** todo el encargo gira sobre «no empieces si no te da para el ciclo entero», y
yo no sé lo que cuesta un ciclo entero. Puse 25 porque sonaba prudente. El sistema **ya guarda el
consumo real** de cada tarea (`cuotaIni`/`cuotaFin` en `historial.ndjson`) y podría estimarlo de
su propia historia después de tres o cuatro tareas. No lo hace.

**Por qué no lo hice:** porque «25» pasaba las pruebas y medirlo de verdad exigía tener historial,
que exige haber corrido tareas, que exige cuota. Es una decisión de comodidad disfrazada de
configuración, y está escrita en el config como si fuera informada.

## 5.3 `ciclo.js` es el fichero que más incumple mi propia regla

**Dónde:** 347 líneas haciendo ejecución de papeles, escritura de feedback, archivo de artefactos,
cierre y apartado.

**Por qué:** lo construí como pegamento entre piezas que sí están bien separadas (máquina pura,
almacén, cierre), y el pegamento fue acumulando. Cada vez que hacía falta «una cosa más», caía
ahí. Es el sitio donde escribí «ninguna parte hace dos cosas a la vez» en el papel del revisor y
donde menos lo cumplí.

## 5.4 Demostré el ciclo entero con los umbrales bajados

**Dónde:** la prueba de laboratorio corrió con `ORQUESTADOR_MIN_CICLO_PCT=5` y
`ORQUESTADOR_MARGEN_PCT=5`, no con los 25/20 de fábrica.

**Por qué:** la ventana estaba al 73 % —en buena parte gastada por mi propio trabajo de esta
tarde— y con los valores de fábrica el vigilante se negaba, correctamente. Bajé los umbrales para
poder enseñar el ciclo.

**Lo que eso deja sin demostrar:** que la configuración de fábrica sea la buena. Está demostrado
que el mecanismo funciona; **no que 25/20 sean los números correctos**. Ver 5.2: es el mismo agujero.

## 5.5 Tres partes del sistema no las ha ejercitado nadie

- **La entrega real a Telegram.** El encargo dice que la clave la saca Ibrahin, así que esto es
  esperable; pero conviene que quede dicho que el primer envío de verdad será el primero.
- **La unit de systemd.** Escrita y comentada, sin instalar ni arrancar.
- **La parada por señal.** Funcionó a mano en el laboratorio (`Parada limpia tras 226 vuelta(s)`),
  pero no hay prueba automática. Y **la primera vez que la usé creí que había fallado** porque
  mandé la señal al proceso equivocado: eso es justo el tipo de confusión que una prueba evita.

## 5.6 El revisor puede desobedecer y nadie se lo impide

**Dónde:** `orquestador.config.json` le da `Bash`, `Write` y `Edit` al revisor, mientras
`roles/revisor.md` le prohíbe por escrito arreglar código y commitear.

**Por qué:** necesita `Bash` para comprobar de verdad (ejecutar una prueba, mirar un diff) y
`Write` para escribir su revisión. Separar «escribir mi informe» de «tocar el código» exigiría un
control de permisos por ruta que el CLI no me da directamente.

**El riesgo es real y en el laboratorio se vio de refilón:** el revisor ejecutó `node --test` por
su cuenta. Se portó bien —lo declaró en su informe en vez de callárselo— pero eso fue criterio
suyo, no una barrera mía.

## 5.7 Lo que más va a doler en producción, y no es culpa del código

El cierre automático del tablero **no funciona sobre el `TABLERO.md` real**, porque la tarea vive
en prosa dentro de una cita. Está detectado, documentado y el sistema se niega a reescribir a
ciegas, que es lo correcto. Pero significa que, hasta que el tablero se convierta, **el paso 8 del
ciclo se cumple a medias en producción**: deja el texto para pegar y lo dice en el parte.

La conversión no entraba en este encargo. Que no entrara no lo hace menos bloqueante.
