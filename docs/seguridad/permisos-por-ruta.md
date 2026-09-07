# Qué permiso exige cada ruta — Paso 1 (7 sep 2026)

> Ficha `permisos-paso-1-censo-rutas`. **Esto es un CENSO: no cambia ni un permiso.** Deja escrito
> qué exige hoy cada ruta, que es lo que desbloquea el Paso 2 (DISA administrando permisos): no se
> puede dejar que la IA reparta permisos sobre un mapa que no existe.
>
> El inventario completo, ruta por ruta y con su `fichero:línea`, está en
> **`docs/seguridad/permisos-por-ruta-inventario.md`** (610 filas). Se regenera con
> `node scripts/censo-permisos-rutas.mjs --md <fichero>`.

---

## 1. EL MÉTODO DE CONTEO — que era la mitad del encargo

La ficha traía una cifra —«600 de 1.025 rutas sin comprobación de permiso visible»— y venía marcada
como **no reproducible**: contando sobre el árbol salen 1.995 declaraciones de ruta y 464 guardas, que
no da ni 600 ni 1.025 por ningún camino. Por eso el encargo decía que quien construyera esto
**empezara fijando el método, y que el método fuera parte de la entrega**.

**El método es no contar código.** No se puede: los routers se llaman `app`, `api`, `sa`, `r`,
`router`, `views`, `puerta`… (hay **110** objetos `new Hono()`), se anidan unos dentro de otros, y
**el camino final de una ruta no está escrito en ninguna línea** — se compone al montar. Cualquier
recuento por expresiones regulares depende de qué nombres de variable se te ocurran, y por eso dos
personas obtienen dos cifras.

**Se le pregunta a la aplicación.** `scripts/censo-permisos-rutas.mjs` monta Bamburu entera igual que
el servidor y lee `app.routes`, la tabla interna de Hono, donde cada ruta ya lleva su camino COMPLETO
resuelto. Es, por definición, la lista de lo que el servidor sirve.

**Las cuatro reglas, escritas para que cualquiera repita el número:**

1. **Una RUTA es un par (método, camino)** con método distinto de `ALL`. Las entradas `ALL /x/*` son
   middleware (`use`), no rutas. Hono mete **una entrada por manejador**, así que la tabla tiene
   **1.188 entradas** para **610 rutas**: contar entradas era otra forma de inflar la cifra.
2. **El orden de registro manda.** Un `use()` solo alcanza a lo registrado DESPUÉS de él. Así es como
   el superadmin deja públicas sus dos pantallas de entrada y protege el resto.
3. **Una guarda se reconoce por lo que HACE, no por su nombre.** No basta con las de `core/`: cada
   módulo tiene las suyas (`superadminAuth`, `apexGuard`, `saCsrf`…). Cuenta como guarda todo
   middleware cuyo código pueda negar el paso: redirigir a una entrada, responder 401 o 403, o llamar
   a `denegarPermiso`.
4. **Sesión no es permiso.** `adminAuth` solo exige estar dentro. Va en su propia casilla, porque
   confundir «hay que estar dentro» con «hay que tener permiso» es justo el agujero que se buscaba.

**Y una pieza que hubo que abrir para que el método exista:** `requirePerm(perm)` guardaba el permiso
dentro del cierre, así que desde fuera era una función anónima. Ahora las cuatro guardas de `core/`
llevan una etiqueta (`fn.bamburuGuarda = { tipo, permiso }`) que dice qué exigen. Es una propiedad en
una función: no cambia lo que hacen ni cuándo.

### El censo se equivocó tres veces, y así se cazó

Se dice porque es lo que hace creíble el número, y porque la regla de esta casa es que **un censo que
dice algo falso es peor que no tenerlo, porque cierra la pregunta.**

1. **Declaró «sin guarda» las 22 rutas del superadmin** —las que suspenden negocios y lanzan copias—
   porque solo miraba las etiquetas de `core/` y `superadminAuth` no lleva ninguna. Se cazó
   **pidiéndoselas al servidor vivo sin credenciales: las 22 redirigen a `/superadmin/login`.**
2. **Ignoraba el orden de registro**, así que daba por guardadas rutas públicas. Se midió con Hono a
   mano: una ruta declarada antes del `use('*')` no pasa por él.
3. **Creía que `/x/*` no alcanza a `/x` pelado.** Sí lo alcanza — medido con Hono a mano. Por eso
   daba «sin guarda» la portada del superadmin, que redirige a login desde siempre.

**Comprobado en las dos direcciones sobre el servidor vivo**, que es lo único que cierra la pregunta:
las 8 públicas que se pueden pedir con un GET responden 200 (o el 302 de un enlace caducado); y de una
muestra de 12 que el censo da por guardadas, **las 12 deniegan** sin sesión (302 a login, 401 o 403).

---

## 2. EL MAPA, EN NÚMEROS

```
  entradas en la tabla de Hono : 1.188   (una por manejador)
  de ellas, middleware (use)   :    22
  RUTAS (método + camino)      :   610

    🔐 exigen un permiso con nombre :  441      57 permisos distintos en uso
    🔎 lo comprueban por dentro     :   12      el permiso no se ve en la línea
    👤 solo exigen SESIÓN           :  143
    ⚠️  sin guarda ninguna           :   14      las puertas públicas
```

**Los 14 sin guarda son puertas públicas, y están comprobadas una a una:** la portada, los dos
`favicon`, `/docs`, el alta (`/registro` y sus tres `POST`), la entrada (`/acceso`, `/acceso/entrar`,
`/find-tenant`), `/superadmin/login`, el webhook de Stripe (que se valida por firma, no por sesión) y
`/admin/autologin`, que **no es un agujero**: exige un vale de un solo uso y sin él manda a `/acceso`.

---

## 3. LAS 12 QUE COMPRUEBAN EL PERMISO POR DENTRO

No están mal — comprueban de verdad—, pero **su permiso no se ve en la línea de la ruta**, así que no
aparecen en ningún mapa que se haga leyendo el código. Aquí quedan nombradas:

| Ruta | Cómo lo comprueba |
|---|---|
| `POST /admin/disa/message` · `GET /admin/disa/summary` | `checkPermission` |
| `POST /api/disa/message` · `GET /api/disa/summary` | `checkPermission` |
| `GET /admin/suscripcion` (+ `/cancelado`, `/descargar`, `/vuelta`) | `soloDueno` |
| `POST /api/erp/suscripcion/alta` · `/descarga/preparar` · `/rescatar` · `GET /situacion` | `c.get('isOwner')` |

---

## 4. LAS 143 QUE SOLO EXIGEN SESIÓN — y las 38 que hay que mirar

De las 143, **105 son cosas de tu propia cuenta o de tu propio panel** y con sesión basta: entrar,
salir, el 2FA, tu contraseña, tu perfil y tu foto, tus avisos, tu fichaje, cómo ordenas tu Inicio y tu
menú, el portal del cliente (que entra por su enlace) y la reserva pública (que entra por el suyo).

**Las otras 38 no son cosas de tu cuenta: mueven o enseñan datos del negocio, y hoy basta con estar
dentro.** ⚠️ **Que estén en esta lista es un JUICIO MÍO, no una medida.** Lo medido es que solo exigen
sesión; **si eso está mal o está bien lo decide Ibrahin**, porque cambia lo que un empleado puede
hacer — y eso es una promesa del producto, no una decisión de construcción. **Aquí no se ha tocado ni
una.**

**Las que más llaman la atención, con lo que hacen:**

| Ruta | Qué hace hoy con solo estar dentro |
|---|---|
| `POST /api/erp/propuestas/:id/emitir` | **emite una factura** |
| `POST /api/erp/propuestas/:id/enviar` | la manda al cliente |
| `POST /api/erp/propuestas/:id/preparar-compra` | prepara una compra a proveedor |
| `POST /api/erp/importar/importar` | **importa datos en masa** |
| `POST /api/erp/importar/:id/deshacer` | deshace una importación |
| `GET /api/erp/fichaje/historial/:userId/:fecha` | ve el fichaje **de otra persona** |
| `PUT`/`DELETE /api/erp/inicio/empresa` | cambia el Inicio **de todo el negocio** |
| `POST /api/erp/listados/:clave/enviar` | manda un listado por correo |
| `GET /admin/settings` | la pantalla de ajustes del negocio |

Las 14 restantes de las 38 son el asistente (`/admin/disa/*`: hilos, chips, agentes), que **está
apagado desde el 7 sep**, y las cuatro pantallas de listados, propuestas y fichaje.

La lista entera de las 38, con su `fichero:línea`, sale del inventario filtrando por «solo sesión».

---

## 5. QUÉ DESBLOQUEA ESTO, Y QUÉ NO

**Desbloquea el Paso 2**: ya hay un mapa, y se regenera solo. Lo que el Paso 2 necesitaba no era una
lista escrita a mano —que caduca en la primera semana— sino **una forma de preguntarle al programa**.

**No decide nada.** Ni añade permisos, ni los quita, ni cambia quién puede hacer qué. Las 38 de arriba
son una pregunta para Ibrahin, no un plan.
