-- Solo documenta: pedido-api arranca con `prisma db push`.
ALTER TABLE "Client" ADD COLUMN "crmId" TEXT;
CREATE UNIQUE INDEX "Client_crmId_key" ON "Client"("crmId");
ALTER TABLE "Seller" ADD COLUMN "accesosId" TEXT;
CREATE UNIQUE INDEX "Seller_accesosId_key" ON "Seller"("accesosId");
