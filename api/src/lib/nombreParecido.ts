/**
 * Nombres de clientes que pueden ser el mismo escrito de otra manera: sin la etiqueta de ruta de
 * Santiago (`V6`, `M7`…) ni el tipo (`KIOSCO`, `CAFETERIA`). Se usa para reconocer al cliente que
 * el vendedor creó sin conexión cuando Parranda le pone código y nombre.
 *
 * Puro, para probarlo sin base de datos.
 */
const DE_TIPO = new Set([
  'kiosko', 'kiosco', 'cafeteria', 'tcp', 'cliente', 'eventual', 'punto', 'venta', 'ventas', 'casa', 'proyecto',
  'mipyme', 'mypime', 'mipime', 'del', 'las', 'los', 'una', 'con', 'por',
]);
const ETIQUETA_RUTA = /^(?:l|m|ma|mi|j|v|s|z|pp)\d{1,2}$/;

function palabras(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !DE_TIPO.has(w) && !ETIQUETA_RUTA.test(w));
}

/**
 * ¿Es el MISMO cliente? Aquí se FUSIONA, así que es exigente: dos palabras
 * con significado en común, o el nombre entero —si sólo tiene una palabra— dentro del otro.
 * `KIOSKO ALBERTO FABRE` y `KIOSKO GARCES FABRE` sólo comparten un apellido y pueden ser hermanos.
 */
export function esElMismoCliente(a: string, b: string): boolean {
  const A = new Set(palabras(a));
  const comunes = palabras(b).filter((w) => A.has(w));
  const distintas = new Set(comunes).size;

  return distintas >= 2 || (distintas >= 1 && Math.min(A.size, new Set(palabras(b)).size) === 1);
}

/**
 * De una lista de fichas SIN código, la ÚNICA que puede ser este cliente nuevo; si hay dos o
 * más, o ninguna, null: ante la duda se crea una ficha nueva, que es lo que siempre se hizo.
 *
 * Es el caso del cliente que el vendedor crea sin conexión (el archivo trae «NO CREADO») y que
 * Parranda después crea con su código y, a veces, otro nombre.
 */
export function unicaFichaParecida<T extends { id: string; nombre: string }>(nombre: string, fichas: T[]): T | null {
  const parecidas = fichas.filter((f) => esElMismoCliente(nombre, f.nombre));

  return parecidas.length === 1 ? parecidas[0] : null;
}
