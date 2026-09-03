# Diagnóstico — qué rutas de DISA escriben, y cuáles están protegidas

> **Paso 0 de la tarea `disa-rutas-sin-csrf`** (BLOQUE 2 · AUD-006).
> Solo lectura: escrito **antes** de tocar una línea de código, el 3 sep 2026.
> Medido contra el código de HOY.

---

## 1. Cómo lo hace el resto del producto (y por qué esto es un calco, no un invento)

El ERP monta sus rutas así (`modules/erp/routes/index.js:124-126` y `:213-215`):

```js
const admin = new Hono();
admin.use('*', auth);     // adminAuth(db)
admin.use('*', csrf);     // csrfProtect()
admin.route('/products', prodViews);
...
```

**Auth en la entrada, CSRF detrás, y luego los sub-routers.** Ninguna ruta del ERP repite `adminAuth`
ni declara su CSRF: **una ruta nueva nace protegida sin que nadie se acuerde**. Ese es exactamente el
requisito del encargo, y ya está construido — solo hay que aplicarlo a DISA.

`csrfProtect()` (`core/csrf.js`) **deja pasar `GET`, `HEAD` y `OPTIONS`**, así que aplicarlo a todo el
router **no toca ninguna ruta de solo lectura**. Acepta el token por cabecera `x-csrf-token` (que es
lo que ya manda todo el front) o por `_csrf` en el cuerpo.

---

## 2. El censo de DISA: 17 rutas, 11 escriben

`modules/disa/index.js`, montado dos veces (`app.route('/admin/disa', router)` y
`app.route('/api/disa', router)`), así que **cada ruta tiene dos direcciones** y cualquier arreglo
tiene que valer para las dos.

| Ruta | Método | Protección HOY |
|---|---|---|
| `/summary` | GET | — (lectura, no aplica) |
| `/` | GET | — (lectura, no aplica) |
| `/agents` | GET | — (lectura, no aplica) |
| `/threads` | GET | — (lectura, no aplica) |
| `/threads/:id` | GET | — (lectura, no aplica) |
| `/chips` | GET | — (lectura, no aplica) |
| **`/select-agent`** | POST | ❌ **NINGUNA** |
| **`/threads`** | POST | ❌ **NINGUNA** |
| `/threads/:id` | DELETE | ✅ `csrfProtect()` por ruta (tarea del borrado, 3 sep) |
| **`/threads/:id/title`** | POST | ❌ **NINGUNA** |
| **`/threads/:id/pin`** | POST | ❌ **NINGUNA** |
| **`/store-message`** | POST | ❌ **NINGUNA** *(neutralizada en D2, responde «en migración»)* |
| **`/chips`** | POST | ❌ **NINGUNA** |
| **`/message`** | POST | ❌ **NINGUNA** — `rateLimit` (15/min) no es CSRF |
| `/clear` | POST | ✅ `csrfProtect()` por ruta (tarea del borrado, 3 sep) |
| **`/alerts/open`** | POST | ❌ **NINGUNA** |
| **`/attach`** | POST | ❌ **NINGUNA** — `requirePerm('purchases.create')` no es CSRF |

**Nueve rutas de escritura sin ninguna protección**, y las **dos** que sí la tienen la llevan
**declarada a mano en su línea** — que es justo lo que el encargo quiere sustituir: sirve para esas
dos y no para la siguiente que alguien escriba.

**Lo que un atacante puede hacer hoy** con la sesión de la víctima abierta en otra pestaña: mandarle
un mensaje a DISA en su nombre (`/message`), renombrar o fijar sus conversaciones, cambiarle el
agente, y **subirle un adjunto que arranca la lectura por IA de una factura** (`/attach`, que además
gasta cuota del negocio). Todas son `POST` sin cabecera, o sea alcanzables desde un formulario ajeno.

**Las 17 llevan `adminAuth(db)` en su línea.** Ninguna es pública.

---

## 3. El orden importa, y es la única decisión técnica de la tarea

`csrfProtect()` lee `c.get('session')` y **devuelve 401 si no la encuentra**. Un
`router.use('*', csrfProtect())` a secas correría **antes** que el `adminAuth(db)` de cada ruta —el
middleware de `use` va delante de la cadena del handler— y **todas las escrituras darían 401**.

Por eso el ERP pone `auth` y `csrf` **en ese orden, los dos en la entrada**, y sus rutas no repiten
`adminAuth`. **Se hace igual en DISA**: una puerta con `use('*', auth)` + `use('*', csrf)`, y se
retira el `adminAuth(db)` de las 17 líneas, que pasa a ser redundante. Sin eso habría **dos
comprobaciones de sesión por petición** — dos consultas de permisos por cada mensaje de chat.

> ⚠️ **UNA CONSECUENCIA QUE HAY QUE DECIR, y no esconder.** `/message` tiene hoy
> `rateLimit(...)` **antes** de `adminAuth`. Con la puerta, el orden pasa a ser `auth → csrf →
> rateLimit`. Para un usuario legítimo **no cambia nada**: sigue recibiendo 429 al pasar de 15
> mensajes por minuto, y el gate lo comprueba. Lo que cambia es que una avalancha **sin sesión**
> recibirá **401** (de `adminAuth`) en vez de **429** — antes ni siquiera llegaba a mirar la sesión.
> Es el mismo orden que ya tiene todo el ERP, y deja de gastar el cupo del limitador en peticiones
> que iban a ser rechazadas igual.

---

## 4. Fuera de DISA — censado, y NO se toca (va al TABLERO)

| Sitio | Escrituras | Protección | Veredicto |
|---|---|---|---|
| ERP (`/admin`, `/api/erp`) | muchas | ✅ `csrfProtect()` en la entrada | correcto |
| `modules/portal/admin.js` | 3 POST | ✅ **hereda**: se monta en `admin.route('/portal', …)`, dentro del app que ya lleva csrf | correcto |
| `modules/superadmin/` | 17 | ⚠️ **protección PROPIA** (`saCsrf`, con la cookie `sadm` y `x-csrf-token`) | **No es un agujero**: el superadmin tiene su propia sesión, así que no puede usar la del ERP. Pero **es un mecanismo paralelo**, y eso se apunta. |
| `modules/portal/index.js:130` — `POST /portal/:token/mensaje` | 1 | ❌ ninguna | **No aplica CSRF**: es pública y se autentica por el token de la URL, no por una cookie de sesión. Sin cookie ambiental no hay ataque CSRF que montar. Se apunta para que nadie la «arregle» sin pensar. |
| `modules/registro/` | 3 POST | ❌ ninguna | **No aplica**: es el alta pública, antes de que exista sesión. |
| `modules/store/` | 9 | ❌ ninguna | **Capa 2 APAGADA** (`/store` → **404**, medido). Congelada por `CLAUDE.md`. |

**Nada de esto se arregla aquí** — el encargo pide cambios quirúrgicos. Va al TABLERO con su motivo.

---

## 5. ¿Contradice algo del tablero?

**No.** La ficha dice que el router de DISA «no hereda el `csrfProtect()` que sí llevan los routers
del ERP» y que «`csrfProtect` solo aparece en el router del ERP». Lo segundo **dejó de ser exacto el
3 de septiembre**, cuando la tarea del borrado lo puso en dos rutas de DISA — y esta tarea las
**integra en el mecanismo común y quita la declaración a mano**, que es lo que el encargo pide. El
resto de la ficha es literal.

---

## 6. Las comprobaciones, definidas ANTES de construir

1. **El ataque, primero en ROJO.** Una petición de escritura a DISA **sin la cabecera**, como la
   mandaría una página ajena con la cookie de sesión de la víctima: hoy **pasa** (200). Con el
   arreglo, **403**. Se prueba sobre varias rutas, no solo una.
2. **Con la prueba legítima sigue funcionando igual**, ruta por ruta y comparando la respuesta.
3. **Las de solo lectura no se tocan:** los `GET` siguen respondiendo 200 **sin** cabecera.
4. **En NAVEGADOR de verdad, con las pantallas reales de DISA**: chatear, subir un adjunto y borrar
   una conversación. *Que la protección no rompa el uso normal es la mitad de la tarea.*
5. **El censo se contrasta al final:** cero rutas de escritura de DISA sin protección, contadas
   sobre el código.
6. **El rate limit de `/message` sigue funcionando** para un usuario con sesión (429 al pasarse).
7. **Un centinela** que falle si alguien añade una ruta de escritura de DISA fuera de la puerta
   protegida, **probado poniéndolo en rojo primero**.
8. **Nada que se trague errores**; el negocio de prueba se tira con `tirarNegocio()`.
