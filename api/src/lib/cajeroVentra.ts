import { pagosPorDocumento, type LineaVentaVentra, type PagoVentra } from './ventra';

/**
 * QUIÉN COBRÓ una factura: el cajero («Caja#1-Daineris»).
 *
 * Antes un pedido completado por la factura decía «automático · factura», y eso no le dice nada a
 * quien pregunta por él: lo que se quiere saber es quién lo facturó. Ventra lo trae, pero no en la
 * línea de venta sino en el cobro (`/axis/document-payments`, campo `userName`), y ese cobro no trae el
 * número de factura. Hay uno por factura, así que se casa por lo que sí comparten: la fecha, el
 * cliente, el almacén y el importe.
 *
 * Medido el 20/10/2026 con cuatro días de cinco sucursales: se casa de forma única el 98–100 % de
 * las facturas (Camagüey 98,1 %, el resto 100 %), y nunca hubo dos cajeros distintos para la misma.
 * Si un día no casa, devuelve null y el pedido se completa igual, con la marca de siempre.
 */

const plano = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export type FacturaParaCajero = { fecha: string; cliente: string; almacen: string; total: number };

/** Una fila por factura, con lo que hace falta para encontrar su cobro. Puro. */
export function facturasDe(lineas: LineaVentaVentra[]): FacturaParaCajero[] {
  const por = new Map<string, FacturaParaCajero>();

  for (const l of lineas) {
    const f = por.get(l.operNumber) ?? {
      fecha: l.fecha.slice(0, 10),
      cliente: l.clienteNombre,
      almacen: l.almacenNombre ?? '',
      total: 0,
    };

    f.total += (l.cantidad || 0) * (l.precioUsd ?? 0) - (l.descuento || 0);
    por.set(l.operNumber, f);
  }

  return [...por.values()];
}

/** El cajero de esa factura, o null si no hay un único candidato. Puro. */
export function elegirCajero(pagos: PagoVentra[], f: FacturaParaCajero): string | null {
  const candidatos = pagos.filter(
    (p) =>
      p.fecha === f.fecha &&
      plano(p.cliente) === plano(f.cliente) &&
      plano(p.almacen) === plano(f.almacen) &&
      Math.abs(p.importe - f.total) < 0.02,
  );
  const nombres = [...new Set(candidatos.map((p) => p.cajero))];

  // Dos cobros iguales del MISMO cajero son lo mismo; dos cajeros distintos no se pueden decidir.
  return nombres.length === 1 ? nombres[0] : null;
}

// Los cobros de un día, 90 s: el carril rápido pasa cada 30 s y pide el cajero de cada pedido que
// se completa; sin esto serían decenas de consultas iguales a la VPN.
const CACHE = new Map<string, { t: number; pagos: PagoVentra[] }>();
const TTL_MS = 90_000;

async function pagosDelDia(database: string, fecha: string): Promise<PagoVentra[]> {
  const clave = `${database}|${fecha}`;
  const hit = CACHE.get(clave);

  if (hit && Date.now() - hit.t < TTL_MS) return hit.pagos;

  const pagos = await pagosPorDocumento(database, fecha, fecha);

  CACHE.set(clave, { t: Date.now(), pagos });

  return pagos;
}

/**
 * El cajero de las facturas de un pedido (varios si se facturó en dos documentos, separados por « / »).
 * NUNCA lanza: que no se sepa quién cobró no puede impedir completar el pedido.
 */
export async function cajeroDeLasFacturas(database: string, lineas: LineaVentaVentra[]): Promise<string | null> {
  try {
    const nombres = new Set<string>();

    for (const f of facturasDe(lineas)) {
      const n = elegirCajero(await pagosDelDia(database, f.fecha), f);

      if (n) nombres.add(n);
    }

    return nombres.size ? [...nombres].join(' / ') : null;
  } catch (e) {
    console.warn('[cajero] no se pudo saber quién cobró:', (e as Error).message);

    return null;
  }
}
