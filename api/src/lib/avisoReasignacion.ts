import prisma from '../prismaClient';
import { avisarAlReparto } from './avisoAlReparto';

/** Hasta aquí se avisa cliente por cliente; por encima, un solo «repasa esa sucursal». */
const TOPE_AVISOS = 50;

/**
 * Después de reasignar clientes a otro vendedor: que el resto de sistemas se entere.
 *
 * El vendedor de un cliente se calcula con sus pedidos, así que `GET /integration/clients` ya
 * dice el nuevo. Pero Entrega sincroniza por `since` (la ficha del cliente) y por los avisos de
 * cliente, y mover pedidos no toca ninguna de las dos cosas: sin esto seguiría con el vendedor
 * de antes. Se toca `updatedAt` y se avisa. No lanza: lo reasignado ya está guardado.
 */
export async function avisarReasignacion(clienteIds: string[], sucursalId: string | null): Promise<void> {
  if (clienteIds.length === 0) return;

  try {
    await prisma.cliente.updateMany({ where: { id: { in: clienteIds } }, data: { updatedAt: new Date() } });
  } catch (e) {
    console.error('[reasignar] no se pudo tocar updatedAt:', (e as Error)?.message);
  }

  if (clienteIds.length > TOPE_AVISOS) {
    avisarAlReparto({ sucursalId, entidad: 'cliente', motivo: 'cliente', accion: 'bulk' });

    return;
  }

  for (const id of clienteIds) {
    avisarAlReparto({ id, sucursalId, entidad: 'cliente', motivo: 'cliente', accion: 'update' });
  }
}
