# Mandarle al orquestador desde el móvil

Hasta ahora el bot solo hablaba: te mandaba el parte cada 3 horas y tú no podías contestar.
**Ahora también escucha.** Le escribes al mismo chat de siempre y te contesta.

**El parte de cada 3 horas sigue igual.** Esto es un añadido, no un cambio: aunque no le
mandes nunca nada, él te sigue informando solo.

---

## Escríbele como hablas

No hay comandos que memorizar y no hace falta ningún formato. Escribe en español normal.
**Si le mandas cualquier cosa que no entienda, te devuelve esta misma lista.** Así que si
alguna vez no te acuerdas, mándale un «hola».

### Para saber cómo va

| Le escribes | Te contesta |
|---|---|
| **parte** | El resumen entero, ahora mismo, sin esperar a las 3 horas |
| **qué estás haciendo** | En qué tarea va y desde cuándo |
| **cuota** | Cuánta queda y a qué hora se reinicia |
| **qué tareas quedan** | La lista de lo pendiente, con una flecha en la siguiente |

También valen: «mándame el parte», «cómo vas», «cuánto queda», «qué falta».

### Para mandarle

| Le escribes | Qué hace |
|---|---|
| **para** | Termina la tarea que tiene entre manos y **no coge la siguiente** |
| **arranca** | Vuelve a coger tareas |

También valen: «párate», «pausa», «no cojas más tareas» · «sigue», «continúa».

**Ojo con «para»:** no corta nada. Acaba lo que está haciendo y se queda quieto. Es lo que
quieres el 99 % de las veces.

### Esto te lo pregunta antes de hacerlo

Estas tres pueden dejar algo a medias, así que **te pregunta y espera un «sí»**. Si contestas
otra cosa, o tardas más de dos minutos, no hace nada.

| Le escribes | Qué hace |
|---|---|
| **para ya** | Corta a mitad. Puede quedar algo sin terminar |
| **salta esta tarea** | Deja la que tiene y pasa a la siguiente |
| **desapartar** | Devuelve al montón una tarea que se quedó apartada |

Para desapartar, primero pregúntale **qué tareas quedan**: en la lista de apartadas te dice
el nombre exacto que tienes que escribirle.

---

## Qué pasa cuando le mandas algo

Las preguntas (parte, estado, cuota, tareas) te las contesta **al momento**, esté ocupado o no.

Las órdenes (para, arranca, saltar, desapartar) te las contesta **«Anotado»**, y las hace en
cuanto termina el paso que tiene entre manos. Cuando las haya hecho, te lo dice. Por eso
«para» significa de verdad *«acaba y no cojas más»*: nadie corta nada por la mitad.

La única que va inmediata es **para ya**, porque es una emergencia.

---

## Quién puede mandarle

**Solo tú.** El bot obedece a un único chat: el tuyo, el que se configuró con
`conectar-telegram`. A cualquier otro le contesta «No te conozco» y nada más — ni le enseña
esta lista, ni le dice qué está haciendo, ni que esto existe. Y queda anotado en el servidor
con la hora y el número desde el que escribieron.

**Nunca sale ninguna clave por el chat.** Ni el dato de BotFather, ni ninguna otra.

**No se le puede mandar nada que no esté en esta página.** Lo que le escribes no se ejecuta
en el servidor: se compara con la lista de arriba y ya. Si escribes cualquier otra cosa
—aunque parezca una orden de ordenador— lo único que pasa es que te devuelve la lista.

**Todo lo que le pidas queda escrito** en `.orquestador/ordenes-registro.ndjson`: qué pediste,
cuándo y qué te contestó.

---

## Si algo va mal

**No contesta nada.** Mira que el vigía esté en pie:

```
systemctl status orquestador-vigia --no-pager
tail -20 logs/vigia.log
```

**Dice que el orquestador no está corriendo.** Es normal durante medio minuto después de una
parada: systemd lo levanta solo. Si sigue así:

```
systemctl status orquestador --no-pager
```

**Se quedó parado y no arranca.** Escríbele **arranca**. Si estaba en pausa, sigue.

---

## Para el que mantenga esto

Son **dos servicios**, a propósito:

- `orquestador.service` — el ciclo que trabaja.
- `orquestador-vigia.service` — el que escucha Telegram.

Están separados porque la pregunta que más falta hace es «¿qué está pasando?», y hay que
poder hacerla **justo cuando el orquestador lleva media hora metido en una llamada**, o
cuando se ha caído. Un vigía dentro del ciclo solo contestaría cuando el ciclo tuviera un
rato libre.

El vigía **lee** el estado y **nunca lo escribe** (`Almacen.leerEstado`): el dueño de
`estado.json` es el daemon. Las órdenes que necesitan al daemon se dejan en
`.orquestador/ordenes.ndjson` y él las recoge al principio de cada vuelta, marcando por
número de línea para no aplicar ninguna dos veces.

La lista cerrada de órdenes y el filtro del identificador están en `orchestrator/vigia/ordenes.js`.
**Ahí y solo ahí** se decide qué se puede mandar.
