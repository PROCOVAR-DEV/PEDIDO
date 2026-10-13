import { Card, CardBody, Chip, Input, Pagination, Select, SelectItem, Spinner } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { getApiBaseUrl } from "@/config";

/**
 * La ingesta: cada archivo que n8n (o la pantalla) manda a PEDIDO, y qué pasó con él.
 *
 * # Por qué existe
 *
 * n8n manda cada CSV a PEDIDO y, si PEDIDO lo rechaza, lo mueve a la carpeta Errores del Drive
 * y da la ejecución por buena. Nadie sabía CUÁL falló ni POR QUÉ. El 12/10/2026 el archivo de
 * Deiler (Palma Soriano) llevaba horas en Errores porque lo habían dado de baja, y el de
 * Melissa (Las Tunas) cinco días; el motivo estaba dentro de las ejecuciones de n8n.
 *
 * Aquí está TODO, paginado y filtrable por sucursal —que es la carpeta del Drive de la que
 * vino el archivo—, por estado, por nombre y por fechas. Sólo el super administrador.
 */
const api = getApiBaseUrl;

type Estado = "entro" | "con_problemas" | "rechazado";

interface Fila {
  id: string;
  archivo: string | null;
  sucursal: string | null;
  fuente: string | null;
  origen: "n8n" | "pantalla";
  estado: Estado;
  estadoHttp: number;
  filas: number;
  creados: number;
  actualizados: number;
  fallidos: number;
  omitidos: number;
  /** Pedidos ya completados que el archivo volvió a traer: no se tocan. */
  congelados?: number;
  motivo: string | null;
  ms: number | null;
  createdAt: string;
}

interface Respuesta {
  data: Fila[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  resumen: Record<Estado, number>;
}

const ESTADOS: Record<Estado, { titulo: string; color: "success" | "warning" | "danger" }> = {
  entro: { titulo: "Entró", color: "success" },
  con_problemas: { titulo: "Entró con problemas", color: "warning" },
  rechazado: { titulo: "Rechazado", color: "danger" },
};

function fecha(iso: string): string {
  return new Date(iso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function hace(iso: string): string {
  const s = Math.max(Math.round((Date.now() - new Date(iso).getTime()) / 1000), 0);

  if (s < 90) return `hace ${s} s`;
  if (s < 5400) return `hace ${Math.round(s / 60)} min`;
  if (s < 172_800) return `hace ${Math.round(s / 3600)} h`;

  return `hace ${Math.round(s / 86_400)} d`;
}

export function IngestaPanel() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sucursales, setSucursales] = useState<Array<{ id: string; nombre: string; codigo: string | null }>>([]);
  const [estado, setEstado] = useState<Estado | "todo">("todo");
  const [sucursal, setSucursal] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [buscado, setBuscado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  // Lo que se teclea no dispara una consulta por letra.
  useEffect(() => {
    const t = setTimeout(() => setBuscado(busqueda), 500);

    return () => clearTimeout(t);
  }, [busqueda]);

  // Cambiar un filtro deja la página en la 1: seguir en la 4 de una lista que ahora tiene
  // dos páginas enseña una pantalla vacía.
  useEffect(() => {
    setPagina(1);
  }, [estado, sucursal, buscado, desde, hasta, porPagina]);

  useEffect(() => {
    fetch(`${api()}/sucursales`)
      .then((r) => (r.ok ? r.json() : []))
      .then((l) => setSucursales(Array.isArray(l) ? l : []))
      .catch(() => setSucursales([]));
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams({ page: String(pagina), limit: String(porPagina) });

      if (estado !== "todo") p.set("estado", estado);
      if (sucursal) p.set("sucursalId", sucursal);
      if (buscado) p.set("q", buscado);
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);

      const r = await fetch(`${api()}/orders/ingesta?${p.toString()}`);
      const j = await r.json();

      if (!r.ok) throw new Error(j?.error || "No se pudo leer la ingesta");
      setDatos(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [pagina, porPagina, estado, sucursal, buscado, desde, hasta]);

  useEffect(() => {
    cargar();
    // Se refresca sola: se mira mientras se arregla algo y quedarse congelada engaña.
    const t = setInterval(cargar, 60_000);

    return () => clearInterval(t);
  }, [cargar]);

  if (cargando && !datos) return <Spinner label="Cargando la ingesta…" />;
  if (error && !datos) return <p className="text-danger">{error}</p>;
  if (!datos) return null;

  const { resumen, pagination: pag } = datos;
  const tarjetas: Array<{ clave: Estado | "todo"; titulo: string; valor: number; pie: string }> = [
    { clave: "todo", titulo: "Archivos", valor: resumen.entro + resumen.con_problemas + resumen.rechazado, pie: "con estos filtros" },
    { clave: "entro", titulo: "Entraron", valor: resumen.entro, pie: "sin problemas" },
    { clave: "con_problemas", titulo: "Con problemas", valor: resumen.con_problemas, pie: "alguna fila falló" },
    { clave: "rechazado", titulo: "Rechazados", valor: resumen.rechazado, pie: "van a Errores" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tarjetas.map((t) => (
          <Card key={t.clave} isPressable className={estado === t.clave ? "ring-2 ring-primary" : ""} onPress={() => setEstado(t.clave)}>
            <CardBody className="py-3">
              <p className="text-xs uppercase tracking-wide text-default-500">{t.titulo}</p>
              <p className={`text-2xl font-semibold tabular-nums ${t.clave === "rechazado" && t.valor > 0 ? "text-danger" : ""}`}>
                {t.valor.toLocaleString("es")}
              </p>
              <p className="text-xs text-default-400">{t.pie}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* La sucursal ES la carpeta del Drive: cada flujo de n8n lee la suya. */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          className="max-w-[14rem]"
          label="Sucursal (carpeta del Drive)"
          selectedKeys={[sucursal || "todas"]}
          size="sm"
          onChange={(e) => setSucursal(e.target.value === "todas" ? "" : e.target.value)}
        >
          {[
            <SelectItem key="todas">Todas</SelectItem>,
            <SelectItem key="sin">Sin sucursal</SelectItem>,
            ...sucursales.map((s) => <SelectItem key={s.id}>{s.codigo ? `${s.codigo} · ${s.nombre}` : s.nombre}</SelectItem>),
          ]}
        </Select>
        <Input
          className="max-w-xs"
          isClearable
          label="Buscar"
          placeholder="Archivo, carpeta o motivo"
          size="sm"
          value={busqueda}
          onClear={() => setBusqueda("")}
          onValueChange={setBusqueda}
        />
        <Input className="max-w-[10rem]" label="Desde" size="sm" type="date" value={desde} onValueChange={setDesde} />
        <Input className="max-w-[10rem]" label="Hasta" size="sm" type="date" value={hasta} onValueChange={setHasta} />
        <Select
          className="max-w-[8rem]"
          label="Por página"
          selectedKeys={[String(porPagina)]}
          size="sm"
          onChange={(e) => setPorPagina(Number(e.target.value) || 25)}
        >
          {["10", "25", "50", "100"].map((n) => (
            <SelectItem key={n}>{n}</SelectItem>
          ))}
        </Select>
        <p className="ml-auto text-sm text-default-500">
          {pag.total === 0 ? "sin resultados" : `${(pag.page - 1) * pag.limit + 1}–${Math.min(pag.page * pag.limit, pag.total)} de ${pag.total.toLocaleString("es")}`}
        </p>
      </div>

      {datos.data.length === 0 && (
        <Card>
          <CardBody className="py-6 text-center text-default-500">
            No hay archivos con estos filtros. Desde el 13/10/2026 se apunta cada archivo que llega.
          </CardBody>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {datos.data.map((f) => {
          const e = ESTADOS[f.estado] ?? ESTADOS.entro;

          return (
            <Card key={f.id} className={f.estado === "rechazado" ? "border-medium border-danger-200" : ""}>
              <CardBody className="gap-1 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Chip color={e.color} size="sm" variant="flat">
                    {e.titulo}
                  </Chip>
                  <span className="min-w-0 break-all text-sm font-medium">{f.archivo ?? "archivo sin nombre"}</span>
                  <span className="ml-auto text-xs text-default-500" title={fecha(f.createdAt)}>
                    {fecha(f.createdAt)} · {hace(f.createdAt)}
                  </span>
                </div>
                {f.motivo && f.estado === "rechazado" && <p className="text-sm text-danger-700">{f.motivo}</p>}
                {f.motivo && f.estado === "con_problemas" && <p className="text-sm text-warning-700">{f.motivo}</p>}
                <p className="text-xs text-default-500">
                  <strong>{f.sucursal ?? "Sin sucursal"}</strong>
                  {f.fuente && <> · carpeta/flujo: {f.fuente}</>}
                  {f.origen === "pantalla" && <> · subido a mano</>} · {f.filas.toLocaleString("es")} {f.filas === 1 ? "fila" : "filas"}
                  {f.estado !== "rechazado" && (
                    <>
                      {" "}
                      · {f.creados + f.actualizados} {f.creados + f.actualizados === 1 ? "pedido" : "pedidos"}
                      {f.omitidos > 0 && <> · {f.omitidos} borrados, no entraron</>}
                      {(f.congelados ?? 0) > 0 && <> · {f.congelados} ya completados, sin cambios</>}
                    </>
                  )}
                  {f.ms != null && <> · {f.ms < 1000 ? `${f.ms} ms` : `${(f.ms / 1000).toFixed(1).replace(".", ",")} s`}</>}
                </p>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {pag.totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination showControls page={pag.page} total={pag.totalPages} onChange={setPagina} />
        </div>
      )}
    </div>
  );
}
