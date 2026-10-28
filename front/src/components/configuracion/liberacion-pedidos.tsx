import {
  Button,
  Card,
  CardBody,
  Input,
  Spinner,
  Switch,
  addToast,
} from "@heroui/react";
import { useEffect, useState } from "react";

import { cards } from "../primitives";

import { getApiBaseUrl } from "@/config";
import { getSucursalActiva } from "@/lib/sucursal-activa";
import { mensajeDeError } from "@/lib/error-del-servidor";
import { useAuthStore } from "@/stores/authStore";
import { aMinutos, deMinutos, hora12 } from "@/lib/hora12";

interface Liberacion {
  sucursalNombre: string;
  activa: boolean;
  /** La PRIMERA hora (el api la llama así por el modo de día). */
  ayerHasta: string;
  /** La SEGUNDA hora. */
  hoyDesde: string;
  modo?: "dia" | "noche";
}

/**
 * La regla de liberación de la sucursal elegida: se carga UNA vez y la comparten la tarjeta
 * (que la edita) y la explicación (que se actualiza en vivo con lo que se teclea).
 */
export function useReglaLiberacion() {
  const { session } = useAuthStore();
  // Un global en «Todas» no tiene sucursal que configurar: el api contestaría 400.
  const sinSucursal = !!session?.isGlobalAdmin && !getSucursalActiva();
  const [cfg, setCfg] = useState<Liberacion | null>(null);
  const [cargando, setCargando] = useState(!sinSucursal);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sinSucursal) return;
    fetch(`${getApiBaseUrl()}/liberacion`)
      .then(async (r) => {
        if (!r.ok)
          throw new Error(await mensajeDeError(r, "No se pudo cargar"));
        setCfg(await r.json());
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudo cargar"),
      )
      .finally(() => setCargando(false));
  }, [sinSucursal]);

  // El modo lo decide el ORDEN de las dos horas: primera antes que segunda = de día;
  // primera después = cierre nocturno; iguales = no vale (el api también lo rechaza).
  const A = cfg?.ayerHasta ?? "";
  const B = cfg?.hoyDesde ?? "";
  const iguales = !!A && A === B;
  const modo: "dia" | "noche" | null =
    !A || !B || iguales ? null : A < B ? "dia" : "noche";

  const guardar = async () => {
    if (!cfg || iguales) return;
    setGuardando(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/liberacion`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activa: cfg.activa,
          ayerHasta: cfg.ayerHasta,
          hoyDesde: cfg.hoyDesde,
        }),
      });

      if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo guardar"));
      setCfg(await r.json());
      addToast({ title: "Guardado", color: "success" });
    } catch (e) {
      addToast({
        title: "Error",
        description: e instanceof Error ? e.message : "No se pudo guardar",
        color: "danger",
      });
    } finally {
      setGuardando(false);
    }
  };

  return {
    sinSucursal,
    cfg,
    setCfg,
    cargando,
    guardando,
    error,
    A,
    B,
    iguales,
    modo,
    guardar,
  };
}

export type ReglaLiberacion = ReturnType<typeof useReglaLiberacion>;

/** Lo imprescindible: sucursal, interruptor, las dos horas y Guardar. */
export const LiberacionPedidos = ({ regla }: { regla: ReglaLiberacion }) => {
  const {
    sinSucursal,
    cfg,
    setCfg,
    cargando,
    guardando,
    error,
    iguales,
    modo,
    guardar,
  } = regla;

  return (
    <Card className={`${cards()} h-full`}>
      <CardBody>
        <div className="flex h-full flex-col justify-between gap-4">
          <h3 className="text-lg font-semibold text-primary">
            Liberación de pedidos
          </h3>

          {sinSucursal ? (
            <p className="text-sm text-default-500">
              Elige una sucursal para configurar esto
            </p>
          ) : cargando ? (
            <Spinner size="sm" />
          ) : error || !cfg ? (
            <p className="text-sm text-danger">
              {error ?? "No se pudo cargar"}
            </p>
          ) : (
            <>
              <p className="text-sm">
                Esto se aplica a todos los pedidos de{" "}
                <strong className="font-semibold">{cfg.sucursalNombre}</strong>.
              </p>
              <Switch
                isSelected={cfg.activa}
                onValueChange={(v) => setCfg({ ...cfg, activa: v })}
              >
                Activar el horario de pedidos
              </Switch>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  description={
                    modo === "noche"
                      ? "Se cierran los pedidos a esta hora"
                      : "Los de ayer se aceptan hasta esta hora"
                  }
                  label="Primera hora"
                  size="sm"
                  type="time"
                  value={cfg.ayerHasta}
                  onValueChange={(v) => setCfg({ ...cfg, ayerHasta: v })}
                />
                <Input
                  description={
                    modo === "noche"
                      ? "Se reabren a esta hora"
                      : "Los de hoy se liberan a esta hora"
                  }
                  label="Segunda hora"
                  size="sm"
                  type="time"
                  value={cfg.hoyDesde}
                  onValueChange={(v) => setCfg({ ...cfg, hoyDesde: v })}
                />
              </div>
              {iguales && (
                <p className="text-sm text-danger" role="alert">
                  Las dos horas no pueden ser la misma.
                </p>
              )}
              <div>
                <Button
                  color="primary"
                  isDisabled={iguales}
                  isLoading={guardando}
                  onPress={guardar}
                >
                  Guardar
                </Button>
              </div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
};

/**
 * «Cómo funciona», de ancho completo debajo de las dos tarjetas. Lee los mismos valores
 * que la tarjeta, así que cambia en vivo mientras se teclean las horas.
 */
export const LiberacionExplicacion = ({
  regla,
}: {
  regla: ReglaLiberacion;
}) => {
  const { sinSucursal, cfg, cargando, error, A, B, modo } = regla;

  if (sinSucursal || cargando || error || !cfg) return null;

  // Horas de ejemplo que SÍ caen dentro (y fuera) de lo que se guarda, para que el ejemplo sea cierto.
  // De día: una hora antes de la segunda. Cierre nocturno: media hora después de cerrar (dentro)
  // y la mitad del día abierto (fuera).
  const dentro =
    modo === "dia"
      ? deMinutos(aMinutos(B) - 60)
      : modo === "noche"
        ? deMinutos(Math.min(aMinutos(A) + 30, 23 * 60 + 59))
        : "";
  const fuera =
    modo === "noche" ? deMinutos((aMinutos(A) + aMinutos(B)) / 2) : "";

  return (
    <section
      aria-label="Cómo funciona"
      className="flex gap-3 rounded-xl border border-primary-200 bg-primary-50/50 p-4"
    >
      <svg
        aria-hidden
        className="mt-0.5 size-5 shrink-0 text-primary"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-sm font-semibold">Cómo funciona</h2>
        {modo === null ? (
          <p className="text-sm text-default-600">
            Pon dos horas distintas para ver cómo funciona.
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-2 text-sm text-default-700 lg:grid-cols-2">
            <p>
              {modo === "dia"
                ? `Los pedidos de ayer que entran antes de las ${hora12(A)} se ven en el acto. Los pedidos de hoy que entran antes de las ${hora12(B)} se guardan y se ven a las ${hora12(B)}.`
                : `A las ${hora12(A)} se cierran los pedidos y a las ${hora12(B)} se reabren. Lo que entra entre esas dos horas se guarda y se ve a las ${hora12(B)}.`}
            </p>
            <p>
              {modo === "dia"
                ? `Ejemplo: un pedido que entra a las ${hora12(dentro)} se ve a las ${hora12(B)}.`
                : `Ejemplo: un pedido que entra a las ${hora12(dentro)} se ve mañana a las ${hora12(B)}; uno que entra a las ${hora12(fuera)} se ve en el acto.`}
            </p>
          </div>
        )}
        <p className="text-sm text-default-500">
          Los vendedores siempre ven sus propios pedidos. Si apagas la regla,
          todo lo guardado se libera al momento.
        </p>
      </div>
    </section>
  );
};
