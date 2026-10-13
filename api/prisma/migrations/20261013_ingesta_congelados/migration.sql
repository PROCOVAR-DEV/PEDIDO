-- Pedidos completados que un archivo volvió a traer y no se tocaron.
ALTER TABLE "ImportFile" ADD COLUMN IF NOT EXISTS "congelados" INTEGER NOT NULL DEFAULT 0;
