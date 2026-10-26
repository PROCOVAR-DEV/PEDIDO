import { Chip, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

type Fila = {
  id: string;
  gestorAntes: string | null;
  gestorAntesId: string | null;
  gestorDespues: string | null;
  gestorDespuesId: string | null;
  por: string | null;
  motivo: "pantalla" | "alta" | "usuario_borrado" | "reasignar_usuario";
  createdAt: string;
};

const MOTIVO: Record<Fila["motivo"], string> = {
  pantalla: "a mano",
  alta: "al crearlo",
  usuario_borrado: "se borró su usuario",
  reasignar_usuario: "se pasaron los vendedores de un usuario a otro",
};

/** La hora en Cuba, que es donde están las sucursales — no donde esté quien mira. */
const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-CU", {
    timeZone: "America/Havana",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const quien = (nombre: string | null, id: string | null) =>
  nombre ?? (id ? "usuario borrado" : "nadie");

/**
 * A quién estuvo ligado este vendedor: cada cambio del enlace con su usuario, con la fecha, quién
 * lo hizo y por qué vía. Existe porque, sin esto, cuando a un usuario «no le salen» los pedidos de
 * su vendedor no hay forma de saber qué tenía puesto antes ni quién lo cambió.
 */
export const HistorialEnlace = ({ vendedorId }: { vendedorId: string }) => {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();

    setFilas(null);
    setError(false);
    fetch(`${getApiBaseUrl()}/vendedores/${vendedorId}/enlaces`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no se pudo"))))
      .then((j) => setFilas(Array.isArray(j.enlaces) ? j.enlaces : []))
      .catch((e) => {
        if (e?.name !== "AbortError") setError(true);
      });

    return () => ac.abort();
  }, [vendedorId]);

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-default-50 p-3">
      <span className="text-sm font-semibold">Con quién ha estado ligado</span>
      {error ? (
        <p className="text-sm text-danger">No se pudo leer el historial.</p>
      ) : filas === null ? (
        <Spinner size="sm" />
      ) : filas.length === 0 ? (
        <p className="text-sm text-default-500">
          Todavía no hay cambios guardados. Desde ahora cada cambio de usuario queda aquí.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-default-100">
          {filas.map((f) => (
            <li key={f.id} className="flex flex-col gap-0.5 py-1.5 text-sm">
              <span>
                <Chip className="mr-1" size="sm" variant="flat">
                  {quien(f.gestorAntes, f.gestorAntesId)}
                </Chip>
                →
                <Chip className="ml-1" color="success" size="sm" variant="flat">
                  {quien(f.gestorDespues, f.gestorDespuesId)}
                </Chip>
              </span>
              <span className="text-xs text-default-500">
                {cuando(f.createdAt)} · {f.por ?? "sistema"} · {MOTIVO[f.motivo]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
