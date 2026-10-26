/**
 * Partir un rango de fechas en tramos de siete días, uno detrás de otro.
 *
 * Es para el repaso del mes: pedirle a Ventra el mes entero de un tirón la tiene ocupada un buen
 * rato y, como Ventra no pagina, se corta por el final sin decirlo. Por semanas cada consulta es
 * corta, y entre una y otra se deja una pausa.
 *
 * Va en su propio fichero, sin importar nada, para poder probarlo sin arrastrar Prisma.
 */
export function* tramosSemanales(desde: Date, hasta: Date): Generator<[Date, Date]> {
  const SEMANA = 7 * 86400000;

  for (let ini = desde.getTime(); ini <= hasta.getTime(); ini += SEMANA) {
    // El fin es el último instante de la semana, no el comienzo de la siguiente: así el último día
    // no cae en dos tramos.
    yield [new Date(ini), new Date(Math.min(ini + SEMANA - 1, hasta.getTime()))];
  }
}
