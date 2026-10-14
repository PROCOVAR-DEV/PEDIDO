import { Button, Chip, Popover, PopoverContent, PopoverTrigger, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * QUÉ LE PASÓ AL PEDIDO: cuándo, quién y por dónde.
 *
 * Nació de una duda que la pantalla no podía contestar: una administradora dijo que un pedido
 * se había editado después de completarlo, y el pedido sólo sabía CUÁNDO se completó. Aquí se
 * ve si lo cambió un archivo (con su nombre y su carpeta), una persona o el sistema — y los
 * intentos de cambio que se rechazaron por estar ya completado.
 *
 * Va en un botón junto a «Subido al sistema» y se abre en un desplegable APARTE, no dentro del
 * detalle: el detalle ya es largo y un historial con varias ediciones lo estiraría más. Se pide
 * al abrirlo, no con la lista ni con el detalle: son miles de pedidos y se mira uno.
 */
type Fila = {
  id: string;
  at: string;
  tipo: "creado" | "editado" | "ignorado" | "completado" | "reabierto";
  por: string | null;
  origen: "n8n" | "pantalla" | "sistema";
  archivo: string | null;
  fuente: string | null;
  campo: string | null;
  antes: string | null;
  despues: string | null;
  nota: string | null;
};

const TITULO: Record<Fila["tipo"], { texto: string; color: "default" | "warning" | "success" | "primary" | "danger" }> = {
  creado: { texto: "Entró", color: "default" },
  editado: { texto: "Editado", color: "warning" },
  ignorado: { texto: "Cambio rechazado", color: "danger" },
  completado: { texto: "Completado", color: "success" },
  reabierto: { texto: "Reabierto", color: "primary" },
};

/** La hora en Cuba, que es donde están las sucursales — no donde esté quien mira. */
const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    timeZone: "America/Havana",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Por dónde llegó: el archivo y su carpeta, la pantalla o el sistema. */
function porDonde(f: Fila): string {
  if (f.origen === "sistema") return f.por ?? "Automático";
  const via =
    f.origen === "n8n"
      ? `Archivo${f.archivo ? ` ${f.archivo}` : ""}${f.fuente ? ` · ${f.fuente}` : ""}`
      : f.archivo
        ? `Subido desde la pantalla · ${f.archivo}`
        : "Desde la pantalla";

  return f.por ? `${f.por} · ${via}` : via;
}

/** Un cambio en una línea: «PARRANDA 0.5L: 90 u → 135 u». Sin «antes» es una línea nueva. */
function cambio(f: Fila): string {
  if (f.antes == null && f.despues != null) return `${f.campo}: línea nueva, ${f.despues}`;
  if (f.campo == null) return f.nota ?? "";
  if (f.antes == null && f.despues == null) return `${f.campo}${f.nota ? `: ${f.nota}` : ""}`;

  return `${f.campo}: ${f.antes ?? "vacío"} → ${f.despues ?? "vacío"}${f.nota && f.tipo === "editado" ? ` (${f.nota})` : ""}`;
}

/** Las filas que son del mismo golpe —un archivo cambió tres líneas— van bajo UN encabezado. */
function agrupar(filas: Fila[]): Fila[][] {
  const grupos: Fila[][] = [];

  for (const f of filas) {
    const ultimo = grupos[grupos.length - 1];
    const a = ultimo?.[0];
    const mismoGolpe =
      a &&
      a.tipo === f.tipo &&
      a.origen === f.origen &&
      a.por === f.por &&
      a.archivo === f.archivo &&
      a.fuente === f.fuente &&
      Math.abs(new Date(f.at).getTime() - new Date(a.at).getTime()) < 60_000;

    if (mismoGolpe && (f.tipo === "editado" || f.tipo === "ignorado")) ultimo.push(f);
    else grupos.push([f]);
  }

  return grupos;
}

export const HistorialPedido = ({ pedidoId }: { pedidoId: string }) => {
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [falla, setFalla] = useState(false);

  // Cada vez que se abre se vuelve a pedir: el pedido pudo cambiar desde la última vez.
  useEffect(() => {
    if (!abierto) return;

    const control = new AbortController();

    setFalla(false);
    setFilas(null);
    fetch(`${getApiBaseUrl()}/orders/${pedidoId}/historial`, { signal: control.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { historial: Fila[] }) => setFilas(j.historial))
      .catch((e) => {
        if (e?.name !== "AbortError") setFalla(true);
      });

    return () => control.abort();
  }, [abierto, pedidoId]);

  return (
    <Popover isOpen={abierto} placement="bottom-end" onOpenChange={setAbierto}>
      <PopoverTrigger>
        <Button className="h-6 min-w-0 px-2 text-xs" color="primary" size="sm" variant="light">
          Ver historial
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="max-h-[60vh] w-[min(92vw,28rem)] overflow-y-auto p-2">
          <h4 className="mb-2 text-sm font-semibold text-default-700">Historial del pedido</h4>
          {falla ? (
            <p className="text-xs text-default-500">No se pudo cargar el historial.</p>
          ) : filas === null ? (
            <Spinner size="sm" />
          ) : filas.length === 0 ? (
            <p className="text-xs text-default-500">
              Sin movimientos guardados. El historial se empezó a llevar el 14/10/2026: lo anterior no se
              registró.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {agrupar(filas).map((grupo) => {
                const f = grupo[0];
                const t = TITULO[f.tipo];

                return (
                  <li key={f.id} className="rounded-lg bg-default-50 p-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Chip color={t.color} size="sm" variant="flat">
                        {t.texto}
                      </Chip>
                      <span className="text-xs tabular-nums text-default-600">{cuando(f.at)}</span>
                    </div>
                    <p className="mt-1 break-words text-xs text-default-500">{porDonde(f)}</p>
                    {f.tipo === "ignorado" && (
                      <p className="mt-1 text-xs text-danger-600">
                        El pedido ya estaba completado: el archivo intentó esto y no se aplicó.
                      </p>
                    )}
                    {(f.tipo === "editado" || f.tipo === "ignorado") && (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {grupo.map((g) => (
                          <li key={g.id} className="break-words text-sm">
                            {cambio(g)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {f.tipo !== "editado" && f.tipo !== "ignorado" && f.nota && (
                      <p className="mt-1 text-xs text-default-500">{f.nota}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
