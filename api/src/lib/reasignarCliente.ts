/**
 * Reasignar un cliente a otro vendedor: «borrón y cuenta nueva».
 *
 * Lo YA HECHO se queda con el vendedor de entonces —lo que se le realizó—: los pedidos
 * completados (y expirados) no se tocan. Solo los pedidos ABIERTOS (`en_proceso`) pasan al
 * vendedor nuevo, porque los va a atender él. De ahí en adelante el cliente es suyo
 * (`Cliente.vendedorAsignadoId`).
 */
export type PedidoDelCliente = {
  id: string;
  vendedorId: string | null;
  vendedorNombre: string | null;
  estado: string | null;
};

export type PlanReasignacion = {
  /** Los pedidos abiertos que cambian de vendedor. */
  mover: PedidoDelCliente[];
  /** Los abiertos que ya eran del vendedor nuevo. */
  yaSuyos: number;
};

export const ESTADO_ABIERTO = 'en_proceso';

export function planReasignacion(pedidos: PedidoDelCliente[], vendedorNuevoId: string): PlanReasignacion {
  const abiertos = pedidos.filter((p) => p.estado === ESTADO_ABIERTO);
  const mover = abiertos.filter((p) => p.vendedorId !== vendedorNuevoId);

  return { mover, yaSuyos: abiertos.length - mover.length };
}

/**
 * Quién puede reasignar: Supervisor y todo lo de arriba (Gerente, Administrador y los roles
 * globales). Gestor y Operador no. Es el rol de Accesos, escrito EXACTAMENTE así.
 */
const ROLES_QUE_REASIGNAN = new Set(['SUPERVISOR', 'GERENTE', 'ADMINISTRADOR', 'SUPER ADMIN', 'DESARROLLADOR']);

export function puedeReasignar(role: string | undefined | null, esGlobal: boolean): boolean {
  return esGlobal || ROLES_QUE_REASIGNAN.has(String(role || '').toUpperCase());
}
