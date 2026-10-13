/**
 * ¿Pueden ser el mismo cliente dos nombres? Se usa antes de RENOMBRAR una ficha al nombre que
 * Parranda le da a su código: si no comparten ni una palabra con significado (`PUNTO DE VENTA
 * CARRETERA DEL VALLE` frente a `CAFETERIA AMAURI`), el código está mal puesto en alguno de los dos
 * lados y renombrar sólo propagaría el error. Con la etiqueta de ruta de Santiago de más (`V6`,
 * `M7`…) o un prefijo de tipo (`KIOSCO`), sí son el mismo.
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

export function comparteNombre(a: string, b: string): boolean {
  const de = new Set(palabras(a));

  return palabras(b).some((w) => de.has(w));
}
