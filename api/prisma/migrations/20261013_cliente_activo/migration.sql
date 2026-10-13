-- Cliente activo o inactivo (ver `Cliente.activo`).
--
-- Parranda desactiva clientes dejando de mandarlos; PEDIDO no lo sabía y los seguía teniendo
-- como vivos. Todos los que hay hoy quedan activos: la primera sincronización con Parranda
-- decide cuáles ya no lo son.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "desactivadoAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Client_activo_idx" ON "Client"("activo");

-- La ficha viva que sustituye a esta (mismo cliente, ficha nueva). Nulo si nadie la sustituye.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "sucesorId" TEXT;
