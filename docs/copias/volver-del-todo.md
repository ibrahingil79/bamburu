# Volver del todo — el procedimiento, en orden

> **Para qué es esto.** Para el día en que este servidor no exista. No es «recuperar unos datos»: es
> levantar Bamburu entero desde cero con lo que hay en Drive. Escrito el 3 sep 2026 (AUD-008) y
> **probado**: el simulacro de §5 se ejecutó de verdad, no se supone.
>
> ⚠️ **Lo primero, y sin ello nada de lo demás sirve: LA LLAVE.** Las copias van cifradas. La llave
> **no está en las copias** —no puede estarlo— ni en el servidor de repuesto ni en el repositorio.
> Está donde Ibrahin la guardó el 3 de septiembre de 2026: **su gestor de contraseñas**. Son dos
> cadenas, `Contraseña` y `Sal`. Sin ellas, lo que hay en Drive es ruido y no hay forma de leerlo.

---

## 0. Lo que hace falta tener a mano

| Qué | Dónde está |
|---|---|
| **La llave** (contraseña + sal) | Gestor de contraseñas de Ibrahin. **Fuera del servidor, a propósito** |
| Acceso a una de las dos cuentas de Drive | `ibrahingil@gmail.com` (principal) o `gilibrahin@gmail.com` (secundaria) |
| Una máquina con `rclone`, `node` 22 y `sqlite3` | cualquiera |
| El repositorio | GitHub, `ibrahingil79/bamburu` |

**Hay DOS copias, en dos cuentas distintas.** Si una falla, la otra vale igual: son independientes y
llevan lo mismo. La principal está en `Bamburu-backup-cif`; la secundaria, en
`Bamburu-backup-gili-cif`.

---

## 1. Reconstruir el acceso a la copia (esto es lo que la llave desbloquea)

En la máquina nueva, con `rclone` instalado:

```bash
rclone config create gdrive drive            # autoriza la cuenta de Google en el navegador
rclone config create gdrive_cif crypt \
  remote=gdrive:Bamburu-backup-cif \
  password="$(printf '%s' 'LA CONTRASEÑA' | rclone obscure -)" \
  password2="$(printf '%s' 'LA SAL'        | rclone obscure -)" \
  filename_encryption=standard directory_name_encryption=true
```

**Comprobación inmediata de que la llave es la buena:** `rclone lsf gdrive_cif:daily` tiene que
**listar nombres legibles** (`control-2026-09-03.db`, `entorno-2026-09-03.tar.gz`…). Si la llave
fuera otra, la orden **no falla con un mensaje claro: devuelve una lista vacía o salta los ficheros**
— eso ya es la respuesta: la llave no es esa.

*(Para la secundaria, lo mismo con `gdrive_gili` y `Bamburu-backup-gili-cif`.)*

---

## 2. Bajarlo todo

```bash
mkdir -p ~/vuelta && rclone copy gdrive_cif:daily ~/vuelta -P
ls -la ~/vuelta
```

Debe haber, con la fecha del día:

- `control-<fecha>.db` — **la base de enrutado**: qué negocios existen y en qué fichero vive cada uno.
- `<slug>-<fecha>.db` — **una por negocio**.
- `uploads-<fecha>.tar.gz` — los ficheros que subió la gente (logotipos, adjuntos).
- `entorno-<fecha>.tar.gz` — **la configuración y los certificados**. Sin esto hay datos y nada con
  qué levantarlos.

---

## 3. El entorno y los certificados, PRIMERO

```bash
mkdir -p ~/vuelta/entorno && tar -xzf ~/vuelta/entorno-<fecha>.tar.gz -C ~/vuelta/entorno
cat ~/vuelta/entorno/LEEME-PARA-VOLVER.txt

sudo install -o ubuntu -g ubuntu -m 600 ~/vuelta/entorno/bamburu.env /etc/bamburu.env
mkdir -p ~/.secrets && chmod 700 ~/.secrets
cp -a ~/vuelta/entorno/certificados/. ~/.secrets/ 2>/dev/null || true
chmod 600 ~/.secrets/* 2>/dev/null || true
```

Va primero **porque sin `/etc/bamburu.env` el ERP no carga y, desde el cierre 7, Bamburu no arranca
en absoluto** — se para y lo dice, en vez de levantar a medias.

> **Sobre los certificados:** a 3 sep 2026 **no hay ninguno** (el `.p12` de Verifactu se borró del
> servidor a propósito tras las pruebas de julio). La carpeta viaja igual, vacía, para que el día que
> exista uno entre en la copia sin que nadie tenga que acordarse.

---

## 4. Los datos, y levantar

```bash
git clone git@github.com:ibrahingil79/bamburu.git && cd bamburu && npm ci
mkdir -p data/tenants
cp ~/vuelta/control-<fecha>.db data/control.db
for f in ~/vuelta/*-<fecha>.db; do
  b="$(basename "$f" -<fecha>.db)"; [ "$b" = control ] && continue
  cp "$f" "data/tenants/$b.db"
done
tar -xzf ~/vuelta/uploads-<fecha>.tar.gz -C data/

# Que cada base abre de verdad:
for f in data/control.db data/tenants/*.db; do echo -n "$f: "; sqlite3 "$f" 'PRAGMA integrity_check;'; done

sudo systemctl start bamburu
```

⚠️ **`control.db` manda:** sus filas dicen en qué fichero vive cada negocio. Si un `.db` de negocio
no se llama como espera `control.db`, ese negocio **no existe** para Bamburu aunque el fichero esté.

---

## 5. Comprobar que ha vuelto, y no solo que abre

- `systemctl is-active bamburu` → `active`. Si un módulo esencial faltara, **no arrancaría** y lo
  diría con el motivo (cierre 7).
- Abrir `/admin` de un negocio y **mirar una factura**, no solo la lista.
- `node scripts/desplegar.mjs --verificar`.

**Esto se ensaya, no se supone:** `scripts/gate-copias-cifradas.mjs` monta cada pasada un destino
cifrado de mentira, hace una copia, la restaura y **comprueba que con la llave equivocada no se
puede** — y `scripts/ensayo-restauracion-cifrada.sh` hace lo mismo contra el Drive de verdad.

---

## 6. Lo que NO está en la copia, dicho aquí para que nadie lo busque

| Qué | Por qué y de dónde sale |
|---|---|
| **La llave de cifrado** | No puede viajar dentro de lo que cifra. Gestor de contraseñas de Ibrahin |
| El código | En GitHub. La copia es de datos y configuración, no del repositorio |
| Las credenciales de Google de `rclone` | Se rehacen con `rclone config create` (§1), autorizando la cuenta |
| Los certificados de Verifactu | **Hoy no existe ninguno.** El día que se emita uno, va a `~/.secrets` y entra solo |
| `/etc/orquestador.env` | Es del orquestador, que está parado. No hace falta para levantar Bamburu |
