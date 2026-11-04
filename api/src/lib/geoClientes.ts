import prisma from '../prismaClient';
import { evaluarClientes, type GeoEstado } from './geoDireccion';

/** Cuba, con holgura: un punto fuera de aquí es un error de teclado, no una ubicación. */
export const CUBA = { latMin: 19, latMax: 24, lonMin: -86, lonMax: -74 };

export function puntoEnCuba(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= CUBA.latMin && lat <= CUBA.latMax && lon >= CUBA.lonMin && lon <= CUBA.lonMax
  );
}

export type ResumenGeo = Record<GeoEstado | 'confirmado', number>;

/**
 * Compara el punto de cada cliente activo con los de su misma calle y guarda el resultado en el cliente.
 *
 * Lo que un supervisor dio por bueno («confirmado») no se toca mientras el punto siga siendo el mismo:
 * si el punto cambia después de su revisión, se vuelve a evaluar.
 *
 * @param sucursalId solo esa sucursal; sin él, todas. La comparación es siempre dentro de cada sucursal.
 */
export async function evaluarGeoClientes(sucursalId?: string): Promise<ResumenGeo> {
  const clientes = await prisma.cliente.findMany({
    where: { activo: true, latitud: { not: null }, longitud: { not: null }, ...(sucursalId ? { sucursalId } : {}) },
    select: {
      id: true, sucursalId: true, municipio: true, direccion: true, latitud: true, longitud: true,
      geoEstado: true, geoAt: true, geoRevisadoAt: true, geoDistanciaKm: true, geoVecinoId: true,
    },
  });

  const resultado = evaluarClientes(
    clientes
      .filter((c) => puntoEnCuba(c.latitud, c.longitud))
      .map((c) => ({ id: c.id, sucursalId: c.sucursalId, municipio: c.municipio, direccion: c.direccion, latitud: c.latitud!, longitud: c.longitud! })),
  );

  const resumen: ResumenGeo = { coincide: 0, revisar: 0, no_coincide: 0, sin_referencia: 0, confirmado: 0 };
  const ids: string[] = [], estados: string[] = [], dist: Array<number | null> = [], vecinos: Array<string | null> = [];

  for (const c of clientes) {
    const r = resultado.get(c.id);

    if (!r) continue;

    // Confirmado por un supervisor y el punto no se movió desde entonces: se respeta.
    if (c.geoEstado === 'confirmado' && c.geoRevisadoAt && (!c.geoAt || c.geoAt <= c.geoRevisadoAt)) {
      resumen.confirmado++;
      continue;
    }

    resumen[r.estado]++;

    if (c.geoEstado !== r.estado || c.geoDistanciaKm !== r.distanciaKm || c.geoVecinoId !== r.vecinoId) {
      ids.push(c.id);
      estados.push(r.estado);
      dist.push(r.distanciaKm);
      vecinos.push(r.vecinoId);
    }
  }

  // Por tandas, en una sola sentencia cada una: en la primera pasada son miles de clientes.
  for (let i = 0; i < ids.length; i += 2000) {
    await prisma.$executeRaw`
      UPDATE "Client" c
         SET "geoEstado" = v.e, "geoDistanciaKm" = v.d, "geoVecinoId" = v.n, "geoEvaluadoAt" = now()
        FROM (SELECT unnest(${ids.slice(i, i + 2000)}::text[]) AS id,
                     unnest(${estados.slice(i, i + 2000)}::text[]) AS e,
                     unnest(${dist.slice(i, i + 2000)}::float8[]) AS d,
                     unnest(${vecinos.slice(i, i + 2000)}::text[]) AS n) v
       WHERE c.id = v.id`;
  }

  return resumen;
}
