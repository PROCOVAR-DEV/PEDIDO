import { Button, Card, CardBody, Input, Spinner, Switch, addToast } from "@heroui/react";
import { useEffect, useState } from "react";

import { cards } from "../primitives";

import { getApiBaseUrl } from "@/config";
import { getSucursalActiva } from "@/lib/sucursal-activa";
import { mensajeDeError } from "@/lib/error-del-servidor";
import { useAuthStore } from "@/stores/authStore";

interface Liberacion {
  sucursalNombre: string;
  activa: boolean;
  ayerHasta: string;
  hoyDesde: string;
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
        if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo cargar"));
        setCfg(await r.json());
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"))
      .finally(() => setCargando(false));
  }, [sinSucursal]);

  const guardar = async () => {
    if (!cfg) return;
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
            {cfg && <span className="font-normal text-default-500"> · {cfg.sucursalNombre}</span>}
          </h3>

          {sinSucursal ? (
            <p className="text-sm text-default-500">Elige una sucursal para configurar esto</p>
          ) : cargando ? (
            <Spinner size="sm" />
          ) : error || !cfg ? (
            <p className="text-sm text-danger">{error ?? "No se pudo cargar"}</p>
          ) : (
            <>
              <Switch
                isSelected={cfg.activa}
                onValueChange={(v) => setCfg({ ...cfg, activa: v })}
              >
                Retener los pedidos del día hasta una hora
              </Switch>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Aceptar los de ayer hasta"
                  size="sm"
                  type="time"
                  value={cfg.ayerHasta}
                  onValueChange={(v) => setCfg({ ...cfg, ayerHasta: v })}
                />
                <Input
                  label="Liberar los de hoy a las"
                  size="sm"
                  type="time"
                  value={cfg.hoyDesde}
                  onValueChange={(v) => setCfg({ ...cfg, hoyDesde: v })}
                />
              </div>
              <p className="text-sm text-default-500">
                Un pedido con fecha de ayer que entra antes de la primera hora es visible en el
                acto. Uno con fecha de hoy que entra antes de la segunda queda guardado y
                facturación no lo ve hasta esa hora; después, es visible en el acto. Un pedido de
                ayer que llega pasada la primera hora cuenta como uno de hoy. El vendedor ve
                siempre los suyos. Apagar la regla libera lo retenido.
              </p>
              <div>
                <Button color="primary" isLoading={guardando} onPress={guardar}>
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
