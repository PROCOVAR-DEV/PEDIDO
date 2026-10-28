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
 * Liberación de pedidos por hora, de UNA sucursal (la del selector).
 * La regla vive en el api; aquí solo se enciende y se ponen las dos horas.
 */
export const LiberacionPedidos = () => {
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

  // Horas de ejemplo que SÍ caen dentro (y fuera) de lo que se guarda, para que el ejemplo sea cierto.
  // De día: una hora antes de la segunda. Cierre nocturno: media hora después de cerrar (dentro)
  // y la mitad del día abierto (fuera).
  const ejemploDentro = !modo
    ? ""
    : modo === "dia"
      ? deMinutos(aMinutos(B) - 60)
      : deMinutos(Math.min(aMinutos(A) + 30, 23 * 60 + 59));
  const ejemploFuera =
    modo === "noche" ? deMinutos((aMinutos(A) + aMinutos(B)) / 2) : "";

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

  return (
    <Card className={`${cards()} h-full`}>
      <CardBody>
        <div className="flex flex-col gap-4">
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
              {iguales ? (
                <p className="text-sm text-danger" role="alert">
                  Las dos horas no pueden ser la misma.
                </p>
              ) : (
                <p className="text-sm text-default-600">
                  {modo === "dia" &&
                    `Funciona así: los pedidos de ayer que entran antes de las ${hora12(A)} se ven en el acto. Los pedidos de hoy que entran antes de las ${hora12(B)} se guardan y se ven a las ${hora12(B)}. Ejemplo: un pedido que entra a las ${hora12(ejemploDentro)} se ve a las ${hora12(B)}.`}
                  {modo === "noche" &&
                    `Funciona así: a las ${hora12(A)} se cierran los pedidos y a las ${hora12(B)} se reabren. Lo que entra entre esas dos horas se guarda y se ve a las ${hora12(B)}. Ejemplo: un pedido que entra a las ${hora12(ejemploDentro)} se ve mañana a las ${hora12(B)}; uno que entra a las ${hora12(ejemploFuera)} se ve en el acto.`}
                  {modo === null && "Pon las dos horas."}
                </p>
              )}
              <p className="text-sm text-default-500">
                Los vendedores siempre ven sus propios pedidos. Si apagas la
                regla, todo lo guardado se libera al momento.
              </p>
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
