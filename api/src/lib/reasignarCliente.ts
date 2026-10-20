/**
 * Reasignar un cliente a otro vendedor.
 *
 * En PEDIDO el cliente no tiene vendedor propio: «es de un vendedor» solo porque tiene pedidos
 * suyos. Reasignarlo es, por tanto, pasar esos pedidos al vendedor nuevo.
 */
export type PedidoDelCliente = { id: string; vendedorId: string | null; vendedorNombre: string | null };

export type PlanReasignacion = {
  /** Los pedidos que cambian de vendedor. */
  mover: PedidoDelCliente[];
  /** Los que ya eran del vendedor nuevo. */
  yaSuyos: number;
};

/**
 * `desdeVendedorId` limita el cambio a los pedidos de UN vendedor; sin él se mueven todos los
 * que no sean ya del nuevo. Los de otro vendedor quedan como estaban.
 */
export function planReasignacion(
  pedidos: PedidoDelCliente[],
  vendedorNuevoId: string,
  desdeVendedorId?: string | null,
): PlanReasignacion {
  const candidatos = desdeVendedorId ? pedidos.filter((p) => p.vendedorId === desdeVendedorId) : pedidos;
  const mover = candidatos.filter((p) => p.vendedorId !== vendedorNuevoId);

  return { mover, yaSuyos: candidatos.length - mover.length };
}
