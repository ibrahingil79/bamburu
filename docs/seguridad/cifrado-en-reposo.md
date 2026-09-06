# Cifrado en reposo de las bases — cómo funciona y dónde vive la llave

> Ficha `cifrado-en-reposo-bases` (TABLERO.md). Construido el 6 de septiembre de 2026.
> **La llave la genera y la custodia Ibrahin.** Esa parte no es técnica y no se hereda por parecido:
> *«si se pierde la llave se pierde el negocio vivo, no solo las copias. Eso es mío.»* (1 sep 2026).

---

## 1 · Qué protege esto, y qué no

Las bases de negocio (`data/tenants/<slug>.db`) y el índice de enrutado (`data/control.db`) estaban
**en claro en el disco del servidor**. El aislamiento era *a nivel de fichero* —una base por negocio—,
que impide que un negocio vea a otro pero **no protege de quien tenga el disco**: una copia de la
máquina, un volumen desmontado, una imagen de respaldo del proveedor.

Ahora esos ficheros están cifrados. Quien consiga el disco **no puede leer ni un NIF sin la llave**.

**Lo que esto NO hace, dicho claro para que nadie se confíe:**

- **No protege del proceso vivo.** Bamburu tiene la llave en memoria para poder trabajar; quien
  ejecute código como el usuario `ubuntu` mientras el servicio corre puede leer los datos. Contra eso
  van otras piezas (permisos, CSRF, la puerta de DISA, el endurecimiento de systemd), no esta.
- **No sustituye a las copias.** Cifrar no es respaldar.
- **No sustituye a la llave de las copias.** Son dos llaves distintas con dos custodias distintas: la
  de `rclone` protege lo que sale a Drive; esta protege lo que se queda en el disco.

---

## 2 · Dónde vive la llave, y por qué ahí

```
/etc/bamburu-bases.env      →  BAMBURU_LLAVE_BASES=<64 caracteres hexadecimales>
                               propietario ubuntu:ubuntu, permisos 600
```

**No va en `/etc/bamburu.env`, y es a propósito.** Ese fichero entra ENTERO en el `process.env` del
proceso web expuesto a Internet: cualquier vuelco de entorno —un informe de error, una pantalla de
diagnóstico, una traza— se lo llevaría puesto. Es el mismo criterio con el que la llave de las copias
se quedó fuera de ahí (ver la cabecera de `scripts/cifrar-copias-de-seguridad.sh`).

La llave se lee **del disco**, una vez por proceso, y se guarda en una variable del punto único de
apertura. **Nunca entra en `process.env`**: si alguien la pone en el entorno para una prueba, se lee
y se borra del entorno en el acto.

No hay que tocar ninguna unit de systemd: las seis (`bamburu` y las cinco tareas de reloj) leen el
fichero por su cuenta al abrir la primera base. `ProtectSystem=full` deja `/etc` en solo lectura para
el servicio, que es justo lo que hace falta: leerlo sí, escribirlo no.

---

## 3 · CÓMO SE GENERA LA LLAVE — lo hace Ibrahin, en su terminal

**Tres órdenes, en este orden.** La llave **no aparece en ninguna línea de orden**, así que no entra
en el historial de la terminal; solo se ve en la salida del paso 2.

```bash
# 1 · generar y colocar (todavía no se ve)
umask 077
printf 'BAMBURU_LLAVE_BASES=%s\n' "$(openssl rand -hex 32)" | sudo tee /etc/bamburu-bases.env >/dev/null
sudo chown ubuntu:ubuntu /etc/bamburu-bases.env && sudo chmod 600 /etc/bamburu-bases.env

# 2 · verla UNA vez, para custodiarla FUERA del servidor
sudo cat /etc/bamburu-bases.env

# 3 · comprobar que está bien puesta (esto NO enseña la llave)
ls -l /etc/bamburu-bases.env
node scripts/cifrar-bases-en-reposo.mjs --estado
```

### La custodia — esta parte es la que importa

- **Guárdala en AL MENOS DOS SITIOS FUERA DEL SERVIDOR**, y que no sean el mismo sitio con dos
  nombres: un gestor de contraseñas **y** algo que no dependa de tener conexión (papel en un cajón,
  una nota en el móvil cifrada). Dos copias en la misma cuenta de Google son una copia.
- **No la mandes por correo, ni por Telegram, ni por WhatsApp, ni la pegues en un chat** — este
  incluido.
- **No entra en el repositorio ni en las copias de seguridad.** No está en `git`, y `bamburu-backup.sh`
  no la sube: el paquete de entorno que viaja en la copia es `/etc/bamburu.env`, que es otro fichero.
- Si la pierdes, **no hay quien recupere las bases**: ni yo, ni Anthropic, ni nadie. Los ficheros
  quedan como ruido. Esa es literalmente la decisión que tomaste el 1 de septiembre.

---

## 4 · Qué pasa si falta la llave o es la que no es

**El programa NO arranca a medias.** Es el mismo patrón que el arranque sin un módulo esencial
(`core/loader.js`, AUD-007): se muere diciendo qué pasa, con código de salida distinto de cero, para
que `Restart=on-failure` lo cuente como arranque fallido.

Y dice **qué** pasa sin enseñar **nada**: ni la llave, ni un trozo de ella, ni la ruta de ninguna base.

```
Bamburu no arranca: falta la llave de cifrado de las bases (el fichero de la llave no existe).
   Las bases están cifradas en reposo y sin la llave no se pueden abrir. Esto NO se degrada:
   arrancar a medias serviría pantallas vacías, como si los negocios no tuvieran datos.
```

```
Bamburu no arranca: la llave de cifrado NO abre las bases.
   O no es la llave con la que se cifraron, o la base no está cifrada con ella.
   No se toca nada y no se arranca a medias.
```

Ese segundo mensaje existe por un motivo concreto: sin él, una llave equivocada aparecería mucho más
tarde, dentro de una consulta cualquiera y disfrazada de `file is not a database` — y quien lo leyera
se iría a buscar una base corrupta, que es el sitio equivocado.

---

## 5 · Cómo está construido

### El punto único de apertura

`core/sqlite-bamburu/` es un paquete local que **se llama `better-sqlite3`**: en `package.json` la
dependencia apunta a esa carpeta. Por dentro es `better-sqlite3-multiple-ciphers` —el mismo motor,
la misma API síncrona, la misma generación 9— envuelto en una clase que aplica la llave.

**Por qué así y no una función que llame cada sitio:** hay **345 `new Database(` en 255 ficheros**. Un
diseño en el que cada sitio tiene que acordarse de poner la llave falla el primer día que alguien
escriba el 346, y falla de la peor manera: `new Database('data/tenants/loquesea.db')` sin llave sobre
un fichero que no existe **no da error, crea una base nueva en claro**. Eso ya pasó aquí sin cifrado
ninguno — es `null.db`, la base fantasma del 3 sep 2026.

### Cuándo se pone la llave: el sitio propone, el fichero dispone

> ⚙️ **Rehecho el 6 sep 2026, el mismo día.** La primera versión decidía **solo por la forma de la
> ruta**, y el barrido completo demostró que eso falla **por los dos lados**: una base real copiada
> fuera de su sitio se volvía imposible de abrir (`verify-wal-acotado`), y un fichero cualquiera
> colocado en la carpeta buena se trataba como cifrado (`gate-copias-cifradas`).
>
> **Una base es de Bamburu por lo que ES, no por su carpeta.** Lo incómodo es que «lo que es» **no se
> puede leer del fichero**, y está medido: dos bases cifradas con la MISMA llave empiezan por 16 bytes
> distintos y aleatorios, porque eso es la **sal** de cada una. No hay marca que reconocer — y no es
> un olvido: un fichero cifrado debe parecer ruido, porque una cabecera mágica le dice a quien lo roba
> qué tiene. LUKS se marca porque es un contenedor con sitio para su cabecera; una base SQLite no lo
> tiene. SQLCipher y VeraCrypt tampoco marcan, por lo mismo. Así que la respuesta es la otra que usan
> esas herramientas: **la llave se da a propósito.**

**Tres puertas, y solo tres:**

| Situación | Qué pasa |
|---|---|
| Fichero **fuera** de `…/data/control.db` o `…/data/tenants/*.db` | Nunca se cifra ni se descifra solo. Es el `better-sqlite3` de siempre. |
| **En su sitio** y **no existe** todavía | Nace cifrada. Un alta de negocio no depende de que nadie se acuerde. |
| **En su sitio** y **no** es SQLite en claro | Se abre con la llave. Es nuestra, o es basura y se dirá. |
| **En su sitio** y **sí** es SQLite en claro | **Se abre en claro, y se avisa a gritos** por el journal. No se le pone una llave que no tiene. Que ahí no debería haber una base en claro **lo vigila el gate**. |
| `new Database(ruta, { bamburuLlave: true })` | **A propósito, y en cualquier ruta.** Es la puerta para una herramienta o un técnico que quiera abrir una base copiada fuera de su sitio. |

Esa última es la que usa `verify-wal-acotado`, que copia `control.db` en crudo a `/tmp` —a propósito:
llevársela con `.backup` haría checkpoint y borraría justo el WAL que quiere medir— y luego la abre
diciendo explícitamente que quiere la llave del servidor.

### El cifrado elegido

`chacha20` (ChaCha20-Poly1305, esquema *sqleet*), el que trae SQLite3 Multiple Ciphers por defecto:
autenticado página a página, así que además de ocultar detecta manipulación. Compatible con WAL —
comprobado con dos procesos escribiendo y leyendo a la vez, e `integrity_check` en verde después.

**`kdf_iter = 1`, y lleva su motivo escrito en el código.** Las iteraciones de PBKDF2 encarecen la
fuerza bruta contra una *contraseña* de poca entropía. La nuestra son 32 bytes en bruto del generador
del sistema: 256 bits reales, nada que adivinar. Derivarla 64.007 veces no la hace más fuerte y
cuesta **30 ms en cada apertura**. Medido en esta máquina:

| apertura de una base                        | coste      |
|---------------------------------------------|------------|
| en claro (como estaba)                      | 0,29 ms    |
| cifrada, KDF por defecto                    | 29,9 ms    |
| **cifrada, `kdf_iter = 1`** (lo que se usa) | **0,41 ms** |

Es el mismo razonamiento por el que SQLCipher tiene «raw key mode».

### Rendimiento, medido

| operación                    | en claro | cifrado | diferencia |
|------------------------------|---------:|--------:|-----------:|
| insertar 20.000 en una tx    |   47 ms  |  47 ms  |   +0,7 %   |
| 30.000 lecturas indexadas    |  158 ms  | 147 ms  |   −6,6 %   |
| barrido completo de la tabla |  1,4 ms  | 1,5 ms  |   +3,7 %   |
| 300 commits sueltos          |    6 ms  |  15 ms  |  +150 %    |
| tamaño del fichero           |    igual |   igual |      0 %   |

Lo único que se nota es el commit suelto, y en absoluto son 0,02 ms → 0,05 ms por commit. Una
petición del panel hace una transacción, no trescientas.

### Las copias de seguridad

`db-snapshot.mjs` pasó de la *Online Backup API* a `VACUUM INTO`, y **no es un capricho**: la API de
copia escribe en un fichero destino que se abre sin llave, así que de una base cifrada sacaba **una
copia EN CLARO** (medido: cabecera `SQLite format 3` y los NIF legibles dentro). Habría dejado cada
madrugada a las 03:33 una copia entera y legible de los once negocios en el disco del servidor —
justo lo que esta ficha existe para impedir. `VACUUM INTO` hereda el cifrado del origen: **el snapshot
es siempre tan secreto como su original, y los datos nunca tocan el disco sin cifrar.**

Consecuencia que hay que tener presente: **las copias nuevas necesitan esta llave para restaurarse**,
además de la de `rclone`. Las dos están custodiadas fuera del servidor; si eso deja de ser cierto, el
problema no es la copia.

`db-revisar.mjs` es ahora el único sitio que responde «¿esta base abre y sirve?» (integrity_check `ok`
**y** esquema dentro, porque `ok` también lo dice una base vacía). Lo usan la copia de cada noche, la
restauración completa y el ensayo. Antes eran tres llamadas al `sqlite3` **del sistema**, que no puede
abrir una base cifrada y habría dicho «file is not a database» de copias perfectamente buenas.

---

## 6 · La comprobación

```
node scripts/gate-cifrado-en-reposo.mjs
```

Va en el barrido **RÁPIDO** y en el grupo `infra`. Mira los ficheros de verdad —no le pregunta al
código si cree que cifra— y después **se pone rojo a sí mismo tres veces**, en un banco de /tmp:

1. sin llave → el programa se para, y lo dice sin enseñar la llave
2. llave incorrecta → el programa se para, y no lo disfraza de base corrupta
3. una base devuelta a claro → el gate la caza y la nombra
4. una base real **fuera de su sitio** → sola no se abre, y **con la llave pedida a propósito** sí
5. un fichero cualquiera **en la carpeta buena** → se abre tal cual, avisa, y el gate lo sigue cazando

(los dos últimos se añadieron el 6 sep 2026, cuando el barrido completo demostró que decidir por la
carpeta fallaba por los dos lados)

Va en el rápido por dónde puede romperse: **no hace falta tocar el cifrado para descifrar una base**
—basta con restaurar una copia vieja, mover una ruta, o abrir una base con una herramienta que no
pase por el punto único— y **una base devuelta a claro no se nota usando el producto**: funciona
igual de bien. Solo lo ve quien mire el fichero.

---

## 7 · Las bases en claro que había antes

No se han borrado: **se han apartado**, igual que las bases fantasma del 4 sep 2026, en
`~/bases-retiradas/<fecha>-en-claro-antes-de-cifrar/` con un `LEEME.txt` y la huella SHA-256 de cada
fichero. Están en claro, así que la carpeta va en 0700 y los ficheros en 0600. **Su borrado
definitivo es una segunda decisión, y es de Ibrahin.**

---

## 8 · Volver atrás

Si alguna vez hiciera falta, son dos pasos y hacen falta los dos:

1. parar `bamburu.service` y devolver los `.db` (con sus `-wal` y `-shm`) desde la carpeta de
   apartadas a `data/`;
2. dejar la dependencia `better-sqlite3` de `package.json` apuntando otra vez al paquete de siempre
   (`^9.4.3`) y `npm install`.

Sin el segundo paso, el programa intentará descifrar una base que está en claro y **no arrancará** —
a propósito.
