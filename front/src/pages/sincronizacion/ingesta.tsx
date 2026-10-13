import { NavigationHeading } from "@/components/navigation-heading";
import { IngestaPanel } from "@/components/sincronizacion/ingesta-panel";
import { useAuthStore } from "@/stores/authStore";
import { esRolGlobal } from "@/lib/rol-global";

/**
 * Los archivos que n8n manda a PEDIDO, con lo que pasó con cada uno.
 *
 * Es para COMPROBAR, igual que las otras de sincronización, y sólo para el super
 * administrador: es la ingesta de todas las sucursales a la vez.
 */
export default function SincronizacionIngestaPage() {
  const { user } = useAuthStore();

  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-8">
      <NavigationHeading
        cta={{ href: "/panel/configuracion", label: "Volver a Configuración" }}
        icon="reports"
        paragraph="Cada archivo que llega de las carpetas del Drive, con lo que pasó: si entró, si alguna fila falló o por qué lo rechazó PEDIDO. Los rechazados son los que n8n deja en «Errores»."
        title="Sincronización · Ingesta"
      />
      {esRolGlobal(user?.role) ? (
        <IngestaPanel />
      ) : (
        <p className="text-default-500">Esta pantalla es sólo para el super administrador.</p>
      )}
    </section>
  );
}
