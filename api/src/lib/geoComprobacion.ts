/**
 * ¿La dirección escrita del cliente corresponde a su geolocalización? (issue #13)
 *
 * Se compara en los dos sentidos con lo que dice un buscador de mapas:
 *   punto → dirección   la calle, el barrio y el municipio que hay EN el punto, contra lo escrito.
 *   dirección → punto   dónde ubica el buscador el texto de la dirección, y cuánto dista del punto.
 *
 * El primero casi siempre contesta (el mapa conoce la calle de casi cualquier punto); el segundo contesta menos
 * (las direcciones cubanas con «e/», «apto», barrios…) y solo se pide cuando la calle del punto no coincide.
 * Es un AVISO para el supervisor, nunca un bloqueo.
 *
 * Puro y sin red, para probarlo solo.
 */
import { distanciaKm, normalizarTexto } from './geoDireccion';

export type GeoEstado = 'coincide' | 'revisar' | 'no_coincide' | 'sin_referencia';

export const UMBRAL_COINCIDE_KM = 0.5;
export const UMBRAL_REVISAR_KM = 2;

/** Lo que el buscador dice que hay en el punto del cliente. */
export interface DelPunto {
  calle: string | null;
  barrio: string | null;
  /** Los municipios que contesta el buscador (ciudad, municipio, condado…). Vacío si no dijo ninguno. */
  municipios: string[];
}

/** Dónde ubica el buscador el texto de la dirección. `consultado` es false si todavía no se ha pedido. */
export interface Adelante {
  consultado: boolean;
  latitud: number | null;
  longitud: number | null;
}

export interface Resultado {
  estado: GeoEstado;
  /** Distancia entre el punto y donde el buscador ubica la dirección, si la ubicó. */
  distanciaKm: number | null;
  motivo: 'calle' | 'direccion' | 'municipio' | 'sin_calle' | 'sin_datos';
}

const SIN_VALOR = new Set([
  'calle', 'c', 'cll', 'ave', 'av', 'avenida', 'calzada', 'carretera', 'camino', 'reparto', 'rpto', 'rep', 'esq', 'esquina',
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'entre', 'no', 'num', 'numero', 'nro', 'apto', 'apt', 'casa', 'edif', 'edificio',
  'bloque', 'piso', 'km', 'zona', 'sn', 'ciudad', 'pueblo', 'final', 'frente', 'calzada',
]);

/**
 * Una palabra en su forma comparable: «5ta» y «5» son la misma calle, «Acacias» y «Acacia» también. Se aplica
 * a lo escrito y a lo que dice el mapa por igual, así que no hace falta que coincidan en cómo lo escribieron.
 */
function raiz(p: string): string {
  const ordinal = p.match(/^(\d+)(?:ra|da|ta|era|mo|vo|no|ro|to|ma|a|o)?$/);

  if (ordinal) return ordinal[1];

  return p.length > 4 && p.endsWith('s') ? p.slice(0, -1) : p;
}

/** Las palabras de una vía: letras de 4 o más, y los números y ordinales («17», «6ta», «9 norte»). */
function claves(texto: string | null | undefined): string[] {
  return [
    ...new Set(
      normalizarTexto(texto)
        .split(/[^a-z0-9]+/)
        .filter((p) => p && !SIN_VALOR.has(p) && (/\d/.test(p) ? true : p.length >= 4))
        .map(raiz),
    ),
  ];
}

/**
 * Palabras que están en media Cuba y no identifican una calle: nombres de santos, puntos cardinales, tipos de
 * lugar. Se usan para NO dar por buena una calle citada de pasada (una esquina, un «entre») solo porque comparte
 * una de ellas: «Santa Rosa» no es «Santa Rita».
 */
const COMUNES = new Set([
  'santa', 'santo', 'jose', 'maria', 'antonio', 'juan', 'carlos', 'central', 'norte', 'este', 'oeste', 'nueva', 'nuevo',
  'vieja', 'viejo', 'general', 'comandante', 'capitan', 'doctor', 'parque', 'plaza', 'altos', 'bajos', 'kiosko', 'kiosco',
  'cafeteria', 'bodega', 'local', 'poblado', 'direccion', 'esquina', 'cerca', 'detras', 'frente', 'junto', 'entre',
  'martir', 'libertad', 'independencia', 'republica', 'victoria', 'cuba',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
].map(raiz));

/**
 * Las palabras de la VÍA que escribió quien tomó la dirección: lo que va antes del número, del «entre» o de la
 * coma. «Calle Martí No.201 e/ Maceo y Máximo Gómez. Las Minas» → ['marti'].
 */
export function viaEscrita(direccion: string | null | undefined): string[] {
  const t = normalizarTexto(direccion);

  if (!t) return [];

  // «Frente al hospital», «Bazar…», «Kiosko…»: un lugar de referencia, no una calle.
  if (/^(al\s+)?(frente|junto|detras|cerca|esq|esquina|bazar|kiosko|kiosco|pv)\b/.test(t)) return [];

  return claves(t.split(/\s(?:#|no\.?\s|n\s?\d|e\/|entre|\/)|,|\sesq/)[0]);
}

const interseccion = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/** ¿El municipio escrito es alguno de los que contesta el buscador? null si el buscador no dijo ninguno. */
function municipioCoincide(escrito: string | null, delPunto: string[]): boolean | null {
  const e = normalizarTexto(escrito);

  if (!e || delPunto.length === 0) return null;

  return delPunto.some((m) => {
    const n = normalizarTexto(m);

    return n === e || n.includes(e) || e.includes(n);
  });
}

export function comprobar(
  cliente: { direccion: string | null; municipio: string | null; latitud: number; longitud: number },
  delPunto: DelPunto | null,
  adelante: Adelante | null = null,
): Resultado {
  if (!delPunto) return { estado: 'sin_referencia', distanciaKm: null, motivo: 'sin_datos' };

  const via = viaEscrita(cliente.direccion);
  const muni = municipioCoincide(cliente.municipio, delPunto.municipios);

  // El punto cae en OTRO municipio que el de la dirección: es lo más claro de todo.
  if (muni === false) return { estado: 'no_coincide', distanciaKm: null, motivo: 'municipio' };

  // Sin una vía reconocible en el texto («frente al hospital», «Bazar…») no hay con qué comparar.
  if (via.length === 0) return { estado: 'sin_referencia', distanciaKm: null, motivo: 'sin_calle' };

  // Punto → dirección: la calle (o el barrio) que hay en el punto es la que dice la dirección.
  const todas = claves(cliente.direccion);

  if (interseccion(via, claves(delPunto.calle)) || (delPunto.barrio && interseccion(todas, claves(delPunto.barrio)))) {
    return { estado: 'coincide', distanciaKm: null, motivo: 'calle' };
  }

  // Una calle CITADA en la dirección (la de «entre», la de la «esquina») también vale: el punto de una esquina o de una
  // cuadra cae en cualquiera de ellas. Solo con palabras que identifican la calle (no «Santa» o «Central» a secas).
  const sinPortal = normalizarTexto(cliente.direccion).replace(/(#|\bno\.?|\bnum(?:ero)?\.?)\s*\d+\w*/g, ' ');
  const citadas = claves(sinPortal).filter((p) => !COMUNES.has(p));
  const delMapa = [...claves(delPunto.calle), ...(delPunto.barrio ? claves(delPunto.barrio) : [])];

  if (interseccion(citadas, delMapa)) return { estado: 'coincide', distanciaKm: null, motivo: 'calle' };

  // Dirección → punto: dónde ubica el buscador el texto, y cuánto dista.
  if (adelante?.consultado && adelante.latitud != null && adelante.longitud != null) {
    const d = Math.round(distanciaKm(cliente, { latitud: adelante.latitud, longitud: adelante.longitud }) * 1000) / 1000;
    const estado: GeoEstado = d < UMBRAL_COINCIDE_KM ? 'coincide' : d < UMBRAL_REVISAR_KM ? 'revisar' : 'no_coincide';

    return { estado, distanciaKm: d, motivo: 'direccion' };
  }

  // El buscador no conoce NINGUNA calle en ese punto (campo, descampado) y tampoco supo ubicar la dirección: no hay
  // con qué juzgar. Decir «revisar» ahí llenaba la lista de avisos que nadie puede comprobar con esto.
  if (adelante?.consultado && !delPunto.calle) return { estado: 'sin_referencia', distanciaKm: null, motivo: 'sin_datos' };

  // La calle del punto no es la escrita y el buscador no supo ubicar la dirección: a revisar.
  return { estado: 'revisar', distanciaKm: null, motivo: 'calle' };
}

/** ¿Hace falta preguntar dónde ubica el buscador el texto de la dirección? Solo si la calle no coincide. */
export function hayQueUbicarLaDireccion(
  cliente: { direccion: string | null; municipio: string | null; latitud: number; longitud: number },
  delPunto: DelPunto,
): boolean {
  const r = comprobar(cliente, delPunto, null);

  return r.estado === 'revisar' && r.motivo === 'calle';
}
