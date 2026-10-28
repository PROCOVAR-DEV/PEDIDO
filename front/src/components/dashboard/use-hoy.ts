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
  /** De esos, cuántos son de pedidos de ese mismo día; el resto son de días anteriores. */
  facturadosDePedidosDelDia?: number;
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
  /** Derivado por el api del orden de las dos horas: de día o cierre nocturno. */
  modo?: "dia" | "noche";
}

/** `GET /liberacion/aviso`: lo que cualquier usuario debe saber de la regla de SU sucursal. */
export interface AvisoLiberacion {
  activa: boolean;
  sucursalNombre?: string;
  modo?: "dia" | "noche";
  /** La primera hora (`ayerHasta`): en cierre nocturno, cuándo cierra. */
  primera?: string;
  /** La segunda hora (`hoyDesde`): cuándo se ve lo guardado. */
  segunda?: string;
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

/** El día anterior a uno `AAAA-MM-DD` (cuenta de calendario, sin husos: se hace a mediodía UTC). */
export const diaAnterior = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`);

  d.setUTCDate(d.getUTCDate() - 1);

  return d.toISOString().slice(0, 10);
};

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
  /** Sólo administradores: los productos de pedidos que no cruzan con Ventra. */
  verCruce?: boolean;
  /** Hay una sucursal concreta elegida: sólo entonces existe «su» regla. */
  hayRegla: boolean;
}) {
  const { verResumen, verRetenidos, hayRegla, verCruce = false } = opts;
  const dia = useDiaDeCuba();
  const [resumen, setResumen] = useState<ResumenHoy | null>(null);
  // Lo de AYER: otra consulta, el día que acaba de terminar en Cuba.
  const [ayer, setAyer] = useState<ResumenHoy | null>(null);
  const [errorAyer, setErrorAyer] = useState<string | null>(null);
  const [retenidos, setRetenidos] = useState<RetenidosHoy | null>(null);
  const [sinCruce, setSinCruce] = useState(0);
  const [aviso, setAviso] = useState<AvisoLiberacion | null>(null);
  const [regla, setRegla] = useState<ReglaHoy | null>(null);
  const [cargando, setCargando] = useState(verResumen || verRetenidos);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    async (fondo = false) => {
      if (!fondo) {
        setCargando(true);
        setError(null);
      }

      const [r, o, c, a, x, v] = await Promise.allSettled([
        verResumen
          ? pedir<ResumenHoy>("/facturacion/resumen")
          : Promise.resolve(null),
        verRetenidos
          ? pedir<{ retenidos?: RetenidosHoy }>("/orders?retenidos=1&limit=1")
          : Promise.resolve(null),
        verRetenidos && hayRegla
          ? pedir<ReglaHoy>("/liberacion")
          : Promise.resolve(null),
        verResumen
          ? pedir<ResumenHoy>(`/facturacion/resumen?dia=${diaAnterior(dia)}`)
          : Promise.resolve(null),
        verCruce
          ? pedir<{ total: number }>("/facturacion/productos-sin-cruce")
          : Promise.resolve(null),
        // Para cualquier rol: la regla de liberación de SU sucursal, si está activa.
        pedir<AvisoLiberacion>("/liberacion/aviso"),
      ]);

      // Una recarga de fondo que falla deja lo que ya se veía (como el resto del panel).
      if (r.status === "fulfilled") setResumen(r.value);
      if (o.status === "fulfilled") setRetenidos(o.value?.retenidos ?? null);
      if (c.status === "fulfilled") setRegla(c.value);
      // Un fallo aquí (p. ej. 403) no se enseña: simplemente no hay aviso.
      if (v.status === "fulfilled") setAviso(v.value?.activa ? v.value : null);
      if (x.status === "fulfilled") setSinCruce(x.value?.total ?? 0);
      if (a.status === "fulfilled") {
        setAyer(a.value);
        setErrorAyer(null);
      } else {
        setErrorAyer(
          a.reason instanceof Error ? a.reason.message : "No se pudo cargar",
        );
      }

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
    [verResumen, verRetenidos, hayRegla, verCruce, dia],
  );

  // Al cambiar el día (o los permisos) se vuelve a pedir TODO, y lo de ayer no se queda a la vista.
  useEffect(() => {
    setResumen(null);
    setAyer(null);
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
    ayer,
    errorAyer,
    sinCruce,
    aviso,
    retenidos,
    regla,
    cargando,
    error,
    recargar: cargar,
    recargarEnFondo,
  };
}
