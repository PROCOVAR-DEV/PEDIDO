/**
 * Qué fila de Parranda se APLICA cuando varias caen en la misma ficha.
 *
 * Parranda manda 12.049 filas para 8.850 clientes: nombres repetidos con códigos distintos,
 * o el mismo código con la dirección escrita de dos maneras. Escribir cada fila según llega
 * dejaba la ficha oscilando: la primera fila la cambiaba y la segunda la devolvía, en cada
 * pasada, y «Qué cambió» enseñaba como cambios las mismas ~250 fichas de siempre.
 *
 * Aquí se decide UNA fila por ficha, y se escribe una vez:
 *   1. la que ya lleva el código de la ficha, y de ésas la que además tiene SU nombre (no hay
 *      nada que cambiar, y por eso es estable aunque Parranda cambie el orden de las filas);
 *   2. si no, la última, que es lo que quedaba guardado hasta ahora.
 *
 * Puro, para probarlo sin base de datos.
 */
export function filasGanadoras<F extends { codigo: string | null }, C extends { id: string; codigo: string | null }>(
  filas: F[],
  fichaDe: (fila: F) => C | undefined,
  tieneSuNombre: (fila: F, ficha: C) => boolean = () => false,
): Set<number> {
  const porFicha = new Map<string, { ficha: C; indices: number[] }>();

  filas.forEach((fila, i) => {
    const ficha = fichaDe(fila);
    if (!ficha) return;

    const grupo = porFicha.get(ficha.id) ?? { ficha, indices: [] };
    grupo.indices.push(i);
    porFicha.set(ficha.id, grupo);
  });

  const ganadoras = new Set<number>();

  for (const { ficha, indices } of porFicha.values()) {
    const conSuCodigo = ficha.codigo ? indices.filter((i) => filas[i].codigo === ficha.codigo) : [];
    const conSuNombre = conSuCodigo.filter((i) => tieneSuNombre(filas[i], ficha));
    ganadoras.add((conSuNombre.length ? conSuNombre : conSuCodigo.length ? conSuCodigo : indices).at(-1)!);
  }

  return ganadoras;
}
