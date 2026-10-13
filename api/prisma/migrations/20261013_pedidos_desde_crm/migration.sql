-- Pedidos que llegan del CRM (POST /integration/crm/pedidos).
--
-- crmPedidoId: el uuid del pedido en el CRM. Llave de la idempotencia: reenviar no duplica.
-- folioCrm:    el folio del CRM (A001-20261013-000042), como referencia externa ÚNICA.
--              El `folio` del pedido sigue siendo de PEDIDO (CRM26-261013-17): el cotejo
--              con Ventra sólo reconoce folios con la forma de Retool.
-- CrmFolioCounter: el número del día de esos folios.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "crmPedidoId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "folioCrm" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_crmPedidoId_key" ON "Order"("crmPedidoId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_folioCrm_key" ON "Order"("folioCrm");

CREATE TABLE IF NOT EXISTS "CrmFolioCounter" (
  "dia"    TEXT NOT NULL PRIMARY KEY,
  "ultimo" INTEGER NOT NULL DEFAULT 0
);
