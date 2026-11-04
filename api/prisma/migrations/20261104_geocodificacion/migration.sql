-- Solo documenta: pedido-api arranca con `prisma db push`.
CREATE TABLE IF NOT EXISTS "ClienteGeocodificacion" (
  "clienteId" TEXT PRIMARY KEY,
  "latitud" DOUBLE PRECISION NOT NULL,
  "longitud" DOUBLE PRECISION NOT NULL,
  "calle" TEXT, "barrio" TEXT, "municipios" TEXT, "provincia" TEXT, "completo" TEXT,
  "consultadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "adelanteConsultado" BOOLEAN NOT NULL DEFAULT false,
  "adelanteLat" DOUBLE PRECISION, "adelanteLon" DOUBLE PRECISION, "adelanteAt" TIMESTAMP(3)
);
