import { NavigationHeading } from "@/components/navigation-heading";
import { LiberacionPedidos } from "@/components/configuracion/liberacion-pedidos";
import { OrdersList } from "@/components/pedidos/order-list";

export default function LiberacionPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="calendar"
        paragraph="La hora de liberación de la sucursal y los pedidos que se están reteniendo"
        title="Liberación de pedidos"
      />

      <LiberacionPedidos />

      <OrdersList soloRetenidos />
    </section>
  );
}
