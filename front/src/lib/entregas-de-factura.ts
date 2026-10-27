/**
 * El estado de entrega de CADA factura de un pedido, para el tooltip del chip de reparto.
 *
 * Un pedido puede tener varias facturas y cada una ir en un punto distinto (una entregada,
 * otra devuelta, otra cancelada); el chip enseña el estado derivado del pedido y esto
 * desglosa de dónde sale. Las etiquetas concuerdan con «factura» (femenino) y repiten las
 * del chip (`entregaChip` en order-list.tsx) en lo demás.
 */

export interface EntregaDeFactura {
  factura: string;
  puntoDeVenta?: string | null;
  estado: string;
  at: string;
  nota?: string | null;
}

const ETIQUETA: Record<string, string> = {
  despachado: "En despacho",
  en_transito: "En ruta",
  entregado: "Entregada",
  devuelto: "Devuelta",
  cancelado: "Cancelada",
};

/** "23/10 14:12", en la hora de Cuba (donde están las sucursales), no la de quien mira. */
export function cuandoEnCuba(iso: string): string {
  const f = new Intl.DateTimeFormat("es-ES", {
    timeZone: "America/Havana",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const v = (t: string) =>
    f.formatToParts(new Date(iso)).find((p) => p.type === t)?.value ?? "";
  // Algunos motores devuelven "24" a medianoche con hour12:false.
  const hora = v("hour") === "24" ? "00" : v("hour");

  // es-ES no rellena con cero el día/mes de una cifra ("15/1"), así que se rellena aquí.
  return `${v("day").padStart(2, "0")}/${v("month").padStart(2, "0")} ${hora}:${v("minute")}`;
}

/** Una línea por factura, en el orden recibido: «Factura 47541 · Entregada · 23/10 14:12». */
export function lineasDeEntrega(
  entregas: EntregaDeFactura[],
): Array<{ clave: string; texto: string; nota: string | null }> {
  return entregas.map((e) => ({
    clave: `${e.factura}|${e.puntoDeVenta ?? ""}`,
    texto: `Factura ${e.factura} · ${ETIQUETA[e.estado] ?? e.estado} · ${cuandoEnCuba(e.at)}`,
    nota: e.nota?.trim() || null,
  }));
}

/** «2 facturas» cuando hay más de una; nada con una o ninguna. */
export function contadorDeFacturas(
  entregas: EntregaDeFactura[] | undefined,
): string | null {
  return entregas && entregas.length > 1 ? `${entregas.length} facturas` : null;
}
