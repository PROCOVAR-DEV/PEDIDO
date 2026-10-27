import type { ReglaHoy, ResumenHoy, RetenidosHoy } from "./use-hoy";

import {
  Button,
  Card,
  CardBody,
  Link,
  Progress,
  Skeleton,
} from "@heroui/react";

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

function Cifra({
  etiqueta,
  valor,
  tono = "base",
  grande = false,
  cargando,
}: {
  etiqueta: string;
  valor: number | string;
  tono?: keyof typeof TONOS;
  grande?: boolean;
  cargando: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-default-500">{etiqueta}</dt>
      <dd>
        {cargando ? (
          <Skeleton className="rounded-lg">
            <div className={grande ? "h-9 w-14" : "h-7 w-12"} />
          </Skeleton>
        ) : (
          <span
            className={cn(
              "font-semibold tabular-nums",
              grande ? "text-4xl" : "text-2xl",
              TONOS[tono],
            )}
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
 * Lo que está pasando hoy y, debajo, los totales de siempre. Sin `resumen` (el rol no
 * lo recibe) sólo queda la fila de totales.
 */
export function HoyPanel({
  verResumen,
  resumen,
  cargando,
  error,
  onReintentar,
  totales,
  cargandoTotales,
  errorTotales,
}: {
  verResumen: boolean;
  resumen: ResumenHoy | null;
  cargando: boolean;
  error: string | null;
  onReintentar: () => void;
  totales: Totales | null;
  cargandoTotales: boolean;
  errorTotales: string | null;
}) {
  const t = resumen?.totales;
  const conFactura = (t?.facturado ?? 0) + (t?.cambiado ?? 0);
  const conError = (resumen?.ultimaPasada?.sucursales ?? []).filter(
    (s) => s.error,
  ).length;
  const esperando = cargando && !resumen;

  return (
    <Card className="h-full">
      <CardBody className="gap-5 p-5">
        {verResumen && (
          <section aria-label="Hoy" className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Hoy</h2>
            {error && !resumen ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-default-500">
                No se pudo cargar lo de hoy: {error}
                <Button size="sm" variant="flat" onPress={onReintentar}>
                  Reintentar
                </Button>
              </p>
            ) : (
              <>
                {/* Lo que se facturó hoy, de cualquier día: Camagüey, por ejemplo, factura
                    el día siguiente, y contar sólo los pedidos de hoy parecía que no
                    se facturaba nada. */}
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm text-default-500">Facturados hoy</p>
                  {esperando ? (
                    <Skeleton className="rounded-lg">
                      <div className="h-10 w-16" />
                    </Skeleton>
                  ) : (
                    <p className="text-5xl font-semibold tabular-nums text-success-600">
                      {resumen?.facturadosEseDia ?? 0}
                    </p>
                  )}
                  <p className="text-xs text-default-500">
                    pedidos que recibieron factura hoy, de cualquier día
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
                  <Cifra
                    cargando={esperando}
                    etiqueta="Pedidos de hoy"
                    valor={t?.total ?? 0}
                  />
                  <Cifra
                    cargando={esperando}
                    etiqueta="De los pedidos de hoy, con factura"
                    tono={conFactura ? "ok" : "suave"}
                    valor={conFactura}
                  />
                  <Cifra
                    cargando={esperando}
                    etiqueta="Buscando factura"
                    tono={t?.buscando ? "base" : "suave"}
                    valor={t?.buscando ?? 0}
                  />
                  {/* Discreto: un pedido de hoy sin factura es lo normal, se factura mañana. */}
                  <Cifra
                    cargando={esperando}
                    etiqueta="Sin factura"
                    tono={t?.no_aparecio ? "base" : "suave"}
                    valor={t?.no_aparecio ?? 0}
                  />
                  <Cifra
                    cargando={esperando}
                    etiqueta="Sin completar"
                    tono={t?.sin_completar ? "base" : "suave"}
                    valor={t?.sin_completar ?? 0}
                  />
                </dl>
                {!esperando &&
                  t &&
                  (t.total === 0 ? (
                    <p className="text-sm text-default-500">
                      Hoy todavía no ha entrado ningún pedido.
                    </p>
                  ) : (
                    <Progress
                      aria-label="Pedidos de hoy ya facturados"
                      classNames={{ label: "text-sm text-default-500" }}
                      color="success"
                      label={`Pedidos de hoy ya facturados: ${conFactura} de ${t.total}`}
                      size="sm"
                      value={(conFactura / t.total) * 100}
                    />
                  ))}
                {!esperando && resumen && !resumen.ultimaPasada && (
                  <p className="text-xs text-default-500">
                    Aún no hay una comprobación de facturas reciente.
                  </p>
                )}
                {conError > 0 && (
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
          </section>
        )}

        <section aria-label="Totales">
          {errorTotales && !totales ? (
            <p className="text-sm text-default-500">
              No se pudieron cargar los totales de pedidos.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Cifra
                cargando={cargandoTotales}
                etiqueta="Total de pedidos"
                valor={totales?.total ?? 0}
              />
              <Cifra
                cargando={cargandoTotales}
                etiqueta="Completados"
                tono="ok"
                valor={totales?.completados ?? 0}
              />
              <Cifra
                cargando={cargandoTotales}
                etiqueta="En proceso"
                tono="aviso"
                valor={totales?.enProceso ?? 0}
              />
              <Cifra
                cargando={cargandoTotales}
                etiqueta="Expirados"
                valor={totales?.expirados ?? 0}
              />
            </dl>
          )}
        </section>
      </CardBody>
    </Card>
  );
}

/** Lo retenido por la liberación por hora: discreto si no hay nada, ámbar si hay. */
export function RetenidosCard({
  retenidos,
  regla,
  cargando,
  todas,
}: {
  retenidos: RetenidosHoy | null;
  regla: ReglaHoy | null;
  cargando: boolean;
  /** El selector está en «Todas»: se enseña el desglose y no la regla de una sucursal. */
  todas: boolean;
}) {
  const total = retenidos?.total ?? 0;
  const hay = total > 0;
  const desglose = (retenidos?.porSucursal ?? [])
    .map((x) => `${x.sucursal} ${x.total}`)
    .join(" · ");

  return (
    <Link className="block h-full" href="/panel/liberacion">
      <Card
        isPressable
        className={cn(
          "h-full w-full border",
          hay ? "border-warning-200 bg-warning-50/30" : "border-default-200",
        )}
        shadow="sm"
      >
        <CardBody className="gap-1 p-5">
          <h2 className="text-lg font-semibold">Retenidos</h2>
          {cargando && !retenidos ? (
            <Skeleton className="rounded-lg">
              <div className="h-9 w-14" />
            </Skeleton>
          ) : (
            <p
              className={cn(
                "text-4xl font-semibold tabular-nums",
                hay ? "text-warning-600" : "text-default-400",
              )}
            >
              {total}
            </p>
          )}
          <p className="text-sm text-default-500">
            {todas
              ? hay
                ? desglose
                : "No hay pedidos retenidos."
              : regla
                ? regla.activa
                  ? `${hay ? "Se liberan" : "Regla encendida: se liberan"} a las ${regla.hoyDesde}.`
                  : "La regla está apagada."
                : hay
                  ? "Esperando su hora de liberación."
                  : "No hay pedidos retenidos."}
          </p>
          <span className="mt-1 text-xs text-primary">Ver y liberar</span>
        </CardBody>
      </Card>
    </Link>
  );
}
