import type { CSSProperties } from "react";

import { useEffect, useState } from "react";
import { Button, Link } from "@heroui/react";

import Icons from "@/components/icons/iconify";
import { SucursalSelector } from "@/components/sucursal-selector";
import { UserMenu } from "@/components/user-menu";
import { useDashboard } from "@/providers/DashboardProvider";
import {
  AccesoPrincipal,
  AccesoRapido,
} from "@/components/dashboard/acceso-rapido";
import {
  Ayer,
  FranjaTotales,
  Resumen,
  fechaDeHoy,
} from "@/components/dashboard/hoy-panel";
import { diaAnterior, useHoy } from "@/components/dashboard/use-hoy";
import { getSucursalActiva } from "@/lib/sucursal-activa";
import { LineChartCard } from "@/components/dashboard/LineChartCard";
import { getApiBaseUrl } from "@/config";
import { useAuthStore } from "@/stores/authStore";
import { esRolGlobal } from "@/lib/rol-global";
import { useLiveEvents } from "@/hooks/use-live-events";
import { cn } from "@/lib/utils";

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
  GERENTE: SUCURSAL_ENTERA.filter(
    (b) => !["vendedores", "importar", "reportes"].includes(b),
  ),
  // Sólo lo suyo, pero con el resumen diario y lo de ayer: el api le da solo las cifras de SUS vendedores.
  GESTOR: ["hoy", "totales", "pedidos", "clientes", "perfil"],
  // Factura: ve pedidos, vendedores y clientes de su sucursal; ni importa ni saca informes. El resumen
  // diario y lo de ayer sí (solo las cifras de su sucursal), para ir directo a esos pedidos.
  OPERADOR: ["hoy", "totales", "pedidos", "vendedores", "clientes"],
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
  const { stats, isLoading, error, refetch, selectedYear } = useDashboard();
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

  // Las baldosas pequeñas, en el orden de uso. La tabla CAPACIDADES decide cuáles salen.
  const retenidos = hoy.retenidos;
  const nRetenidos = retenidos?.total ?? 0;
  const regla = hoy.regla;
  const descLiberacion =
    nRetenidos > 0
      ? !activeSucursalId
        ? (retenidos?.porSucursal ?? [])
            .map((x) => `${x.sucursal} ${x.total}`)
            .join(", ")
        : regla?.activa
          ? `Se liberan a las ${regla.hoyDesde}`
          : "Esperando su hora de liberación"
      : regla && !regla.activa
        ? "La regla está apagada"
        : "Retenidos y hora de liberación";

  const pequenas: Array<{
    bloque: Bloque;
    props: React.ComponentProps<typeof AccesoRapido>;
  }> = [
    {
      bloque: "importar",
      props: {
        color: "primary",
        description: "Subir el CSV de Parranda",
        href: "/panel/panel-pedidos/nuevo",
        icon: "add",
        title: "Importar pedidos",
      },
    },
    {
      bloque: "clientes",
      props: {
        color: "secondary",
        description: "Clientes del sistema",
        href: "/panel/clientes",
        icon: "client",
        title: "Clientes",
      },
    },
    {
      bloque: "vendedores",
      props: {
        color: "secondary",
        description: "Vendedores del sistema",
        href: "/panel/trabajadores",
        icon: "workers",
        title: "Vendedores",
      },
    },
    {
      bloque: "reportes",
      props: {
        color: "danger",
        description: "Generar y exportar",
        href: "/panel/reportes",
        icon: "reports",
        title: "Reportes",
      },
    },
    {
      bloque: "liberacion",
      props: {
        color: "warning",
        description: descLiberacion,
        href: "/panel/liberacion",
        icon: "calendar",
        insignia: {
          valor: nRetenidos,
          etiqueta: nRetenidos === 1 ? "pedido retenido" : "pedidos retenidos",
        },
        title: "Liberación",
      },
    },
    {
      bloque: "usuarios",
      props: {
        color: "success",
        description: "Usuarios del sistema",
        href: "/panel/panel-usuarios",
        icon: "users",
        title: "Usuarios",
      },
    },
    {
      bloque: "configuracion",
      props: {
        color: "warning",
        description: "Sucursales y parámetros",
        href: "/panel/configuracion",
        icon: "configuracion",
        title: "Configuración",
      },
    },
    {
      bloque: "perfil",
      props: {
        color: "primary",
        description: "Tus métricas y tus datos",
        href: "/panel/mi-perfil",
        icon: "user",
        title: "Mi perfil",
      },
    },
  ];
  const visibles = pequenas.filter((x) => ve.has(x.bloque));

  // REPARTO DE LA REJILLA (escritorio, xl): «Pedidos» ocupa 2 columnas y, si hay más de
  // 4 baldosas pequeñas, 2 filas; las columnas salen del número de baldosas para que no
  // queden huecos. Si sobra un hueco (n impar en dos filas) la última se ensancha.
  // Por debajo de xl son 2 columnas y la última impar ocupa las dos.
  const n = visibles.length;
  const principal = ve.has("pedidos");
  const filas = n <= 4 ? 1 : 2;
  const porFila = Math.ceil(n / filas);
  const columnas = (principal ? 2 : 0) + porFila;
  const hueco = filas * porFila - n;

  // La línea de debajo del título: quién eres y dónde, y la fecha, en tramos separados.
  const dondeEstas =
    !activeSucursalId && !sucursalNombre
      ? `${user?.role ?? ""}, ${lugar.toLowerCase()}`
      : lugar
        ? `${user?.role ?? ""} de ${lugar}`
        : (user?.role ?? "");

  const dato = ve.has("hoy") ? (hoy.resumen?.totales.total ?? null) : null;

  // Facturación: sólo los roles que su ruta deja entrar (App.tsx) y que ven el resumen.
  const enlaceFacturacion =
    !!session?.isGlobalAdmin ||
    esRolGlobal(user?.role) ||
    ["ADMINISTRADOR", "SUPERVISOR"].includes(rol);

  // ALTURA: en escritorio (xl) el panel ocupa EXACTAMENTE la ventana y no hay scroll.
  // El armazón (layouts/panel.tsx) reserva `lg:py-16` (64 px arriba y abajo); aquí se
  // recuperan 48 de cada lado (-mt-12 / -mb-12) y la altura es la de la ventana menos los
  // 32 px que quedan. Reparto: cabecera y baldosas con su alto, y la última fila
  // (resumen + gráfica) se queda con TODO el resto (`minmax(0,1fr)`), así que cede si la
  // ventana es baja. Con 920 px útiles: 888 de panel = 40 cabecera + 164 baldosas + 24
  // huecos + 660 de la fila de abajo. Con 768: 736 = 40 + 164 + 24 + 508.
  return (
    <section
      className={cn(
        "flex flex-col gap-4 xl:-mb-12 xl:-mt-12 xl:grid xl:h-[calc(100dvh-2rem)] xl:gap-3",
        ve.has("hoy")
          ? "xl:grid-rows-[auto_auto_auto] xl:content-start"
          : "xl:grid-rows-[auto_auto_auto_minmax(0,1fr)]",
      )}
    >
      {/* Cabecera de UNA línea. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-0.5">
          <h1 className="text-xl font-bold text-primary">Inicio</h1>
          <span className="text-sm text-default-500">{dondeEstas}</span>
          <span className="text-sm text-default-500">{fechaDeHoy()}</span>
          {TEXTO_CABECERA[rol] && (
            <span className="text-sm text-default-500">
              {TEXTO_CABECERA[rol]}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SucursalSelector />
          <UserMenu />
          <Button
            as={Link}
            color="primary"
            href="/"
            radius="md"
            size="sm"
            startContent={<Icons.back className="size-4" />}
            variant="flat"
          >
            Ir al inicio
          </Button>
        </div>
      </header>

      {/* 1. LOS ACCESOS: lo principal del panel. */}
      <nav
        aria-label="Accesos rápidos"
        className="grid grid-cols-2 gap-3 xl:auto-rows-[76px] xl:[grid-template-columns:repeat(var(--columnas),minmax(0,1fr))]"
        style={{ "--columnas": columnas } as CSSProperties}
      >
        {principal && (
          <AccesoPrincipal
            alto={filas === 2}
            cargando={ve.has("hoy") && hoy.cargando && !hoy.resumen}
            className={cn(
              "col-span-2 xl:col-span-2",
              filas === 2 && "xl:row-span-2",
            )}
            dato={dato}
            description="Ver y gestionar los pedidos"
            etiquetaDato="pedidos de hoy"
            href="/panel/panel-pedidos"
            icon="pedido"
            title="Pedidos"
          />
        )}
        {visibles.map((x, i) => {
          const ultima = i === n - 1;

          return (
            <AccesoRapido
              key={x.bloque}
              {...x.props}
              className={cn(
                ultima && n % 2 === 1 && "col-span-2",
                ultima && "xl:col-span-1",
                ultima && hueco === 1 && "xl:col-span-2",
              )}
            />
          );
        })}
      </nav>

      {/* 2. RESUMEN DIARIO (con el aviso de ayer) y evolución anual, a la misma altura. */}
      {ve.has("hoy") ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,9fr)_minmax(0,16fr)] xl:items-stretch">
          <div className="flex min-h-0 flex-col">
            <Resumen
              anioTotales={selectedYear}
              cargando={hoy.cargando}
              cargandoTotales={isLoading}
              dia={hoy.dia}
              enlaceFacturacion={enlaceFacturacion}
              entre={
                ve.has("hoy") ? (
                  <Ayer
                    cargando={hoy.cargando}
                    dia={diaAnterior(hoy.dia)}
                    error={hoy.errorAyer}
                    resumen={hoy.ayer}
                    onReintentar={() => void hoy.recargar()}
                  />
                ) : null
              }
              error={hoy.error}
              errorTotales={error}
              resumen={hoy.resumen}
              tituloTotales={
                selectedYear ? `Pedidos de ${selectedYear}` : "Pedidos en total"
              }
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
              onReintentarTotales={() => void refetch()}
            />
          </div>
          <section
            aria-label="Evolución anual"
            className="h-[340px] xl:h-auto xl:min-h-[340px]"
          >
            <LineChartCard />
          </section>
        </div>
      ) : (
        <>
          {/* Sin resumen diario (Operador, Gestor…): los totales en una franja de lado a
              lado y la gráfica con todo el ancho y el resto de la altura. */}
          {ve.has("totales") && (
            <FranjaTotales
              anio={selectedYear}
              cargandoTotales={isLoading}
              errorTotales={error}
              titulo={
                selectedYear ? `Pedidos de ${selectedYear}` : "Pedidos en total"
              }
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
              onReintentar={() => void refetch()}
            />
          )}
          <section
            aria-label="Evolución anual"
            className="h-[340px] xl:h-full xl:min-h-0"
          >
            <LineChartCard />
          </section>
        </>
      )}
    </section>
  );
}
