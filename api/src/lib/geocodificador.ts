/**
 * El buscador de mapas (Nominatim, de OpenStreetMap): qué hay en un punto y dónde está una dirección.
 *
 * El servicio público pide una petición por segundo como máximo y un identificador claro en `User-Agent`;
 * aquí se respeta con una pausa de 1,1 s entre peticiones. Lo que se consulta se guarda (ver
 * `ClienteGeocodificacion`), así que cada punto se pregunta UNA vez y solo se vuelve a preguntar si el cliente
 * se mueve. Para el punto→dirección solo salen COORDENADAS, no nombres de clientes.
 *
 * `NOMINATIM_URL` permite apuntar a uno propio el día que se monte.
 */
import type { DelPunto } from './geoComprobacion';

const BASE = (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const AGENTE = 'PROCOVAR-PEDIDO/1.0 (comprobacion de ubicaciones de clientes; uso interno)';
export const PAUSA_MS = 1100;

export class GeocodificadorCaido extends Error {}

async function pedir(ruta: string): Promise<any | null> {
  let r: Response;

  try {
    r = await fetch(`${BASE}${ruta}`, { headers: { 'User-Agent': AGENTE, 'Accept-Language': 'es' }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new GeocodificadorCaido(`sin respuesta: ${(e as Error).message}`);
  }

  // 429 (demasiadas) o 5xx: se para y se reintenta más tarde, sin insistir.
  if (r.status === 429 || r.status >= 500) throw new GeocodificadorCaido(`HTTP ${r.status}`);
  if (!r.ok) return null;

  return r.json();
}

export const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export interface PuntoGeocodificado extends DelPunto {
  provincia: string | null;
  completo: string | null;
}

/** Qué hay en ese punto. Null si el buscador no sabe nada de él. */
export async function delPunto(lat: number, lon: number): Promise<PuntoGeocodificado | null> {
  const j = await pedir(`/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`);
  const a = j?.address;

  if (!a) return null;

  const municipios = [a.municipality, a.county, a.city, a.town, a.village, a.state_district]
    .filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '');

  return {
    calle: a.road ?? a.pedestrian ?? a.footway ?? a.path ?? a.residential ?? null,
    barrio: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? null,
    municipios: [...new Set<string>(municipios)],
    provincia: a.state ?? null,
    completo: typeof j.display_name === 'string' ? j.display_name.slice(0, 400) : null,
  };
}

/** Dónde ubica el buscador el texto de una dirección, o null si no la encuentra. */
export async function deLaDireccion(texto: string): Promise<{ latitud: number; longitud: number } | null> {
  const j = await pedir(`/search?format=jsonv2&limit=1&countrycodes=cu&q=${encodeURIComponent(texto)}`);
  const x = Array.isArray(j) ? j[0] : null;
  const latitud = x ? Number(x.lat) : NaN;
  const longitud = x ? Number(x.lon) : NaN;

  return Number.isFinite(latitud) && Number.isFinite(longitud) ? { latitud, longitud } : null;
}
