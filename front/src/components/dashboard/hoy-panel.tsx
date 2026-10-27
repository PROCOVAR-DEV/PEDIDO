import type { ReactNode } from "react";
import type { ResumenHoy } from "./use-hoy";

import { Button, Link, Skeleton } from "@heroui/react";

import { cn } from "@/lib/utils";

/** «hace 4 minutos», como en la pantalla de Facturación. */
export const haceCuanto = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (m < 1) return "hace un momento";
  if (m === 1) return "hace 1 minuto";
  if (m < 60) return `hace ${m} minutos`;

  const h = Math.round(m / 60);

  return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
};

/** Fecha de hoy en Cuba, que es donde están las sucursales y donde cambia el día. */
export const fechaDeHoy = () => {
  const t = new Intl.DateTimeFormat("es-ES", {
    timeZone: "America/Havana",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return t.charAt(0).toUpperCase() + t.slice(1);
};

const TONOS = {
  base: "text-foreground",
  ok: "text-success-600",
  aviso: "text-warning-600",
  suave: "text-default-400",
} as const;

/** «Lunes 26 de octubre», de un día `AAAA-MM-DD` (calendario, sin husos). */
export const fechaLarga = (dia: string) => {
  const t = new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(new Date(`${dia}T12:00:00Z`))
    .replace(",", "");

  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * La lista de pedidos con los filtros YA puestos, para ir directo a ver lo que dice una cifra.
 * Los valores son los de los desplegables de la lista (`estado`, `factura`) y los de
 * `GET /orders`; la lista los lee de la dirección al abrirse.
 */
export const enlaceLista = (
  dia: string,
  filtros: Record<string, string> = {},
) =>
  `/panel/panel-pedidos?${new URLSearchParams({ fechaDesde: dia, fechaHasta: dia, ...filtros })}`;

// Los filtros de cada cifra del resumen (ver `estadoDeFactura` en el api):
//  - con factura   = facturaEstado igual o cambiado
//  - buscando / sin factura = «sin_factura» de un pedido COMPLETADO (el api los separa por
//    si el día ya cerró; para la lista son el mismo hueco)
//  - sin completar = «sin_factura» de un pedido todavía en proceso o expirado
const F_CON_FACTURA = { factura: "igual,cambiado" };
const F_SIN_FACTURA = { factura: "sin_factura", estado: "completada" };
const F_SIN_COMPLETAR = {
  factura: "sin_factura",
  estado: "en_proceso,expirada",
};
// Todo lo que no tiene factura, esté como esté: «sin_factura» más «sin_cotejar» (nulo).
const F_PENDIENTES = { factura: "sin_factura,sin_cotejar" };

const ENLACE_FILA =
  "text-base font-medium tabular-nums outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-focus";

/**
 * Una línea del resumen: la etiqueta a la izquierda, la cifra a la derecha, misma línea
 * base. Con `href`, toda la línea es el enlace (la cifra lo lleva y se estira).
 */
function Fila({
  etiqueta,
  valor,
  tono = "base",
  cargando,
  href,
  aria,
}: {
  etiqueta: string;
  valor: number;
  tono?: keyof typeof TONOS;
  cargando: boolean;
  href?: string;
  aria?: string;
}) {
  return (
    <div className="relative flex items-baseline justify-between gap-3 border-b border-divider py-1 hover:bg-default-50">
      <dt className="text-sm text-default-600">{etiqueta}</dt>
      <dd>
        {cargando ? (
          <Skeleton className="rounded">
            <span className="block h-5 w-8" />
          </Skeleton>
        ) : href ? (
          <Link
            aria-label={aria ?? `${etiqueta}: ${valor}. Ver los pedidos`}
            className={cn(ENLACE_FILA, TONOS[tono])}
            href={href}
          >
            {valor}
          </Link>
        ) : (
          <span
            className={cn("text-base font-medium tabular-nums", TONOS[tono])}
          >
            {valor}
          </span>
        )}
      </dd>
    </div>
  );
}

export interface Totales {
  total: number;
  completados: number;
  enProceso: number;
  expirados: number;
}

/**
 * AYER: una notificación, no un número más. Si quedaron pedidos sin factura, el bloque
 * avisa (tono suave) y lleva a verlos; si todo está facturado, se queda discreto.
 */
export function Ayer({
  dia,
  resumen,
  cargando,
  error,
  onReintentar,
}: {
  /** El día de ayer, `AAAA-MM-DD`. */
  dia: string;
  resumen: ResumenHoy | null;
  cargando: boolean;
  error: string | null;
  onReintentar: () => void;
}) {
  const t = resumen?.totales;
  const conFactura = (t?.facturado ?? 0) + (t?.cambiado ?? 0);
  const pendientes = t ? t.total - conFactura : 0;
  const fecha = fechaLarga(dia);
  const marco = "rounded-lg border px-3 py-2 text-sm";

  if (error && !resumen) {
    return (
      <p
        className={cn(
          marco,
          "flex flex-wrap items-center gap-2 border-divider text-default-600",
        )}
      >
        No se pudo cargar lo de ayer. Vuelve a intentarlo.
        <Button size="sm" variant="flat" onPress={onReintentar}>
          Reintentar
        </Button>
      </p>
    );
  }
  if (cargando && !resumen) {
    return (
      <Skeleton className="rounded-lg">
        <div className="h-14" />
      </Skeleton>
    );
  }
  if (!t) return null;

  if (t.total === 0) {
    return (
      <p className={cn(marco, "border-divider text-default-500")}>
        {fecha}: ayer no hubo pedidos.
      </p>
    );
  }

  const detalle = (
    <span className="text-xs text-default-500 [@media(max-height:820px)]:hidden">
      {fecha}:{" "}
      <Link
        aria-label={`${t.total} pedidos de ayer. Ver los pedidos`}
        className="text-xs"
        href={enlaceLista(dia)}
      >
        {t.total} pedidos
      </Link>
      ,{" "}
      <Link
        aria-label={`${conFactura} pedidos de ayer con factura. Ver los pedidos`}
        className="text-xs"
        href={enlaceLista(dia, F_CON_FACTURA)}
      >
        {conFactura} con factura
      </Link>
      {t.sin_completar > 0 && `, ${t.sin_completar} sin completar`}
    </span>
  );

  if (pendientes === 0) {
    return (
      <div className={cn(marco, "flex flex-col border-divider")} role="status">
        <span className="font-medium">Ayer: todo facturado</span>
        {detalle}
      </div>
    );
  }

  return (
    <div
      className={cn(marco, "flex flex-col border-warning-200 bg-warning-50/40")}
      role="status"
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">
          {pendientes === 1
            ? "Ayer quedó 1 pedido sin factura"
            : `Ayer quedaron ${pendientes} pedidos sin factura`}
        </span>
        <Link
          aria-label={`Ver los ${pendientes} pedidos de ayer sin factura`}
          className="text-sm font-medium"
          href={enlaceLista(dia, F_PENDIENTES)}
        >
          Ver {pendientes === 1 ? "el pedido" : `los ${pendientes}`}
        </Link>
      </span>
      {detalle}
    </div>
  );
}

/**
 * Los cuatro totales de pedidos. `ancho`: en fila, de lado a lado (roles sin resumen
 * diario); si no, en la columna del resumen, donde es lo primero que se esconde en
 * pantallas bajas.
 */
function BloqueTotales({
  titulo,
  totales,
  cargandoTotales,
  errorTotales,
  onReintentar,
  ancho = false,
  ocultableEnBajo = false,
}: {
  titulo: string;
  totales: Totales | null;
  cargandoTotales: boolean;
  errorTotales: string | null;
  onReintentar: () => void;
  ancho?: boolean;
  ocultableEnBajo?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        ancho && "lg:flex-row lg:items-baseline lg:gap-8",
        ocultableEnBajo && "[@media(max-height:820px)]:hidden",
      )}
    >
      <h2 className="shrink-0 text-base font-semibold">{titulo}</h2>
      {errorTotales && !totales ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-default-600">
          No se pudieron cargar los totales. Vuelve a intentarlo.
          <Button size="sm" variant="flat" onPress={onReintentar}>
            Reintentar
          </Button>
        </p>
      ) : (
        <dl
          className={cn(
            "grid grid-cols-1 gap-x-8 sm:grid-cols-2",
            ancho && "min-w-0 flex-1 lg:grid-cols-4",
          )}
        >
          <Fila
            cargando={cargandoTotales}
            etiqueta="Total"
            valor={totales?.total ?? 0}
          />
          <Fila
            cargando={cargandoTotales}
            etiqueta="Completados"
            tono="ok"
            valor={totales?.completados ?? 0}
          />
          <Fila
            cargando={cargandoTotales}
            etiqueta="En proceso"
            tono="aviso"
            valor={totales?.enProceso ?? 0}
          />
          <Fila
            cargando={cargandoTotales}
            etiqueta="Expirados"
            valor={totales?.expirados ?? 0}
          />
        </dl>
      )}
    </div>
  );
}

/** Los totales como franja de ancho completo, para los roles que no tienen resumen diario. */
export function FranjaTotales(props: {
  titulo: string;
  totales: Totales | null;
  cargandoTotales: boolean;
  errorTotales: string | null;
  onReintentar: () => void;
}) {
  return (
    <section aria-label={props.titulo}>
      <BloqueTotales {...props} ancho />
    </section>
  );
}

/**
 * Resumen diario, sin cajas: una sola cifra grande («Facturados hoy») y el resto en líneas
 * finas separadas por filetes, cada una con su enlace a la lista ya filtrada. Sin
 * `resumen` (el rol no lo recibe) sólo quedan los totales.
 */
export function Resumen({
  verResumen,
  verTotales,
  dia,
  resumen,
  cargando,
  error,
  onReintentar,
  totales,
  cargandoTotales,
  errorTotales,
  onReintentarTotales,
  enlaceFacturacion,
  entre,
  tituloTotales = "Pedidos en total",
}: {
  verResumen: boolean;
  verTotales: boolean;
  /** Hoy en Cuba, `AAAA-MM-DD`: es el que llevan los enlaces. */
  dia: string;
  resumen: ResumenHoy | null;
  cargando: boolean;
  error: string | null;
  onReintentar: () => void;
  totales: Totales | null;
  cargandoTotales: boolean;
  errorTotales: string | null;
  onReintentarTotales: () => void;
  /** El rol puede entrar a la pantalla de Facturación (su ruta lo deja). */
  enlaceFacturacion: boolean;
  /** Lo que va entre el resumen diario y los totales (el bloque de ayer). */
  entre?: ReactNode;
  tituloTotales?: string;
}) {
  const t = resumen?.totales;
  const conFactura = (t?.facturado ?? 0) + (t?.cambiado ?? 0);
  const conError = (resumen?.ultimaPasada?.sucursales ?? []).filter(
    (s) => s.error,
  ).length;
  const esperando = cargando && !resumen;
  const pasada = resumen?.ultimaPasada;

  return (
    <section
      aria-label="Resumen diario"
      className={cn(
        "flex min-h-0 flex-col gap-3 overflow-y-clip",
        !verResumen && "justify-center",
      )}
    >
      {verResumen && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="text-base font-semibold">
              Resumen diario
              <span className="ml-2 text-sm font-normal text-default-500">
                {fechaLarga(dia)}
              </span>
            </h2>
            {pasada && (
              <span className="text-xs text-default-500">
                Facturas comprobadas {haceCuanto(pasada.cuando)}
              </span>
            )}
          </div>

          {error && !resumen ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-default-600">
              No se pudo cargar el resumen diario ({error}). Comprueba la
              conexión y vuelve a intentarlo.
              <Button size="sm" variant="flat" onPress={onReintentar}>
                Reintentar
              </Button>
            </p>
          ) : (
            <>
              {/* Lo que se facturó hoy, de cualquier día: Camagüey, por ejemplo, factura
                  el día siguiente, y contar sólo los pedidos de hoy parecía que no se
                  facturaba nada. Es la única cifra grande del resumen. */}
              <div className="flex items-baseline gap-3">
                {esperando ? (
                  <Skeleton className="rounded-lg">
                    <span className="block h-9 w-14" />
                  </Skeleton>
                ) : (
                  <span className="text-4xl font-semibold leading-none tabular-nums text-success-600">
                    {resumen?.facturadosEseDia ?? 0}
                  </span>
                )}
                <span className="text-sm text-default-600">
                  facturados hoy
                  <span className="block text-xs text-default-500">
                    pedidos que recibieron factura hoy, de cualquier día
                    {enlaceFacturacion && (
                      <>
                        {" "}
                        <Link
                          className="text-xs"
                          href="/panel/sincronizacion/facturacion"
                        >
                          Ver facturación
                        </Link>
                      </>
                    )}
                  </span>
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <Fila
                  aria={`Pedidos de hoy: ${t?.total ?? 0}. Ver los pedidos`}
                  cargando={esperando}
                  etiqueta="Pedidos de hoy"
                  href={enlaceLista(dia)}
                  valor={t?.total ?? 0}
                />
                <Fila
                  aria={`De los pedidos de hoy, ${conFactura} con factura. Ver los pedidos`}
                  cargando={esperando}
                  etiqueta="De ellos, con factura"
                  href={enlaceLista(dia, F_CON_FACTURA)}
                  tono={conFactura ? "ok" : "suave"}
                  valor={conFactura}
                />
                <Fila
                  aria={`${t?.buscando ?? 0} pedidos de hoy buscando factura. Ver los pedidos`}
                  cargando={esperando}
                  etiqueta="Buscando factura"
                  href={enlaceLista(dia, F_SIN_FACTURA)}
                  tono={t?.buscando ? "base" : "suave"}
                  valor={t?.buscando ?? 0}
                />
                {/* Discreto: un pedido de hoy sin factura es lo normal, se factura mañana. */}
                <Fila
                  aria={`${t?.no_aparecio ?? 0} pedidos de hoy sin factura. Ver los pedidos`}
                  cargando={esperando}
                  etiqueta="Sin factura"
                  href={enlaceLista(dia, F_SIN_FACTURA)}
                  tono={t?.no_aparecio ? "base" : "suave"}
                  valor={t?.no_aparecio ?? 0}
                />
                <Fila
                  aria={`${t?.sin_completar ?? 0} pedidos de hoy sin completar. Ver los pedidos`}
                  cargando={esperando}
                  etiqueta="Sin completar"
                  href={enlaceLista(dia, F_SIN_COMPLETAR)}
                  tono={t?.sin_completar ? "base" : "suave"}
                  valor={t?.sin_completar ?? 0}
                />
              </dl>

              {!esperando && t?.total === 0 && (
                <p className="text-sm text-default-500">
                  Hoy todavía no ha entrado ningún pedido.
                </p>
              )}
              {!esperando && resumen && !pasada && (
                <p className="text-xs text-default-500">
                  Aún no hay una comprobación de facturas reciente.
                </p>
              )}
              {conError > 0 && (
                <p className="text-xs text-warning-600">
                  {conError}{" "}
                  {conError === 1 ? "sucursal dio" : "sucursales dieron"} error
                  en la última comprobación.{" "}
                  <Link
                    className="text-xs"
                    href="/panel/sincronizacion/facturacion"
                  >
                    Ver detalle
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {entre}

      {verTotales && (
        <BloqueTotales
          cargandoTotales={cargandoTotales}
          errorTotales={errorTotales}
          ocultableEnBajo={verResumen}
          titulo={tituloTotales}
          totales={totales}
          onReintentar={onReintentarTotales}
        />
      )}
    </section>
  );
}
