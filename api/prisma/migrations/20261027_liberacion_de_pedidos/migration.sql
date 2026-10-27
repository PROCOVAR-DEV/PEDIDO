-- Solo documenta: pedido-api arranca con `prisma db push`.
ALTER TABLE "Sucursal" ADD COLUMN IF NOT EXISTS "liberacionActiva" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Sucursal" ADD COLUMN IF NOT EXISTS "liberacionAyerHasta" INTEGER NOT NULL DEFAULT 510;
ALTER TABLE "Sucursal" ADD COLUMN IF NOT EXISTS "liberacionHoyDesde" INTEGER NOT NULL DEFAULT 900;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "visibleDesde" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Order_visibleDesde_idx" ON "Order"("visibleDesde");
