-- Solo documenta: pedido-api arranca con `prisma db push`.
CREATE TABLE IF NOT EXISTS "SellerLink" (
  "id" TEXT NOT NULL,
  "vendedorId" TEXT NOT NULL,
  "vendedorNombre" TEXT,
  "gestorAntesId" TEXT,
  "gestorAntes" TEXT,
  "gestorDespuesId" TEXT,
  "gestorDespues" TEXT,
  "por" TEXT,
  "motivo" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SellerLink_vendedorId_createdAt_idx" ON "SellerLink"("vendedorId", "createdAt");
