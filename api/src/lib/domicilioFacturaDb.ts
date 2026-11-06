import prisma from '../prismaClient';

/**
 * Los pedidos cuya factura SÍ trae la línea de domicilio pero a otro importe que el puesto en Pedido (o a 0
 * cuando Pedido pone algo): el caso `sin_precio` de `estadoDomicilioFactura`. Prisma no compara una columna con
 * otra con tolerancia, así que va por SQL; la regla es la misma, un centavo.
 *
 * @param sucursalId solo esa sucursal; sin él, todas.
 * @param desde      solo pedidos desde esa fecha, si se da.
 */
export async function idsConDomicilioSinPrecio(sucursalId?: string | null, desde?: Date): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Order"
     WHERE (${sucursalId ?? null}::text IS NULL OR "sucursalId" = ${sucursalId ?? null})
       AND (${desde ?? null}::timestamp IS NULL OR fecha >= ${desde ?? null})
       AND "facturaEstado" IN ('igual', 'cambiado')
       AND "deliveryCost" IS NOT NULL AND ("requiresDelivery" IS TRUE OR "deliveryCost" > 0)
       AND "facturaDomicilio" IS NOT NULL
       AND round(abs("facturaDomicilio" - "deliveryCost")::numeric, 2) >= 0.01`;

  return filas.map((f) => f.id);
}
