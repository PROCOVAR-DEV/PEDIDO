// Qué se apunta en el historial del pedido cuando cambia su cotejo con la factura. Puro y sin base de datos.

export type EstadoFactura = { estado: string | null; numero: string | null };

const NOMBRE: Record<string, string> = {
  igual: 'facturado, igual al pedido',
  cambiado: 'facturado, distinto del pedido',
  sin_factura: 'sin factura',
};

const texto = (e: EstadoFactura) => `${e.estado ? (NOMBRE[e.estado] ?? e.estado) : 'sin cotejar'}${e.numero ? ` (factura ${e.numero})` : ''}`;

/**
 * La fila del historial por un cambio en el cotejo con la factura, o null si no hay nada que contar.
 *
 * No se apunta que un pedido recién llegado esté «sin factura»: son todos, y taparía lo que importa. Sí se
 * apunta cuando aparece la factura, cuando cambia su estado o su número, y cuando una factura que había
 * deja de encontrarse.
 */
export function filaDeFactura(
  pedidoId: string,
  antes: EstadoFactura,
  despues: EstadoFactura & { diferencias?: string[] },
) {
  if ((antes.estado ?? null) === (despues.estado ?? null) && (antes.numero ?? null) === (despues.numero ?? null)) return null;

  const habiaFactura = antes.estado === 'igual' || antes.estado === 'cambiado';
  const hayFactura = despues.estado === 'igual' || despues.estado === 'cambiado';

  if (!habiaFactura && !hayFactura) return null;

  return {
    pedidoId,
    tipo: 'editado' as const,
    campo: 'Factura',
    antes: texto(antes),
    despues: texto(despues),
    nota: despues.diferencias?.length ? despues.diferencias.slice(0, 2).join('; ').slice(0, 300) : null,
  };
}
