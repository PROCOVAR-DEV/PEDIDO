import { Link } from "react-router-dom";

import { ClientesList } from "@/components/clientes/clientes-list";
import { NavigationHeading } from "@/components/navigation-heading";

export default function ClientesPage() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <NavigationHeading
        cta={{ href: "/panel", label: "Ir a Panel de Control" }}
        icon="client"
        paragraph="Visualizar los clientes de la subursal"
        title="Clientes"
      />

      <p className="text-sm">
        <Link
          className="text-primary underline"
          to="/panel/clientes/ubicaciones"
        >
          Ubicaciones por revisar
        </Link>{" "}
        — clientes cuyo punto no cae donde dice su dirección.
      </p>

      <ClientesList />
    </section>
  );
}
