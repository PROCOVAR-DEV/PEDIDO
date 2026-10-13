/**
 * A qué ficha va un pedido cuando el nombre que trae el archivo es el de una ficha INACTIVA.
 *
 * Cuando Parranda renombra a un cliente o le da ficha nueva, el sync deja la vieja inactiva y
 * la enlaza con `sucesorId`. Pero los archivos de los vendedores siguen trayendo el nombre
 * viejo, y la ingesta busca por nombre: los pedidos nuevos se colgaban de la ficha inactiva,
 * que el reparto y el catálogo ya no ven. Aquí se sigue la cadena hasta la ficha viva.
 *
 * Puro, con la búsqueda inyectada, para poder probarlo sin base de datos.
 */
import { esConsumoPropio } from './consumoPropio';
import { esElMismoCliente } from './nombreParecido';

export type FichaConSucesora = { id: string; activo: boolean; sucesorId: string | null };

// Una cadena real es de uno o dos saltos; más es un ciclo o un dato roto, y no se sigue.
const MAX_SALTOS = 5;

export async function fichaViva<T extends FichaConSucesora>(
  inicial: T,
  buscar: (id: string) => Promise<T | null>,
): Promise<{ ficha: T; anteriores: string[] }> {
  const anteriores: string[] = [];
  const pasadas = new Set<string>([inicial.id]);
  let ficha = inicial;

  for (let i = 0; i < MAX_SALTOS && !ficha.activo && ficha.sucesorId; i++) {
    if (pasadas.has(ficha.sucesorId)) break;

    const siguiente = await buscar(ficha.sucesorId);
    if (!siguiente) break;

    anteriores.push(ficha.id);
    pasadas.add(siguiente.id);
    ficha = siguiente;
  }

  return { ficha, anteriores };
}

/**
 * ¿La ficha SIN código `a` es el mismo cliente que `g`, que YA lleva el código que trae el archivo?
 *
 * Es el cliente que el vendedor creó sin conexión y que Parranda dio de alta con su código: ahora
 * hay dos fichas. Se unen sólo con nombres equivalentes; si el nombre no se parece, el código
 * puede ser de los que Parranda reparte a varios clientes (los «OTR») y no se toca.
 */
export function sePuedeUnir(
  a: { nombre: string; codigo: string | null; activo: boolean },
  g: { nombre: string; activo: boolean },
): boolean {
  return a.activo && !a.codigo && g.activo && !esConsumoPropio(a.nombre) && esElMismoCliente(a.nombre, g.nombre);
}
