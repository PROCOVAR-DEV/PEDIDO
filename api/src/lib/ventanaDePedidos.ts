/**
 * Desde qué momento se miran los PEDIDOS: el comienzo (UTC) del día que queda `dias` atrás.
 *
 * Antes era «ahora menos 72 horas» exactas, y eso deja fuera pedidos DE LOS ÚLTIMOS TRES DÍAS: uno del
 * viernes a mediodía, facturado el lunes por la tarde, cae unas horas fuera de la ventana y no lo ve
 * ni el carril rápido ni la pasada completa (26/10/2026: PAL26-261023-1108, de Santiago). Los
 * pedidos se guardan con la fecha del día a media jornada, así que contar DÍAS ENTEROS es lo que
 * corresponde. Exportada y pura para poder probarla.
 */
export function inicioDeVentanaDePedidos(ahora: Date, dias: number): Date {
  const atras = new Date(ahora.getTime() - dias * 86400000);

  return new Date(Date.UTC(atras.getUTCFullYear(), atras.getUTCMonth(), atras.getUTCDate()));
}
