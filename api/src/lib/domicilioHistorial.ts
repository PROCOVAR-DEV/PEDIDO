// Qué se apunta en el historial del pedido cuando cambia el cálculo del domicilio que sube Entrega.
// Puro y sin base de datos, para probarlo solo.

const importe = (v: number | null | undefined) => (v == null ? 'sin costo' : String(Math.round(v * 100) / 100));

/**
 * Cuándo y cómo cambió el cálculo del domicilio que sube Entrega, al historial del pedido.
 *
 * Solo apunta lo que CAMBIÓ de verdad: la APK reintenta y manda lo mismo muchas veces, y una fila por
 * intento taparía la que importa. Lo que interesa saber: cuándo apareció el costo, si lo recalculó
 * con otro importe, y sobre todo cuándo Entrega pasó el pedido a «requiere domicilio» (o lo quitó).
 */
export type EstadoDomicilio = { marcado: boolean; costo: number | null; tasa: number | null };

/** Qué filas del historial salen de pasar de un estado del domicilio a otro. Puro, para probarlo solo. */
export function filasDeDomicilio(pedidoId: string, antes: EstadoDomicilio, despues: EstadoDomicilio) {
  const filas: Array<{ pedidoId: string; tipo: 'editado'; campo: string; antes: string; despues: string }> = [];

  if (antes.marcado !== despues.marcado) {
    filas.push({
      pedidoId, tipo: 'editado', campo: 'Requiere domicilio',
      antes: antes.marcado ? 'sí' : 'no', despues: despues.marcado ? 'sí' : 'no',
    });
  }
  if ((antes.costo ?? null) !== (despues.costo ?? null)) {
    filas.push({ pedidoId, tipo: 'editado', campo: 'Costo de domicilio', antes: importe(antes.costo), despues: importe(despues.costo) });
  }
  if ((antes.tasa ?? null) !== (despues.tasa ?? null)) {
    filas.push({ pedidoId, tipo: 'editado', campo: 'Tasa de cambio del domicilio', antes: importe(antes.tasa), despues: importe(despues.tasa) });
  }

  return filas;
}
