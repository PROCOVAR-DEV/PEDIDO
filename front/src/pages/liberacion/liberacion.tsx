import { NavigationHeading } from "@/components/navigation-heading";
import {
  LiberacionExplicacion,
  LiberacionPedidos,
  useReglaLiberacion,
} from "@/components/configuracion/liberacion-pedidos";
import { OrdersList } from "@/components/pedidos/order-list";

export default function LiberacionPage() {
  // Una sola carga de la regla, compartida por la tarjeta y la explicación.
  const regla = useReglaLiberacion();

  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="calendar"
        paragraph="Pedidos que esperan su hora de liberación"
        title="Liberación de pedidos"
      />

      {/* La regla y los filtros comparten fila: son controles pequeños. */}
      <OrdersList
        soloRetenidos
        debajoDeFiltros={<LiberacionExplicacion regla={regla} />}
        junto={<LiberacionPedidos regla={regla} />}
      />
    </section>
  );
}
