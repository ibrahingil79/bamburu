// scripts/lib/copia-consistente.mjs
//
// COPIAR UNA BASE EN MODO WAL CON `cp` SE LLEVA UNA FOTO VIEJA.
//
// Los negocios de Bamburu corren en WAL: los últimos cambios confirmados viven en el fichero `-wal`
// hasta que alguien hace checkpoint. `copyFileSync('...db', destino)` copia SOLO el `.db`, así que
// la comprobación acaba midiendo un pasado — y no uno cualquiera, sino uno que cambia según cuándo
// tocó el último checkpoint. De ahí salen los rojos que van y vienen sin que nadie toque el código.
//
// Cazado el 24 ago 2026 en verify-contabilidad-backfill: el original leído con su WAL daba desfase 0
// y un `cp` del mismo fichero, en el mismo instante, daba 654,00 €. La comprobación llevaba días
// acusando al libro de compras de un descuadre de 327,00 € que no existía.
//
// Lo grave no es el rojo falso: es el VERDE falso. Una comprobación que lee una foto anterior puede
// dar por buena una cadena, un libro o un saldo que ya no es el que hay.
//
// `.backup` de sqlite copia la base entera —WAL incluido— y de forma consistente aunque alguien esté
// escribiendo. Es la única forma correcta de llevarse un negocio a un temporal.

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

export function copiarBase(origen, destino) {
  if (!existsSync(origen)) throw new Error('copiarBase: no existe el origen ' + origen);
  execFileSync('sqlite3', [origen, ".backup '" + destino + "'"]);
  if (!existsSync(destino)) throw new Error('copiarBase: .backup no dejó nada en ' + destino);
  return destino;
}
