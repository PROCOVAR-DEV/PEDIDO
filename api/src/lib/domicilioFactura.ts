// Qué pasa con el domicilio de un pedido en SU factura (issue #14). Puro y sin base de datos.
//
// El pedido marca que requiere domicilio y lleva un valor puesto (`costoDomicilio`, que puede ser 0), y la factura
// de Ventra puede traer o no la línea «ENTREGA A DOMICILIO». `facturaDomicilio` es null si la línea NO está, y un
// número (que puede ser 0) si está. Son dos errores distintos de quien factura:
//
//   falta       el pedido pidió domicilio, con su valor, y la factura no trae la línea: hay que añadirla.
//   sin_precio  la línea está pero vale 0 o no es lo puesto en Pedido: hay que corregir el precio.
//
// Un pedido que marca domicilio SIN valor todavía (null: Entrega aún no lo calculó) no entra: no hay con qué comparar
// y son la mayoría. Lo confirmó quien abrió el issue (06/11/2026).

export type EstadoDomicilioFactura = 'falta' | 'sin_precio' | null;

/** Una diferencia de menos de un centavo es redondeo, no un error. */
export const CENTAVO = 0.01;

export function estadoDomicilioFactura(p: {
  requiere_domicilio?: boolean | null;
  costoDomicilio?: number | null;
  facturaEstado?: string | null;
  facturaDomicilio?: number | null;
}): EstadoDomicilioFactura {
  // Sin domicilio marcado, o marcado pero sin valor puesto, no hay nada que comparar.
  if (p.costoDomicilio == null || !(p.requiere_domicilio === true || p.costoDomicilio > 0)) return null;
  // Sin factura todavía no se puede haber cobrado.
  if (p.facturaEstado !== 'igual' && p.facturaEstado !== 'cambiado') return null;
  if (p.facturaDomicilio == null) return 'falta';

  return Math.round(Math.abs(p.facturaDomicilio - p.costoDomicilio) * 100) >= CENTAVO * 100 ? 'sin_precio' : null;
}
