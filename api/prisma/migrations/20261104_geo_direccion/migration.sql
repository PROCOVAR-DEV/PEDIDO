-- Solo documenta: pedido-api arranca con `prisma db push`.
-- Issue #13: comparar el punto del cliente con su dirección.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "geoEstado" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "geoDistanciaKm" DOUBLE PRECISION;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "geoVecinoId" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "geoEvaluadoAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "geoRevisadoPor" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "geoRevisadoAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "geoMotivo" TEXT;
CREATE INDEX IF NOT EXISTS "Client_sucursalId_geoEstado_idx" ON "Client"("sucursalId", "geoEstado");
