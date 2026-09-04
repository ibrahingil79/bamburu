> ⚠️ **DOCUMENTO RETIRADO EL 4 DE SEPTIEMBRE DE 2026. NO DESCRIBE EL SISTEMA ACTUAL.**
>
> Explicaba cómo hablarle a la fábrica por Telegram. **Ese camino ya no existe**: por encargo de
> Ibrahin se borró todo el código del bot antiguo — `vigia/escucha.js`, el intérprete de órdenes,
> los botones, el servicio `orquestador-vigia` y los comandos `conectar-telegram` / `probar-telegram`.
> El bot es **exclusivo de los avisos de Bamburu** y **solo sabe enviar**.
>
> Se conserva como historia, que es la costumbre de este repositorio: nada se borra. Si algún día se
> enciende la fábrica, tendrá **su propio bot** y se escribirá un manual nuevo.

---

# Encender los avisos de Telegram

El orquestador te manda un parte cada 3 horas contando qué ha hecho. Para eso necesita dos
datos que solo puedes sacar tú, desde Telegram. Se tarda unos cinco minutos.

> **Y desde el 31 ago 2026 también te escucha:** con estos mismos dos datos puedes pedirle el
> parte cuando quieras, preguntarle qué está haciendo, o mandarle parar. Cómo se le habla está
> en [mandarle-por-telegram.md](mandarle-por-telegram.md).

**Mientras no lo hagas no pasa nada:** el orquestador trabaja igual y guarda los partes para
mandártelos todos en cuanto lo conectes.

---

## Antes de empezar

Vas a necesitar dos cosas:

- Telegram abierto (en el móvil o en el ordenador, da igual).
- La ventana negra donde escribes los comandos del servidor.

---

## Paso 1 · Habla con BotFather

En Telegram, arriba del todo hay una **lupa** para buscar. Pulsa y escribe:

```
@BotFather
```

Te va a salir una cuenta llamada **BotFather** con una **marca azul de verificado** al lado.
Ésa es la buena. Si sale alguna parecida sin la marca azul, no es.

Pulsa sobre ella y luego en **EMPEZAR** (o *START*).

---

## Paso 2 · Pídele un robot nuevo

Escríbele este mensaje:

```
/newbot
```

Te va a contestar preguntando cómo quieres llamarlo. Te pedirá **dos nombres seguidos**:

1. **El nombre normal.** El que verás tú en la lista de chats. Por ejemplo:

   ```
   Orquestador de Bamburu
   ```

2. **El nombre técnico.** Éste tiene que **terminar obligatoriamente en `bot`** y no puede
   estar cogido por otra persona en todo el mundo. Prueba con algo tuyo, por ejemplo:

   ```
   bamburu_ibrahin_bot
   ```

   Si te dice que ya está cogido, cambia algo y vuelve a probar. Es normal a la primera.

---

## Paso 3 · Copia el dato largo

Cuando acepte el nombre, BotFather te manda un mensaje de felicitación. Dentro hay una línea
que dice **"Use this token to access the HTTP API"** y, justo debajo, **una ristra larga de
números y letras con dos puntos en medio**. Se parece a esto (esto es inventado, el tuyo será
distinto):

```
8123456789:AAH-Xy7fK2mNpQr4sTuVwXyZ1234567890
```

**Ése es el primer dato.** Cópialo entero.

> En Telegram basta con **mantener el dedo pulsado** (o hacer clic) sobre esa ristra y él solo
> te la copia. Cópiala entera, sin dejarte nada por delante ni por detrás.

⚠️ **Ese dato es como la llave de tu casa.** No se lo mandes a nadie, no lo pegues en un correo
ni en un chat. Si alguna vez crees que se ha visto donde no debía, vuelve a BotFather y
escríbele `/revoke`: se anula y te da uno nuevo.

---

## Paso 4 · Escríbele a tu robot

Busca ahora tu robot en la lupa por el nombre técnico que le pusiste (el que acaba en `bot`),
por ejemplo `bamburu_ibrahin_bot`.

Ábrelo, pulsa **EMPEZAR** y escríbele cualquier cosa. Vale con:

```
hola
```

**Este paso no te lo puedes saltar.** Un robot de Telegram no puede escribirte primero: hasta
que tú no le hablas, no tiene permiso para mandarte nada.

---

## Paso 5 · Consigue el número de la conversación

Ahora hace falta el número que identifica vuestro chat. En la ventana negra del servidor,
escribe esto **cambiando `PEGA_AQUI_TU_DATO_LARGO` por el dato del paso 3**:

```
curl -s "https://api.telegram.org/botPEGA_AQUI_TU_DATO_LARGO/getUpdates" | grep -o '"id":[0-9-]*' | head -1
```

Te va a contestar algo así:

```
"id":987654321
```

**El número que sale después de los dos puntos es el segundo dato.** En el ejemplo, `987654321`.
Puede empezar por un guión (`-100...`); si es así, cópialo con el guión y todo.

> **¿No sale nada?** Es que no le has escrito al robot todavía. Vuelve al paso 4, mándale «hola»
> y repite este paso.

---

## Paso 6 · Dáselos al orquestador

Ya tienes los dos datos. Ahora, en la ventana negra:

```
cd bamburu
node orchestrator/orq.js conectar-telegram
```

Te va a preguntar los dos datos, uno detrás de otro. **Pega cada uno cuando te lo pida y pulsa
Enter.** Él los guarda en su sitio seguro; tú no tienes que abrir ningún fichero.

En cuanto los guarde, te manda un mensaje de prueba solo. Si todo está bien verás:

```
✅ ENVIADO. Mira tu Telegram: tienes que ver un mensaje de prueba.
```

**Mira Telegram.** Tienes que ver un mensaje que dice *«Prueba del orquestador»*. Si lo ves,
está hecho.

---

## Si algo falla

El comando te dice qué pasó y qué hacer. Éstos son los tres casos:

| Lo que ves | Qué significa | Qué haces |
|---|---|---|
| **«el dato largo de @BotFather está mal copiado»** | Te dejaste un trozo, o copiaste un espacio de más | Vuelve al paso 3 y cópialo entero |
| **«el número de la conversación no es el bueno, o no le has escrito al bot»** | Falta el paso 4 | Escríbele «hola» al robot y repite el paso 5 |
| **«Has bloqueado al bot»** | Le diste a bloquear sin querer | Ábrelo en Telegram y desbloquéalo |

Para volver a comprobarlo cuando quieras, sin tener que repetir nada:

```
cd bamburu
node orchestrator/orq.js probar-telegram
```

---

## Qué va a pasar a partir de ahora

- Cada **3 horas** recibes un parte: qué se ha terminado, qué se arregló solo, qué está en
  marcha, qué queda y cuánta cuota se ha gastado.
- Además, **solo cuando una tarea se atasque de verdad**, recibes un aviso suelto pidiéndote una
  decisión. Fuera de eso, no te molesta.
- **El robot solo escribe. No escucha.** No puedes darle órdenes por Telegram, y nadie más
  tampoco. Está hecho así a propósito: es un altavoz, no un mando.
