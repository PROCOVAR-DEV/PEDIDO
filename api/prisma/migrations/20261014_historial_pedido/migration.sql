-- Historial de cada pedido: cuándo, quién y por qué vía se creó, se editó, se completó o se reabrió.
CREATE TABLE IF NOT EXISTS "OrderHistory" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tipo" TEXT NOT NULL,
  "por" TEXT,
  "origen" TEXT NOT NULL,
  "archivo" TEXT,
  "fuente" TEXT,
  "campo" TEXT,
  "antes" TEXT,
  "despues" TEXT,
  "nota" TEXT,
  CONSTRAINT "OrderHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OrderHistory_orderId_at_idx" ON "OrderHistory"("orderId", "at");
