-- Solo documenta: pedido-api arranca con `prisma db push`.
ALTER TABLE "Client" ADD COLUMN "vendedorAsignadoId" TEXT;
ALTER TABLE "Client" ADD COLUMN "bajaManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "bajaPor" TEXT;
ALTER TABLE "Client" ADD COLUMN "bajaEn" TIMESTAMP(3);
CREATE INDEX "Client_vendedorAsignadoId_idx" ON "Client"("vendedorAsignadoId");
