import { useEffect, useState } from "react";

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
import { getApiBaseUrl } from "@/config";
import { useAuthStore } from "@/stores/authStore";
import { esRolGlobal } from "@/lib/rol-global";
import { useLiveEvents } from "@/hooks/use-live-events";

/**
 * QUÉ VE CADA ROL EN EL PANEL. Es el único sitio: para cambiar quién ve qué se toca
 * esta tabla y nada más.
 *
 * Esconder una tarjeta es comodidad. Quien lo impide de verdad es la ruta
 * (App.tsx) y el servidor. Y lo que no se ve tampoco se PIDE: «hoy» y «retenidos»
 * son peticiones, y sólo se hacen para los roles que las tienen.
 *
 *  - hoy:         la franja «Hoy» de facturación (`/facturacion/resumen`).
 *  - retenidos:   la tarjeta «Retenidos» (`/orders?retenidos=1`). Va con «liberacion».
 *  - totales:     los totales de pedidos (el api ya los filtra a lo que ve cada rol).
 *  - el resto:    un acceso rápido cada uno.
 */
type Bloque =
  | "hoy"
  | "retenidos"
  | "totales"
  | "pedidos"
  | "importar"
  | "clientes"
  | "vendedores"
  | "perfil"
  | "reportes"
  | "liberacion"
  | "usuarios"
  | "configuracion";

const GLOBAL: Bloque[] = [
  "hoy",
  "retenidos",
  "totales",
  "pedidos",
  "importar",
  "clientes",
  "vendedores",
  "reportes",
  "liberacion",
  "usuarios",
  "configuracion",
];
const SUCURSAL_ENTERA: Bloque[] = [
  "hoy",
  "retenidos",
  "totales",
  "pedidos",
  "importar",
  "clientes",
  "vendedores",
  "reportes",
  "liberacion",
];
// Lo que el código tenía para «cualquier otro rol que no es Operador ni Gestor».
const RESTO: Bloque[] = [
  "hoy",
  "totales",
  "pedidos",
  "importar",
  "clientes",
  "reportes",
];

const CAPACIDADES: Record<string, readonly Bloque[]> = {
  DESARROLLADOR: GLOBAL,
  "SUPER ADMIN": GLOBAL,
  ADMINISTRADOR: [...SUCURSAL_ENTERA, "usuarios"],
  SUPERVISOR: SUCURSAL_ENTERA,
  // Gerente no gestiona vendedores, y las rutas de importar y de reportes no lo dejan entrar
  // (App.tsx): sin esas baldosas no hay botones que lleven a «sin permiso».
  GERENTE: SUCURSAL_ENTERA.filter((b) => !["vendedores", "importar", "reportes"].includes(b)),
  // Sólo lo suyo: sin informes ni facturación de la sucursal.
  GESTOR: ["totales", "pedidos", "clientes", "perfil"],
  // Factura: ve pedidos, vendedores y clientes de su sucursal; ni importa ni saca informes.
  OPERADOR: ["totales", "pedidos", "vendedores", "clientes"],
  ECONOMICA: RESTO,
  ANALISTA: RESTO,
  LOGISTICO: RESTO,
};
// Un rol que no esté en la tabla ve lo mínimo, no lo máximo.
const MINIMO: readonly Bloque[] = ["totales", "pedidos", "clientes"];

const TEXTO_CABECERA: Record<string, string> = {
  GESTOR: "Tus pedidos y tus vendedores",
  OPERADOR: "Pedidos y vendedores de tu sucursal para facturar",
};

export default function PanelPage() {
  const { user, session } = useAuthStore();
  const { stats, isLoading, error, refetch } = useDashboard();
  const sucursalNombre = user?.sucursal || "";

  // El admin semilla (`isGlobalAdmin`) se trata como Super Admin, igual que el api.
  const rol =
    session?.isGlobalAdmin && !esRolGlobal(user?.role)
      ? "SUPER ADMIN"
      : String(user?.role || "").toUpperCase();
  const ve = new Set<Bloque>(CAPACIDADES[rol] ?? MINIMO);

  // Lo de HOY: cada bloque se pide sólo si el rol lo tiene en la tabla.
  const activeSucursalId = session?.isGlobalAdmin
    ? getSucursalActiva()
    : session?.sucursalId;
  const hoy = useHoy({
    verResumen: ve.has("hoy"),
    verRetenidos: ve.has("retenidos"),
    hayRegla: !!activeSucursalId,
  });

  // Nombre de la sucursal para la línea del rol: el global no tiene una propia, así que
  // se busca la elegida (la misma lista que ya pide el selector).
  const [nombreElegida, setNombreElegida] = useState("");

  useEffect(() => {
    if (sucursalNombre || !activeSucursalId) return;
    fetch(`${getApiBaseUrl()}/sucursales`)
      .then((r) => (r.ok ? r.json() : []))
      .then((l: Array<{ id: string; nombre: string }>) =>
        setNombreElegida(
          l.find((x) => x.id === activeSucursalId)?.nombre ?? "",
        ),
      )
      .catch(() => undefined);
  }, [sucursalNombre, activeSucursalId]);

  const lugar =
    sucursalNombre ||
    (activeSucursalId ? nombreElegida : "Todas las sucursales");

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
            {TEXTO_CABECERA[rol] ?? (
              <>
                {fechaDeHoy()}
                {pasada &&
                  ` · Facturas comprobadas ${haceCuanto(pasada.cuando)}`}
              </>
            )}
            <span className="block text-sm font-normal text-default-500">
              {[user?.role, lugar].filter(Boolean).join(" · ")}
            </span>
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
        <div
          className={ve.has("retenidos") ? "lg:col-span-2" : "lg:col-span-3"}
        >
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
            verResumen={ve.has("hoy")}
            verTotales={ve.has("totales")}
            onReintentar={() => void hoy.recargar()}
          />
        </div>
        {ve.has("retenidos") && (
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
          {ve.has("pedidos") && (
            <AccesoRapido
              color="primary"
              description="Ver y gestionar los pedidos"
              href="/panel/panel-pedidos"
              icon="pedido"
              title="Pedidos"
            />
          )}
          {ve.has("importar") && (
            <AccesoRapido
              color="primary"
              description="Archivo CSV de Parranda"
              href="/panel/panel-pedidos/nuevo"
              icon="add"
              title="Importar pedido"
            />
          )}
          {ve.has("clientes") && (
            <AccesoRapido
              color="secondary"
              description="Clientes del sistema"
              href="/panel/clientes"
              icon="client"
              title="Clientes"
            />
          )}
          {ve.has("vendedores") && (
            <AccesoRapido
              color="secondary"
              description="Vendedores del sistema"
              href="/panel/trabajadores"
              icon="workers"
              title="Vendedores"
            />
          )}
          {ve.has("perfil") && (
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
          {ve.has("reportes") && (
            <AccesoRapido
              color="danger"
              description="Generar y exportar reportes"
              href="/panel/reportes"
              icon="reports"
              title="Reportes"
            />
          )}
          {ve.has("liberacion") && (
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
          {ve.has("usuarios") && (
            <AccesoRapido
              color="success"
              description="Usuarios del sistema"
              href="/panel/panel-usuarios"
              icon="users"
              title="Usuarios"
            />
          )}
          {ve.has("configuracion") && (
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
