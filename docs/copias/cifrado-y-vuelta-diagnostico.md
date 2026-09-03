# Copias cifradas, con el entorno y los certificados — diagnóstico (Paso 0)

> **Tarea `copias-cifradas-con-entorno-y-certificados`** (BLOQUE 2 · AUD-008). Escrito el 3 sep 2026
> **antes de tocar nada**. Todo medido en el servidor.

## 1. De dónde se parte, comprobado hoy

| Qué | Estado medido |
|---|---|
| `~/.config/bamburu/backup-destinos.conf` | **No existe** |
| `rclone listremotes` | `gdrive:` y `gdrive_gili:` — **ningún remote `crypt`** |
| Modo de las copias | **EN CLARO**, las dos |
| `scripts/cifrar-copias-de-seguridad.sh` | existe, 16 KB, **construido y sin encender** |
| `scripts/bamburu-backup.sh` | existe, 19 KB, **una sola pieza para las dos copias** |

**Qué entra hoy en la copia:** `data/control.db`, `data/tenants/*.db` y `data/uploads` (en `tar.gz`).
**Qué NO entra:** `/etc/bamburu.env` **ni** ningún certificado. Con una pérdida total habría datos y
nada con que levantarlos.

## 2. ⚠️ El orden no es una preferencia: es la tarea

`/etc/bamburu.env` contiene hoy, comprobado leyendo **solo los nombres**: `ANTHROPIC_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `NOTION_TOKEN`, `HEALTHCHECKS_URL`.

**Meter ese fichero en la copia antes de encender el cifrado sería subir todas las llaves del
negocio, en claro, a dos Drive personales.** Por eso:

1. **Primero se enciende el cifrado**, con su ensayo real.
2. **Y el entorno y los certificados solo se incluyen si el destino es `crypt`.** No es una
   comprobación de cortesía: si el destino cifrado desapareciera y la copia volviera a claro
   —cosa que el script sabe hacer, a propósito, para no quedarse sin copia—, **los secretos NO
   pueden ir en esa copia en claro**. La copia sale igual, con los datos, y **lo dice**.

## 3. Los certificados: hoy no hay ninguno, y eso no puede romper nada

No existe ninguna carpeta de certificados. El código (`certPathForTenant`, `verifactu-envio.js:103`)
resuelve `VERIFACTU_CERT_DIR/<slug>.p12|.pfx` con caída a `VERIFACTU_CERT_PATH`, y **ninguna de las
dos variables está definida**. El `.p12` del dueño **se borró del servidor a propósito** tras las
pruebas de julio.

**Decisión de construcción (no de producto), y su motivo:** la carpeta canónica es
**`~/.secrets`**, que es la que ya dice la documentación de Verifactu
(`docs/verifactu/tarea2-fase-a-envio.md`: *«el archivo, en `~/.secrets` con `chmod 600`»*). Se crea
**vacía** con permisos `700` —crear una carpeta no es inventar un certificado— y la copia la incluye
**siempre**, vacía o no. El día que aparezca un `.p12` ahí dentro, **entra en la copia sin que nadie
tenga que acordarse**. Si alguien define `VERIFACTU_CERT_DIR` apuntando a otro sitio, la copia sigue
esa variable.

## 4. Lo que YA está bien y no se toca

- **Una sola pieza sirve las dos copias:** `bamburu-backup.sh` con `BACKUP_LABEL`/`BACKUP_REMOTE`;
  la unit secundaria solo sobreescribe variables. **No se duplica.**
- **La comprobación nocturna ya descifra de verdad:** con destino `crypt` usa `rclone cryptcheck`
  (huella real, no tamaño) y además **baja el fichero y lo compara byte a byte** (`cmp -s`). El
  código ya distingue los dos mundos y **falla si el destino no da huellas**.
- **El cerrojo del orden ya está construido:** `EXIGE_CRYPT` solo se activa si existe el fichero de
  destinos, y ese fichero **solo lo escribe el activador después de un ensayo real**. El código no
  puede exigir cifrado antes de que el cifrado exista — que fue la avería del 1 de septiembre.

## 5. Lo que falta, y es lo que hay que construir

1. **Encender el cifrado** (ejecutar el activador; orden de Ibrahin del 3 sep 2026).
2. **Meter `/etc/bamburu.env` y los certificados en la copia**, gobernado por §2.
3. **Que un fallo avise por Telegram**, no solo por correo. Hoy avisa por correo (Resend) y por
   `healthchecks.io`, pero **si el correo no sale, eso se queda en un `WARN:` del log** — la misma
   avería que arregló el cierre 7 en el arranque.
4. **El procedimiento de vuelta escrito**, en orden.
5. **Simulacro de restauración real** desde una copia cifrada, y las dos pruebas en rojo: llave
   equivocada y fichero de Drive ilegible.
6. **Comprobaciones automáticas**, probadas en rojo.

---

# ✅ LO HECHO Y LO MEDIDO (3 sep 2026, mismo día)

## 7. El cifrado, encendido

Ejecutado `scripts/cifrar-copias-de-seguridad.sh` por orden de Ibrahin. Hizo sus ocho pasos y
**el ensayo real pasó en las dos cuentas**: subir, bajar, comparar byte a byte y comprobar que en el
destino crudo no se lee el nombre. Solo entonces cambió el destino.

```
remote gdrive_cif ......... crypt (creado)
remote gdrive_gili_cif .... crypt (creado)
destinos .................. ~/.config/bamburu/backup-destinos.conf (permisos 600)
-> las copias van CIFRADAS
```

La llave vive en `~/.config/rclone/rclone.conf` (**600, dueño `ubuntu`**), **no** en
`/etc/bamburu.env` —que entra entero en el proceso web expuesto a Internet— y **no** en el
repositorio (comprobado: cero coincidencias). Se enseñó **una sola vez por pantalla**.

## 8. Las dos copias de hoy, lanzadas a mano y completas

| Copia | Resultado | Artefactos | Modo |
|---|---|---|---|
| principal (`ibrahingil`) | `Result=success` | **16** | **CIFRADO** |
| secundaria (`gilibrahin`) | `Result=success` | **16** | **CIFRADO** |

Cada artefacto pasó, además de la subida: **`cryptcheck`** (huella real, no tamaño) **y descarga con
comparación byte a byte**. El nuevo `entorno-2026-09-03.tar.gz` incluido en las dos.

## 9. La vuelta, probada de verdad y no supuesta

**El entorno vuelve idéntico.** Bajado `entorno-2026-09-03.tar.gz` del Drive cifrado, extraído y
comparado: **`cmp` dice idéntico byte a byte con `/etc/bamburu.env`**. Trae dentro `bamburu.env`,
`certificados/` (vacía hoy) y `LEEME-PARA-VOLVER.txt`.

**Y Bamburu levanta con esos datos.** Se restauraron del Drive cifrado `control.db` y dos negocios
—`desarrollo-bamburu`, con **212 clientes y 928 facturas**— y se arrancó el programa contra ellos:

```
✅ Módulo cargado: erp · store · disa · portal
🚀 Bamburu listo en http://localhost:3000
/admin/login del negocio restaurado → HTTP 200
```

> ⚠️ **Y por el camino, la prueba de por qué esta tarea existía.** El primer intento **NO arrancó**:
> `Missing API key ... new Resend(...)`. Sin `/etc/bamburu.env` el ERP no carga y —desde el cierre 7—
> **Bamburu se niega a arrancar y lo dice**. Con el entorno restaurado **de la propia copia**, levanta.
> Esa es, literalmente, la diferencia entre «tener los datos» y «poder volver».

## 10. Las dos pruebas en rojo, sobre el Drive de verdad

| Prueba | Resultado |
|---|---|
| Listar la carpeta subida **sin la llave** | nombres como `b3uripo95380lei02rq5isiei8/0vqub8u1kae6…` — **0 nombres reconocibles** |
| Bajar un objeto **en crudo** y mirarlo | empieza por `RCLONE\0\0` y sigue en binario; `grep` de `STRIPE`, `SQLite`, `ANTHROPIC`, `bamburu` → **0 coincidencias** |
| Listar con **la llave equivocada** | `Failed to lsf: directory not found` |
| Restaurar con **la llave equivocada** | 3 intentos, `Failed to copy` — **0 ficheros sacados** |

## 11. La comprobación automática: `scripts/gate-copias-cifradas.mjs` — 28 ✓ · 0 ✗

En el barrido (`infra` + RAPIDO, **5,6 s**). **Ejecuta el guion de copia de verdad** contra un
`crypt` montado sobre una carpeta local: sin red, sin Drive, sin tocar el servidor. Después
**mira los bytes del destino** buscando un canario literal — mirar el nombre no dice nada del
contenido.

**Probado en rojo, defensa por defensa:**

| Defensa desactivada a propósito | Resultado |
|---|---|
| El entorno viaja aunque el destino vaya **en claro** | 🔴 1 fallo |
| La copia deja de llevar el fichero de entorno | 🔴 3 fallos |
| Un entorno ilegible pasa a ser un aviso y la copia se da por buena | 🔴 3 fallos |
| El fallo deja de avisar por Telegram | 🔴 1 fallo |
| — restauradas — | ✅ 28 ✓ · 0 ✗ |

## 12. Lo que queda abierto, dicho sin maquillar

1. **⚠️ La llave pasó por esta conversación.** El activador la imprime una vez por pantalla —es su
   diseño, y así es como llega a Ibrahin—, pero al ejecutarlo yo, esa pantalla fue la sesión de
   Claude Code: la llave está en el transcript local (mismo servidor donde ya vive) **y viajó al
   proveedor de IA**. **Rotarla es barato AHORA y caro mañana**: hoy solo hay una copia subida con
   ella; en cuanto pasen unos días, rotar deja ilegible todo lo acumulado. Decisión de Ibrahin.
2. **319 copias antiguas siguen EN CLARO en Drive**, en el destino anterior. Y **ya no caducan
   solas**: la retención de 14 días apunta ahora al destino cifrado. Se retiran con
   `bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico --hazlo`, que copia, **verifica con
   `cryptcheck`** y solo entonces borra. **No se ejecuta sin orden expresa**: borra objetos de Drive.
3. **Ningún certificado existe todavía.** La carpeta `~/.secrets` se crea vacía y viaja vacía. Es lo
   correcto y está probado, pero conviene no confundirlo con «los certificados están respaldados».
