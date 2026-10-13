-- Cada archivo que llega a /orders/bulk, con lo que pasó (ver `ImportacionArchivo`).
--
-- Se creó para la pantalla Configuración → Sincronizadores → Ingesta: n8n mueve a «Errores»
-- los archivos que PEDIDO rechaza y nadie sabía cuál ni por qué.
CREATE TABLE IF NOT EXISTS "ImportFile" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "archivo"      TEXT,
  "sucursalId"   TEXT,
  "fuente"       TEXT,
  "origen"       TEXT NOT NULL,
  "estado"       TEXT NOT NULL,
  "estadoHttp"   INTEGER NOT NULL,
  "filas"        INTEGER NOT NULL DEFAULT 0,
  "creados"      INTEGER NOT NULL DEFAULT 0,
  "actualizados" INTEGER NOT NULL DEFAULT 0,
  "fallidos"     INTEGER NOT NULL DEFAULT 0,
  "omitidos"     INTEGER NOT NULL DEFAULT 0,
  "motivo"       TEXT,
  "ms"           INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ImportFile_createdAt_idx" ON "ImportFile"("createdAt");
CREATE INDEX IF NOT EXISTS "ImportFile_sucursalId_createdAt_idx" ON "ImportFile"("sucursalId", "createdAt");
CREATE INDEX IF NOT EXISTS "ImportFile_estado_createdAt_idx" ON "ImportFile"("estado", "createdAt");
