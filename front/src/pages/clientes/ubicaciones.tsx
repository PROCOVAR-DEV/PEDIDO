import { NavigationHeading } from "@/components/navigation-heading";
import { UbicacionesDudosas } from "@/components/clientes/ubicaciones-dudosas";

export default function UbicacionesClientesPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel/clientes", label: "Volver a Clientes" }}
        icon="client"
        paragraph="Clientes cuyo punto en el mapa no cae donde dice su dirección. Confirma los que están bien y corrige los que no."
        title="Ubicaciones por revisar"
      />

      <UbicacionesDudosas />
    </section>
  );
}
