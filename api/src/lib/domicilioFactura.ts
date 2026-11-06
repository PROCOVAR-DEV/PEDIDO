// Qué pasa con el domicilio de un pedido en SU factura (issue #14). Puro y sin base de datos.
//
// El pedido lleva un domicilio cotizado (`costoDomicilio`) y la factura de Ventra puede traer o no la línea
// «ENTREGA A DOMICILIO». `facturaDomicilio` es null si la línea NO está, y un número (que puede ser 0) si está.
// Son dos errores distintos de quien factura, y se corrigen de forma distinta:
//
//   falta       la línea no se creó: hay que añadirla.
//   sin_precio  la línea está pero vale 0 o no es lo cotizado en Pedido: hay que corregir el precio.

export type EstadoDomicilioFactura = 'falta' | 'sin_precio' | null;

/** Una diferencia de menos de un centavo es redondeo, no un error. */
const CENTAVO = 1;

export function estadoDomicilioFactura(p: {
  costoDomicilio?: number | null;
  facturaEstado?: string | null;
  facturaDomicilio?: number | null;
}): EstadoDomicilioFactura {
  const costo = p.costoDomicilio ?? 0;

  // Sin domicilio cotizado no hay nada que cobrar, y sin factura todavía no se puede haber cobrado.
  if (!(costo > 0)) return null;
  if (p.facturaEstado !== 'igual' && p.facturaEstado !== 'cambiado') return null;
  if (p.facturaDomicilio == null) return 'falta';

  const cobrado = p.facturaDomicilio;

  if (!(cobrado > 0)) return 'sin_precio';

  return Math.round(Math.abs(cobrado - costo) * 100) >= CENTAVO ? 'sin_precio' : null;
}
