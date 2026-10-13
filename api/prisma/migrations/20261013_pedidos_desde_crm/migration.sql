-- Pedidos que llegan del CRM (POST /integration/crm/pedidos).
--
-- El folio del CRM (A001-20261013-000042) va en "folio", tal cual: el CRM sustituye a
-- Retool. crmPedidoId es el uuid del pedido en el CRM: con el folio, la llave de la
-- idempotencia (reenviar no duplica).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "crmPedidoId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_crmPedidoId_key" ON "Order"("crmPedidoId");
