import { NavigationHeading } from "@/components/navigation-heading";
import { useDashboard } from "@/providers/DashboardProvider";
import {
  AccesoRapido,
  GrupoAccesos,
} from "@/components/dashboard/acceso-rapido";
import {
  HoyPanel,
  RetenidosCard,
  fechaDeHoy,
  haceCuanto,
} from "@/components/dashboard/hoy-panel";
import { useHoy } from "@/components/dashboard/use-hoy";
import { getSucursalActiva } from "@/lib/sucursal-activa";
import { LineChartCard } from "@/components/dashboard/LineChartCard";
import { useAuthStore } from "@/stores/authStore";
import { esRolGlobal } from "@/lib/rol-global";
import { useLiveEvents } from "@/hooks/use-live-events";

export default function PanelPage() {
  const { user, session } = useAuthStore();
  const { stats, isLoading, error, refetch } = useDashboard();
  const sucursalNombre = user?.sucursal || "";
  const isSuperAdmin = Boolean(session?.isGlobalAdmin);

  // RBAC de accesos rápidos: el GESTOR solo ve LO SUYO (pedidos, importar, clientes,
  // su perfil con sus métricas). No ve Vendedores/Usuarios/Reportes (datos ajenos).
  const role = String(user?.role || "").toLowerCase();
  const isGestor = role === "gestor";
  // El OPERADOR entra aquí a diario: es quien factura, y para facturar necesita
  // copiar el nombre del vendedor de esta vista y pegarlo en el sistema
  // contable. Es, de hecho, quien más la usa. Se quedó fuera de esta lista
  // cuando se le dio acceso a la vista (la ruta y el api ya se lo permitían):
  // el resultado era un Operador con permiso para entrar pero sin ninguna
  // puerta por la que hacerlo.
  //
  // Lo que NO puede hacer —dar de alta o de baja, reasignar el gestor, ver el
  // detalle— se lo quita la propia vista, y el servidor rechaza esas rutas para
  // su rol. Entrar a leer y copiar es justo para lo que está.
  const canVerVendedores =
    esRolGlobal(user?.role) ||
    ["administrador", "supervisor", "operador"].includes(role);
  // Liberación de pedidos por hora: los mismos que acepta el servidor.
  const puedeLiberar =
    esRolGlobal(user?.role) ||
    ["administrador", "supervisor", "gerente"].includes(role);
  const canManageUsers = esRolGlobal(user?.role) || role === "administrador";
  // La OPERADORA factura: ve todos los pedidos de SU sucursal, sus vendedores y
  // sus clientes, y copia los codigos al sistema contable. Lo que no hace es
  // meter datos ni sacar informes — subir el CSV de Parranda y los reportes no
  // son suyos. Ocultar la tarjeta es comodidad; quien lo impide de verdad es la
  // ruta y el servidor.
  const esOperador = role === "operador";
  const puedeImportar = !esOperador && !isGestor;
  const puedeVerReportes = !esOperador && !isGestor;

  // Lo de HOY: cada bloque se pide sólo si el rol lo recibe. El resumen de facturación
  // sigue la misma regla que Reportes (ni Operador ni Gestor).
  const activeSucursalId = session?.isGlobalAdmin
    ? getSucursalActiva()
    : session?.sucursalId;
  const hoy = useHoy({
    verResumen: puedeVerReportes,
    verRetenidos: puedeLiberar,
    hayRegla: !!activeSucursalId,
  });

  // El provider ya pide las estadísticas al montarse: volver a pedirlas aquí
  // duplicaba la petición en cada entrada al panel. Con enlaces lentos eso es
  // medio segundo de más por nada.

  // EN VIVO (SSE): las estadísticas se refrescan solas al entrar/completar pedidos.
  // En SEGUNDO PLANO (segundo argumento): los números se sustituyen cuando llegan,
  // sin volver a los skeletons. Antes cada evento dejaba el panel en blanco, y
  // durante una importación eso ocurría decenas de veces por minuto.
  // Lo de hoy se refresca igual, juntando las ráfagas.
  useLiveEvents(["pedido"], () => {
    refetch(undefined, true);
    hoy.recargarEnFondo();
  });

  const pasada = hoy.resumen?.ultimaPasada;

  return (
    <section className="flex flex-col gap-6">
      <NavigationHeading
        cta={{ href: "/", label: "Ir al Inicio" }}
        icon="locales"
        paragraph={
          <>
            {fechaDeHoy()}
            {pasada && ` · Facturas comprobadas ${haceCuanto(pasada.cuando)}`}
          </>
        }
        title={
          sucursalNombre
            ? `Sucursal ${sucursalNombre} - Panel de Control`
            : "Panel de Control"
        }
      />

      {/* HOY y los totales en un bloque; lo retenido al lado, sólo para quien puede liberar. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={puedeLiberar ? "lg:col-span-2" : "lg:col-span-3"}>
          <HoyPanel
            cargando={hoy.cargando}
            cargandoTotales={isLoading}
            error={hoy.error}
            errorTotales={error}
            resumen={hoy.resumen}
            totales={
              stats
                ? {
                    total: stats.totalPedidos,
                    completados: stats.pedidosCompletados,
                    enProceso: stats.pedidosEnProceso,
                    expirados: stats.pedidosExpirados,
                  }
                : null
            }
            verResumen={puedeVerReportes}
            onReintentar={() => void hoy.recargar()}
          />
        </div>
        {puedeLiberar && (
          <RetenidosCard
            cargando={hoy.cargando}
            regla={hoy.regla}
            retenidos={hoy.retenidos}
            todas={!activeSucursalId}
          />
        )}
      </div>

      {/* Accesos: baldosas compactas por grupo. La visibilidad por rol es la de siempre. */}
      <div className="flex flex-col gap-4">
        <GrupoAccesos titulo="Trabajo diario">
          <AccesoRapido
            color="primary"
            description="Ver y gestionar los pedidos"
            href="/panel/panel-pedidos"
            icon="pedido"
            title="Pedidos"
          />
          {puedeImportar && (
            <AccesoRapido
              color="primary"
              description="Archivo CSV de Parranda"
              href="/panel/panel-pedidos/nuevo"
              icon="add"
              title="Importar pedido"
            />
          )}
          <AccesoRapido
            color="secondary"
            description="Clientes del sistema"
            href="/panel/clientes"
            icon="client"
            title="Clientes"
          />
          {canVerVendedores && (
            <AccesoRapido
              color="secondary"
              description="Vendedores del sistema"
              href="/panel/trabajadores"
              icon="workers"
              title="Vendedores"
            />
          )}
          {isGestor && (
            <AccesoRapido
              color="primary"
              description="Tus métricas y tus datos"
              href="/panel/mi-perfil"
              icon="user"
              title="Mi perfil"
            />
          )}
        </GrupoAccesos>
        <GrupoAccesos titulo="Control">
          {puedeVerReportes && (
            <AccesoRapido
              color="danger"
              description="Generar y exportar reportes"
              href="/panel/reportes"
              icon="reports"
              title="Reportes"
            />
          )}
          {puedeLiberar && (
            <AccesoRapido
              color="warning"
              description="Retenidos y hora de liberación"
              href="/panel/liberacion"
              icon="calendar"
              title="Liberación"
            />
          )}
        </GrupoAccesos>
        <GrupoAccesos titulo="Administración">
          {canManageUsers && (
            <AccesoRapido
              color="success"
              description="Usuarios del sistema"
              href="/panel/panel-usuarios"
              icon="users"
              title="Usuarios"
            />
          )}
          {isSuperAdmin && (
            <AccesoRapido
              color="warning"
              description="Sucursales y parámetros"
              href="/panel/configuracion"
              icon="configuracion"
              title="Configuración"
            />
          )}
        </GrupoAccesos>
      </div>

      <LineChartCard />
    </section>
  );
}
