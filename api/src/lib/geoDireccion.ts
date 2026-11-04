/**
 * ¿El punto del cliente cae donde dice su dirección? (issue #13 de PEDIDO)
 *
 * No se sale a ningún servicio de mapas: se compara el punto con los OTROS clientes de la MISMA
 * calle y el mismo municipio. Si en esa calle ya hay clientes puestos, un cliente nuevo tiene que
 * caer cerca de alguno. Así funciona sin conexión —es lo que el CRM tiene que hacer en el aparato— y
 * no depende de que OpenStreetMap conozca las calles de Cuba, que no trae el número del portal.
 *
 * Medido con los 13.845 clientes de PEDIDO (04/11/2026): a 500 m se pillan el 83 % de las calles
 * equivocadas simuladas, con un 11 % de avisos falsos. Es un AVISO para que lo mire el supervisor,
 * nunca un bloqueo. Solo juzga las calles con al menos 3 clientes; el resto queda «sin_referencia».
 *
 * Puro y sin base de datos, para probarlo solo y para llevarlo tal cual al CRM: la normalización de
 * la calle tiene que ser LA MISMA en el servidor y en el aparato.
 */

export type GeoEstado = 'coincide' | 'revisar' | 'no_coincide' | 'sin_referencia';

/** Hasta aquí «coincide»; entre los dos, «revisar»; desde el segundo, «no_coincide». */
export const UMBRAL_COINCIDE_KM = 0.5;
export const UMBRAL_REVISAR_KM = 2;
/** Mínimo de clientes en la calle (contando el propio) para poder juzgar. */
export const MIN_CLIENTES_EN_LA_CALLE = 3;
/** Un punto más lejos que esto del centro de su municipio se marca aunque la calle no tenga referencia. */
export const LEJOS_DEL_MUNICIPIO_KM = 25;
const MIN_PARA_CENTRO_DEL_MUNICIPIO = 10;

export interface ClienteGeo {
  id: string;
  sucursalId: string | null;
  municipio: string | null;
  direccion: string | null;
  latitud: number;
  longitud: number;
}

export interface ResultadoGeo {
  estado: GeoEstado;
  /** Distancia al cliente más cercano de su misma calle. Null si no hubo referencia. */
  distanciaKm: number | null;
  /** Ese cliente más cercano: para que el supervisor vea con quién se comparó. */
  vecinoId: string | null;
  motivo: 'calle' | 'sin_calle' | 'sin_referencia' | 'lejos_del_municipio';
}

const PALABRAS_QUE_NO_SON_LA_CALLE = new Set([
  'calle', 'c', 'cll', 'ave', 'av', 'avenida', 'calzada', 'carretera', 'camino', 'reparto', 'rpto', 'rep', 'esq', 'esquina',
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'entre', 'no', 'num', 'numero', 'nro', 'apto', 'apt', 'casa', 'edif', 'edificio',
  'bloque', 'piso', 'km', 'zona', 'sn', 'ciudad', 'pueblo',
]);

/** Minúsculas, sin tildes ni signos, con los espacios recogidos. */
export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9#/, ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Las palabras que identifican la calle de una dirección escrita a mano, o null si no hay.
 *
 * «Calle Maceo #131 entre Milla y Lastre» → ['maceo']; «Antonio Maceo 45» → ['antonio', 'maceo'].
 * Se corta donde empieza el número, el «entre» o la coma: lo que viene detrás ya no es la calle.
 */
export function palabrasDeCalle(direccion: string | null | undefined): string[] | null {
  const t = normalizarTexto(direccion);
  if (!t) return null;

  const primera = t.split(/\s(?:#|no\.?\s|n\s?\d|e\/|entre|\/)|,|\sesq/)[0];
  const palabras = primera
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !/\d/.test(p) && !PALABRAS_QUE_NO_SON_LA_CALLE.has(p));

  return palabras.length ? [...new Set(palabras)] : null;
}

/**
 * ¿Son la misma calle? «Maceo», «Calle Maceo» y «Antonio Maceo» sí: las palabras de la más corta
 * están todas en la más larga. Con una sola palabra de menos de 4 letras no se compara: «sol» o
 * «paz» casarían con cualquier cosa.
 */
export function mismaCalle(a: string[], b: string[]): boolean {
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];

  if (!corta.some((p) => p.length >= 4)) return false;

  return corta.every((p) => larga.includes(p));
}

export function distanciaKm(a: { latitud: number; longitud: number }, b: { latitud: number; longitud: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.latitud - a.latitud) * r;
  const dLon = (b.longitud - a.longitud) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitud * r) * Math.cos(b.latitud * r) * Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;

  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Evalúa a todos los clientes que se le pasan, cada uno contra los demás de SU sucursal y SU municipio.
 * Pásale solo clientes activos con punto: son las dos cosas que hacen falta para servir de referencia.
 */
export function evaluarClientes(clientes: ClienteGeo[]): Map<string, ResultadoGeo> {
  const salida = new Map<string, ResultadoGeo>();

  // Por sucursal y municipio: es dentro de cada uno donde se compara.
  const grupos = new Map<string, Array<ClienteGeo & { calle: string[] | null }>>();

  for (const c of clientes) {
    const clave = `${c.sucursalId ?? ''}|${normalizarTexto(c.municipio)}`;
    const g = grupos.get(clave) ?? [];

    g.push({ ...c, calle: palabrasDeCalle(c.direccion) });
    grupos.set(clave, g);
  }

  for (const g of grupos.values()) {
    const centro =
      g.length >= MIN_PARA_CENTRO_DEL_MUNICIPIO
        ? { latitud: mediana(g.map((c) => c.latitud)), longitud: mediana(g.map((c) => c.longitud)) }
        : null;

    // Para no comparar a todos con todos: cada palabra de calle apunta a los clientes que la llevan.
    const porPalabra = new Map<string, Array<ClienteGeo & { calle: string[] | null }>>();

    for (const c of g) {
      for (const p of c.calle ?? []) {
        const l = porPalabra.get(p) ?? [];

        l.push(c);
        porPalabra.set(p, l);
      }
    }

    for (const c of g) {
      const lejos = centro !== null && distanciaKm(c, centro) > LEJOS_DEL_MUNICIPIO_KM;

      if (!c.calle) {
        salida.set(c.id, lejos
          ? { estado: 'revisar', distanciaKm: null, vecinoId: null, motivo: 'lejos_del_municipio' }
          : { estado: 'sin_referencia', distanciaKm: null, vecinoId: null, motivo: 'sin_calle' });
        continue;
      }

      // Se parte de la palabra más larga de la calle (la más específica) y se filtra por calle entera.
      const clave = [...c.calle].sort((x, y) => y.length - x.length)[0];
      const vecinos = (porPalabra.get(clave) ?? []).filter((o) => o.id !== c.id && o.calle && mismaCalle(c.calle!, o.calle));

      if (vecinos.length + 1 < MIN_CLIENTES_EN_LA_CALLE) {
        salida.set(c.id, lejos
          ? { estado: 'revisar', distanciaKm: null, vecinoId: null, motivo: 'lejos_del_municipio' }
          : { estado: 'sin_referencia', distanciaKm: null, vecinoId: null, motivo: 'sin_referencia' });
        continue;
      }

      let mejor = vecinos[0];
      let d = distanciaKm(c, mejor);

      for (const o of vecinos) {
        const x = distanciaKm(c, o);

        if (x < d) {
          d = x;
          mejor = o;
        }
      }

      const estado: GeoEstado = d < UMBRAL_COINCIDE_KM ? 'coincide' : d < UMBRAL_REVISAR_KM ? 'revisar' : 'no_coincide';

      salida.set(c.id, { estado, distanciaKm: Math.round(d * 1000) / 1000, vecinoId: mejor.id, motivo: 'calle' });
    }
  }

  return salida;
}
