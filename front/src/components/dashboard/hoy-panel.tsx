import type { ReactNode } from "react";
import type { ResumenHoy } from "./use-hoy";

import { Button, Card, CardBody, Link, Skeleton } from "@heroui/react";

import { diaAnterior } from "./use-hoy";

import Icons from "@/components/icons/iconify";
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

// Enlace estirado: el enlace principal de una tarjeta lleva un ::after que cubre TODA la
// tarjeta (que es `relative`), así que se puede pulsar en cualquier punto. HeroUI pone
// `relative` a sus enlaces: por eso este va `static` (también en línea, por si el fusionado
// de clases no lo resolviera), para que el ::after se mida contra la tarjeta y no contra él.
const ESTIRADO =
  "static after:absolute after:inset-0 outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus";
const SIN_POSICION = { position: "static" } as const;
// Los enlaces pequeños de dentro de una tarjeta estirada van por encima de ella.
const ENCIMA = "relative z-10";

const FOCO_FILA = "outline-none focus-visible:ring-2 focus-visible:ring-focus";

/**
 * Una línea del resumen: la etiqueta a la izquierda, la cifra a la derecha, misma línea
 * base. Con `href`, la FILA ENTERA es el enlace (etiqueta, cifra y todo su alto).
 */
function Fila({
  etiqueta,
  valor,
  tono = "base",
  cargando,
  href,
  aria,
  apilada = false,
}: {
  etiqueta: string;
  valor: number;
  tono?: keyof typeof TONOS;
  cargando: boolean;
  href?: string;
  aria?: string;
  /** Etiqueta encima y cifra debajo: para filas de tres celdas, donde no cabe en una línea. */
  apilada?: boolean;
}) {
  const dentro = (
    <>
      <span className="whitespace-nowrap text-sm text-default-600">
        {etiqueta}
      </span>
      {cargando ? (
        <Skeleton className="rounded">
          <span className="block h-5 w-8" />
        </Skeleton>
      ) : (
        <span
          className={cn(
            "font-medium tabular-nums",
            apilada ? "text-2xl leading-tight" : "text-lg",
            TONOS[tono],
          )}
        >
          {valor}
        </span>
      )}
    </>
  );
  const caja = apilada
    ? "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2.5"
    : "flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-2.5";

  return (
    <div className="border-b border-divider" role="listitem">
      {href && !cargando ? (
        <Link
          aria-label={aria ?? `${etiqueta}: ${valor}. Ver la lista`}
          className={cn(
            caja,
            "text-foreground hover:bg-default-100",
            FOCO_FILA,
          )}
          href={href}
        >
          {dentro}
        </Link>
      ) : (
        <div className={caja}>{dentro}</div>
      )}
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
 * Los cuatro totales de pedidos. `ancho`: en fila, de lado a lado (roles sin resumen
 * diario); si no, en la columna del resumen, donde es lo primero que se esconde en
 * pantallas bajas. Cada fila lleva a la lista con su estado y el año entero (los totales
 * son por AÑO); `incluirArchivados` porque los completados y expirados viejos están
 * archivados y, sin él, la lista enseñaría menos de lo que dice la cifra.
 */
function BloqueTotales({
  titulo,
  anio,
  totales,
  cargandoTotales,
  errorTotales,
  onReintentar,
  ancho = false,
  ocultableEnBajo = false,
}: {
  titulo: string;
  anio?: number | null;
  totales: Totales | null;
  cargandoTotales: boolean;
  errorTotales: string | null;
  onReintentar: () => void;
  ancho?: boolean;
  ocultableEnBajo?: boolean;
}) {
  const lista = (estado?: string) =>
    `/panel/panel-pedidos?${new URLSearchParams({
      ...(anio
        ? { fechaDesde: `${anio}-01-01`, fechaHasta: `${anio}-12-31` }
        : {}),
      incluirArchivados: "1",
      ...(estado ? { estado } : {}),
    })}`;

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
        <div
          className={cn(
            "grid grid-cols-2 gap-x-6",
            ancho && "min-w-0 flex-1 lg:grid-cols-4",
          )}
          role="list"
        >
          <Fila
            aria={`Total de pedidos: ${totales?.total ?? 0}. Ver la lista`}
            cargando={cargandoTotales}
            etiqueta="Total"
            href={lista()}
            valor={totales?.total ?? 0}
          />
          <Fila
            aria={`Pedidos completados: ${totales?.completados ?? 0}. Ver la lista`}
            cargando={cargandoTotales}
            etiqueta="Completados"
            href={lista("completada")}
            tono="ok"
            valor={totales?.completados ?? 0}
          />
          <Fila
            aria={`Pedidos en proceso: ${totales?.enProceso ?? 0}. Ver la lista`}
            cargando={cargandoTotales}
            etiqueta="En proceso"
            href={lista("en_proceso")}
            tono="aviso"
            valor={totales?.enProceso ?? 0}
          />
          <Fila
            aria={`Pedidos expirados: ${totales?.expirados ?? 0}. Ver la lista`}
            cargando={cargandoTotales}
            etiqueta="Expirados"
            href={lista("expirada")}
            valor={totales?.expirados ?? 0}
          />
        </div>
      )}
    </div>
  );
}

/** Los totales como franja de ancho completo, para los roles que no tienen resumen diario. */
export function FranjaTotales(props: {
  titulo: string;
  anio?: number | null;
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
 * AYER: una notificación, no un número más. Si quedaron pedidos sin factura, la tarjeta
 * avisa (tono suave) y se puede pulsar entera para ir a verlos; si todo está facturado,
 * se queda discreta y sin enlace.
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
  const caja =
    "relative flex items-center gap-3 rounded-xl border p-4 text-sm transition-colors motion-reduce:transition-none";

  if (error && !resumen) {
    return (
      <p className={cn(caja, "flex-wrap border-divider text-default-600")}>
        No se pudo cargar lo de ayer. Vuelve a intentarlo.
        <Button size="sm" variant="flat" onPress={onReintentar}>
          Reintentar
        </Button>
      </p>
    );
  }
  if (cargando && !resumen) {
    return (
      <Skeleton className="rounded-xl">
        <div className="h-[72px]" />
      </Skeleton>
    );
  }
  if (!t) return null;

  if (t.total === 0) {
    return (
      <p className={cn(caja, "border-divider text-default-500")}>
        {fecha}: ayer no hubo pedidos.
      </p>
    );
  }

  // Segunda línea: la fecha y dos enlaces pequeños, por encima del enlace estirado.
  const detalle = (
    <p className="text-xs text-default-500 [@media(max-height:820px)]:hidden">
      {fecha} ·{" "}
      <Link
        aria-label={`${t.total} pedidos de ayer. Ver la lista`}
        className={cn("text-xs", ENCIMA)}
        href={enlaceLista(dia)}
      >
        {t.total} pedidos
      </Link>
      {pendientes > 0 && (
        <>
          {" "}
          ·{" "}
          <Link
            aria-label={`${conFactura} pedidos de ayer con factura. Ver la lista`}
            className={cn("text-xs", ENCIMA)}
            href={enlaceLista(dia, F_CON_FACTURA)}
          >
            {conFactura} con factura
          </Link>
        </>
      )}
    </p>
  );

  const icono = (tono: string, Icono: React.ElementType) => (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full",
        tono,
      )}
    >
      <Icono className="size-4" />
    </span>
  );

  if (pendientes === 0) {
    return (
      <div className={cn(caja, "border-divider")} role="status">
        {icono("bg-success-100 text-success-700", Icons.check)}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Ayer: todo facturado</p>
          <p className="text-xs text-default-500 [@media(max-height:820px)]:hidden">
            {fecha} ·{" "}
            <Link
              aria-label={`${t.total} pedidos de ayer. Ver la lista`}
              className="text-xs"
              href={enlaceLista(dia)}
            >
              {t.total} pedidos
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        caja,
        "border-warning-200 bg-warning-50/40 hover:bg-warning-50/70",
      )}
      role="status"
    >
      {icono("bg-warning-100 text-warning-700", Icons.calendar)}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {pendientes === 1
            ? "Ayer quedó 1 pedido sin factura"
            : `Ayer quedaron ${pendientes} pedidos sin factura`}
        </p>
        {detalle}
      </div>
      {/* La píldora es el enlace principal; su ::after estira el clic a toda la tarjeta. */}
      <Link
        aria-label={`Ver los ${pendientes} pedidos de ayer sin factura`}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-warning-100 px-3 text-sm font-medium text-warning-700",
          ESTIRADO,
          "after:rounded-xl",
        )}
        href={enlaceLista(dia, F_PENDIENTES)}
        style={SIN_POSICION}
      >
        Ver {pendientes === 1 ? "el pedido" : `los ${pendientes}`}
        <svg
          aria-hidden
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}

/**
 * Resumen diario, sin cajas: una sola cifra grande («Facturados hoy») y el resto en líneas
 * finas, cada una un enlace entero a la lista ya filtrada. Sin `resumen` (el rol no lo
 * recibe) sólo quedan los totales.
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
  verCotejo,
  entre,
  tituloTotales = "Pedidos en total",
  anioTotales,
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
  /** Ve el estado interno del cotejo (y la pantalla de Facturación): sólo administradores. */
  verCotejo: boolean;
  /** Lo que va entre el resumen diario y los totales (el bloque de ayer). */
  entre?: ReactNode;
  tituloTotales?: string;
  /** El año de los totales, para que sus enlaces lleven a ese año. */
  anioTotales?: number | null;
}) {
  const t = resumen?.totales;
  const conFactura = (t?.facturado ?? 0) + (t?.cambiado ?? 0);
  const conError = (resumen?.ultimaPasada?.sucursales ?? []).filter(
    (s) => s.error,
  ).length;
  const esperando = cargando && !resumen;
  const pasada = resumen?.ultimaPasada;
  // Sin «Buscando» a la vista (roles que no ven el cotejo), «Sin factura» lo incluye para que
  // no se pierda ningún pedido: es el mismo hueco, y su enlace es el mismo.
  const sinFactura = verCotejo
    ? (t?.no_aparecio ?? 0)
    : (t?.no_aparecio ?? 0) + (t?.buscando ?? 0);

  // Lo facturado hoy, repartido para que SUME: los de pedidos de hoy y los de días
  // anteriores (Camagüey, por ejemplo, factura al día siguiente). Si el api no manda el
  // reparto, se queda la frase de siempre en vez de inventarlo.
  const eseDia = resumen?.facturadosEseDia ?? 0;
  const deHoy = Math.min(resumen?.facturadosDePedidosDelDia ?? 0, eseDia);
  const anteriores = eseDia - deHoy;
  const negrita = (n: number) => (
    <strong className="font-semibold tabular-nums text-foreground">{n}</strong>
  );
  // Cada parte lleva a la lista de pedidos que recibieron factura HOY (`facturadoDia`):
  // los de pedidos de hoy, y los de fechas anteriores (hasta ayer).
  const enlaceParte = (
    filtros: Record<string, string>,
    aria: string,
    hijo: ReactNode,
  ) => (
    <Link
      aria-label={aria}
      className={cn("text-xs text-default-500", ENCIMA)}
      href={`/panel/panel-pedidos?${new URLSearchParams({ facturadoDia: dia, incluirArchivados: "1", ...filtros })}`}
    >
      {hijo}
    </Link>
  );
  const desgloseFacturados =
    resumen?.facturadosDePedidosDelDia === undefined ? (
      "pedidos que recibieron factura hoy, de cualquier día"
    ) : eseDia === 0 ? null : (
      <>
        {deHoy > 0 &&
          enlaceParte(
            { fechaDesde: dia, fechaHasta: dia },
            `${deHoy} facturados hoy de pedidos de hoy. Ver la lista`,
            <span>{negrita(deHoy)} de pedidos de hoy</span>,
          )}
        {deHoy > 0 && anteriores > 0 && " · "}
        {anteriores > 0 &&
          enlaceParte(
            { fechaHasta: diaAnterior(dia) },
            `${anteriores} facturados hoy de días anteriores. Ver la lista`,
            <span>{negrita(anteriores)} de días anteriores</span>,
          )}
      </>
    );

  return (
    <Card
      aria-label="Resumen diario"
      className="min-h-0 flex-1"
      role="region"
      shadow="none"
    >
      <CardBody
        className={cn(
          "min-h-0 flex-col gap-4 overflow-y-clip border border-divider p-4",
          !verResumen && "justify-center",
        )}
      >
        {verResumen && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col">
              <h2 className="text-base font-semibold">
                Resumen diario
                <span className="ml-2 text-sm font-normal text-default-500">
                  {fechaLarga(dia)}
                </span>
              </h2>
              {verCotejo && resumen && (
                <p className="text-xs text-default-500">
                  {pasada
                    ? `Facturas comprobadas ${haceCuanto(pasada.cuando)}`
                    : "Sin comprobación de facturas reciente"}
                </p>
              )}
            </div>

            {error && !resumen ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-default-600">
                No se pudo cargar el resumen diario
                {verCotejo ? ` (${error})` : ""}. Comprueba la conexión y vuelve
                a intentarlo.
                <Button size="sm" variant="flat" onPress={onReintentar}>
                  Reintentar
                </Button>
              </p>
            ) : (
              <>
                {/* Lo que se facturó hoy, de cualquier día: Camagüey, por ejemplo, factura
                    el día siguiente, y contar sólo los pedidos de hoy parecía que no se
                    facturaba nada. Es la única cifra grande. El bloque entero lleva a la
                    lista de esos pedidos (enlace estirado); las dos partes del desglose
                    son enlaces propios, por encima. */}
                {verCotejo && (
                  <div className="relative -mx-2 flex items-baseline gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-default-100 motion-reduce:transition-none">
                    {esperando ? (
                      <Skeleton className="rounded-lg">
                        <span className="block h-9 w-14" />
                      </Skeleton>
                    ) : (
                      <span className="text-4xl font-semibold leading-none tabular-nums text-success-600">
                        {eseDia}
                      </span>
                    )}
                    <span className="text-sm text-default-600">
                      <Link
                        aria-label={`Facturados hoy: ${eseDia}. Ver la lista`}
                        className={cn(
                          "text-sm text-default-600",
                          ESTIRADO,
                          "after:rounded-lg",
                        )}
                        href={`/panel/panel-pedidos?${new URLSearchParams({ facturadoDia: dia, incluirArchivados: "1" })}`}
                        style={SIN_POSICION}
                      >
                        facturados hoy
                      </Link>
                      <span className="block text-xs text-default-500">
                        {desgloseFacturados}
                      </span>
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  {esperando ? (
                    <p className="px-2 text-sm text-default-600">
                      Pedidos de hoy · …
                    </p>
                  ) : (
                    <Link
                      aria-label={`Pedidos de hoy: ${t?.total ?? 0}. Ver la lista`}
                      className={cn(
                        "flex w-full justify-start gap-1 rounded-md px-2 py-1 text-sm text-default-600 hover:bg-default-100",
                        FOCO_FILA,
                      )}
                      href={enlaceLista(dia)}
                    >
                      Pedidos de hoy ·{" "}
                      <strong className="font-semibold tabular-nums text-foreground">
                        {t?.total ?? 0}
                      </strong>
                    </Link>
                  )}
                  <div
                    className={cn(
                      "grid gap-x-6",
                      verCotejo ? "grid-cols-2" : "grid-cols-3 gap-x-4",
                    )}
                    role="list"
                  >
                    <Fila
                      apilada={!verCotejo}
                      aria={`Pedidos de hoy con factura: ${conFactura}. Ver la lista`}
                      cargando={esperando}
                      etiqueta="Con factura"
                      href={enlaceLista(dia, F_CON_FACTURA)}
                      tono={conFactura ? "ok" : "suave"}
                      valor={conFactura}
                    />
                    {/* Discreto: un pedido de hoy sin factura es lo normal, se factura mañana. */}
                    <Fila
                      apilada={!verCotejo}
                      aria={`Pedidos de hoy sin factura: ${sinFactura}. Ver la lista`}
                      cargando={esperando}
                      etiqueta="Sin factura"
                      href={enlaceLista(dia, F_SIN_FACTURA)}
                      tono={sinFactura ? "base" : "suave"}
                      valor={sinFactura}
                    />
                    {/* «Buscando» es del cotejo: sólo lo ven los administradores. */}
                    {verCotejo && (
                      <Fila
                        aria={`Pedidos de hoy buscando factura: ${t?.buscando ?? 0}. Ver la lista`}
                        cargando={esperando}
                        etiqueta="Buscando factura"
                        href={enlaceLista(dia, F_SIN_FACTURA)}
                        tono={t?.buscando ? "base" : "suave"}
                        valor={t?.buscando ?? 0}
                      />
                    )}
                    <Fila
                      apilada={!verCotejo}
                      aria={`Pedidos de hoy sin completar: ${t?.sin_completar ?? 0}. Ver la lista`}
                      cargando={esperando}
                      etiqueta="Sin completar"
                      href={enlaceLista(dia, F_SIN_COMPLETAR)}
                      tono={t?.sin_completar ? "base" : "suave"}
                      valor={t?.sin_completar ?? 0}
                    />
                  </div>
                </div>

                {!esperando && t?.total === 0 && (
                  <p className="text-sm text-default-500">
                    Hoy todavía no ha entrado ningún pedido.
                  </p>
                )}
                {verCotejo && conError > 0 && (
                  <p className="text-xs text-warning-600">
                    {conError}{" "}
                    {conError === 1 ? "sucursal dio" : "sucursales dieron"}{" "}
                    error en la última comprobación.{" "}
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
            anio={anioTotales}
            cargandoTotales={cargandoTotales}
            errorTotales={errorTotales}
            ocultableEnBajo={verResumen}
            titulo={tituloTotales}
            totales={totales}
            onReintentar={onReintentarTotales}
          />
        )}
      </CardBody>
    </Card>
  );
}
