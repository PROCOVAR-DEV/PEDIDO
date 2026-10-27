import { useCallback, useEffect, useRef, useState } from "react";

import { getApiBaseUrl } from "@/config";
import { mensajeDeError } from "@/lib/error-del-servidor";

/** Lo que ya da `GET /facturacion/resumen` (sin el desglose por sucursal, que aquí no se usa). */
export interface ResumenHoy {
  dia: string;
  hoy: string;
  totales: {
    total: number;
    facturado: number;
    cambiado: number;
    buscando: number;
    no_aparecio: number;
    sin_completar: number;
    sin_cotejar: number;
  };
  /** Pedidos que recibieron factura ese día, sean de la fecha que sean. */
  facturadosEseDia?: number;
  ultimaPasada: {
    cuando: string;
    segundos: number;
    sucursales: Array<{ sucursal: string; error?: string }>;
  } | null;
}

/** El campo `retenidos` de `GET /orders`. */
export interface RetenidosHoy {
  total: number;
  porSucursal: { sucursalId: string | null; sucursal: string; total: number }[];
}

/** `GET /liberacion`: sólo se pide con una sucursal concreta. */
export interface ReglaHoy {
  activa: boolean;
  ayerHasta: string;
  hoyDesde: string;
}

/** El día `AAAA-MM-DD` que es ahora en Cuba, que es donde están las sucursales y donde cambia el día. */
const hoyEnCuba = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Havana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * El día de hoy EN CUBA, vivo: cambia solo al pasar la medianoche.
 *
 * Una pestaña del panel se queda abierta días enteros. Sin esto, pasada la medianoche seguía
 * enseñando las cifras y la fecha de ayer como si fueran de «hoy». Se mira cada 30 s (barato, y
 * cubre también el portátil que hibernó o el reloj que se atrasó) y al volver a la pestaña.
 */
export function useDiaDeCuba(): string {
  const [dia, setDia] = useState(hoyEnCuba);

  useEffect(() => {
    const revisar = () => setDia(hoyEnCuba());
    const t = setInterval(revisar, 30_000);

    document.addEventListener("visibilitychange", revisar);
    window.addEventListener("focus", revisar);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", revisar);
      window.removeEventListener("focus", revisar);
    };
  }, []);

  return dia;
}

const pedir = async <T>(ruta: string): Promise<T> => {
  const r = await fetch(`${getApiBaseUrl()}${ruta}`);

  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo cargar"));

  return r.json();
};

/**
 * Lo de HOY del panel, con los datos que el api ya da. Cada bloque se pide sólo si el
 * rol lo puede ver (el api lo rechazaría igual): nada de pedir para luego esconder.
 */
export function useHoy(opts: {
  verResumen: boolean;
  verRetenidos: boolean;
  /** Hay una sucursal concreta elegida: sólo entonces existe «su» regla. */
  hayRegla: boolean;
}) {
  const { verResumen, verRetenidos, hayRegla } = opts;
  const dia = useDiaDeCuba();
  const [resumen, setResumen] = useState<ResumenHoy | null>(null);
  const [retenidos, setRetenidos] = useState<RetenidosHoy | null>(null);
  const [regla, setRegla] = useState<ReglaHoy | null>(null);
  const [cargando, setCargando] = useState(verResumen || verRetenidos);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    async (fondo = false) => {
      if (!verResumen && !verRetenidos) return;
      if (!fondo) {
        setCargando(true);
        setError(null);
      }

      const [r, o, c] = await Promise.allSettled([
        verResumen
          ? pedir<ResumenHoy>("/facturacion/resumen")
          : Promise.resolve(null),
        verRetenidos
          ? pedir<{ retenidos?: RetenidosHoy }>("/orders?retenidos=1&limit=1")
          : Promise.resolve(null),
        verRetenidos && hayRegla
          ? pedir<ReglaHoy>("/liberacion")
          : Promise.resolve(null),
      ]);

      // Una recarga de fondo que falla deja lo que ya se veía (como el resto del panel).
      if (r.status === "fulfilled") setResumen(r.value);
      if (o.status === "fulfilled") setRetenidos(o.value?.retenidos ?? null);
      if (c.status === "fulfilled") setRegla(c.value);

      const fallo = [r, o].find((x) => x.status === "rejected") as
        | PromiseRejectedResult
        | undefined;

      if (!fondo && fallo) {
        setError(
          fallo.reason instanceof Error
            ? fallo.reason.message
            : "No se pudo cargar",
        );
      }
      if (!fondo) setCargando(false);
    },
    [verResumen, verRetenidos, hayRegla],
  );

  // Al cambiar el día (o los permisos) se vuelve a pedir TODO, y lo de ayer no se queda a la vista.
  useEffect(() => {
    setResumen(null);
    setRetenidos(null);
    void cargar();
  }, [cargar, dia]);

  // Los avisos en vivo llegan a ráfagas (una importación son decenas): se juntan en una
  // sola recarga, porque el resumen recorre todos los pedidos del día.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const recargarEnFondo = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void cargar(true), 1500);
  }, [cargar]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    dia,
    resumen,
    retenidos,
    regla,
    cargando,
    error,
    recargar: cargar,
    recargarEnFondo,
  };
}
