-- Solo documenta: pedido-api arranca con `prisma db push`. PURAMENTE ADITIVA: una tabla
-- nueva; no toca ni borra ninguna columna ni índice existente, así que `db push` no pide
-- --accept-data-loss.
CREATE TABLE IF NOT EXISTS "EntregaDeFactura" (
  "id" TEXT NOT NULL,
  "pedidoId" TEXT NOT NULL,
  "factura" TEXT NOT NULL,
  "puntoDeVenta" TEXT NOT NULL DEFAULT '',
  "estado" TEXT NOT NULL,
  "nota" TEXT,
  "at" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntregaDeFactura_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EntregaDeFactura_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EntregaDeFactura_pedidoId_factura_puntoDeVenta_key" ON "EntregaDeFactura"("pedidoId", "factura", "puntoDeVenta");
