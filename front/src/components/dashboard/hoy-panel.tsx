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

/** Una línea del resumen: la etiqueta a la izquierda, la cifra a la derecha, misma línea base. */
function Fila({
  etiqueta,
  valor,
  tono = "base",
  cargando,
}: {
  etiqueta: string;
  valor: number;
  tono?: keyof typeof TONOS;
  cargando: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1.5">
      <dt className="text-sm text-default-600">{etiqueta}</dt>
      <dd>
        {cargando ? (
          <Skeleton className="rounded">
            <span className="block h-5 w-8" />
          </Skeleton>
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
 * Resumen, sin cajas: una sola cifra grande («Facturados hoy») y el resto en líneas
 * finas separadas por filetes. Sin `resumen` (el rol no lo recibe) sólo quedan los totales.
 */
export function Resumen({
  verResumen,
  verTotales,
  resumen,
  cargando,
  error,
  onReintentar,
  totales,
  cargandoTotales,
  errorTotales,
  onReintentarTotales,
}: {
  verResumen: boolean;
  verTotales: boolean;
  resumen: ResumenHoy | null;
  cargando: boolean;
  error: string | null;
  onReintentar: () => void;
  totales: Totales | null;
  cargandoTotales: boolean;
  errorTotales: string | null;
  onReintentarTotales: () => void;
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
      aria-label="Resumen"
      className={cn("flex flex-col gap-5", !verResumen && "justify-center")}
    >
      {verResumen && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="text-base font-semibold">Hoy</h2>
            {pasada && (
              <span className="text-xs text-default-500">
                Facturas comprobadas {haceCuanto(pasada.cuando)}
              </span>
            )}
          </div>

          {error && !resumen ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-default-600">
              No se pudo cargar lo de hoy ({error}). Comprueba la conexión y
              vuelve a intentarlo.
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
                    <span className="block h-11 w-16" />
                  </Skeleton>
                ) : (
                  <span className="text-5xl font-semibold leading-none tabular-nums text-success-600">
                    {resumen?.facturadosEseDia ?? 0}
                  </span>
                )}
                <span className="text-sm text-default-600">
                  facturados hoy
                  <span className="block text-xs text-default-500">
                    pedidos que recibieron factura hoy, de cualquier día
                  </span>
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <Fila
                  cargando={esperando}
                  etiqueta="Pedidos de hoy"
                  valor={t?.total ?? 0}
                />
                <Fila
                  cargando={esperando}
                  etiqueta="De ellos, con factura"
                  tono={conFactura ? "ok" : "suave"}
                  valor={conFactura}
                />
                <Fila
                  cargando={esperando}
                  etiqueta="Buscando factura"
                  tono={t?.buscando ? "base" : "suave"}
                  valor={t?.buscando ?? 0}
                />
                {/* Discreto: un pedido de hoy sin factura es lo normal, se factura mañana. */}
                <Fila
                  cargando={esperando}
                  etiqueta="Sin factura"
                  tono={t?.no_aparecio ? "base" : "suave"}
                  valor={t?.no_aparecio ?? 0}
                />
                <Fila
                  cargando={esperando}
                  etiqueta="Sin completar"
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

      {verTotales && (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Pedidos en total</h2>
          {errorTotales && !totales ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-default-600">
              No se pudieron cargar los totales. Vuelve a intentarlo.
              <Button size="sm" variant="flat" onPress={onReintentarTotales}>
                Reintentar
              </Button>
            </p>
          ) : (
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
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
      )}
    </section>
  );
}
