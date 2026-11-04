import prisma from '../prismaClient';
import { comprobar, hayQueUbicarLaDireccion, type DelPunto, type Adelante, type GeoEstado } from './geoComprobacion';
import { GeocodificadorCaido, PAUSA_MS, deLaDireccion, delPunto, dormir } from './geocodificador';

/** Cuba, con holgura: un punto fuera de aquí es un error de teclado, no una ubicación. */
export const CUBA = { latMin: 19, latMax: 24, lonMin: -86, lonMax: -74 };

export function puntoEnCuba(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= CUBA.latMin && lat <= CUBA.latMax && lon >= CUBA.lonMin && lon <= CUBA.lonMax
  );
}

export type ResumenGeo = Record<GeoEstado | 'confirmado' | 'pendiente', number>;

const IGUAL = 0.00001;
const mismoPunto = (a: number, b: number, c: number, d: number) => Math.abs(a - c) < IGUAL && Math.abs(b - d) < IGUAL;

type FilaGeo = {
  clienteId: string; latitud: number; longitud: number; calle: string | null; barrio: string | null; municipios: string | null;
  adelanteConsultado: boolean; adelanteLat: number | null; adelanteLon: number | null;
};

const delPuntoDe = (f: FilaGeo): DelPunto => ({ calle: f.calle, barrio: f.barrio, municipios: f.municipios ? f.municipios.split('|') : [] });
const adelanteDe = (f: FilaGeo): Adelante => ({ consultado: f.adelanteConsultado, latitud: f.adelanteLat, longitud: f.adelanteLon });

/**
 * Compara la DIRECCIÓN escrita de cada cliente con su GEOLOCALIZACIÓN, con lo que el buscador de mapas dice del
 * punto (y de la dirección), y guarda el resultado en el cliente. Ver `geoComprobacion.ts`.
 *
 * Un cliente cuyo punto todavía no se ha consultado queda SIN estado (pendiente): no se inventa nada.
 * Lo que un supervisor dio por bueno («confirmado») no se toca mientras el punto siga siendo el mismo.
 *
 * @param sucursalId solo esa sucursal; sin él, todas.
 */
export async function evaluarGeoClientes(sucursalId?: string): Promise<ResumenGeo> {
  const clientes = await prisma.cliente.findMany({
    where: { activo: true, latitud: { not: null }, longitud: { not: null }, ...(sucursalId ? { sucursalId } : {}) },
    select: {
      id: true, direccion: true, municipio: true, latitud: true, longitud: true,
      geoEstado: true, geoAt: true, geoRevisadoAt: true, geoDistanciaKm: true,
    },
  });
  const filas = new Map<string, FilaGeo>(
    (await prisma.clienteGeocodificacion.findMany({ where: { clienteId: { in: clientes.map((c) => c.id) } } })).map((f) => [f.clienteId, f]),
  );

  const resumen: ResumenGeo = { coincide: 0, revisar: 0, no_coincide: 0, sin_referencia: 0, confirmado: 0, pendiente: 0 };
  const ids: string[] = [], estados: Array<string | null> = [], dist: Array<number | null> = [];

  for (const c of clientes) {
    if (!puntoEnCuba(c.latitud, c.longitud)) continue;

    // Confirmado por un supervisor y el punto no se movió desde entonces: se respeta.
    if (c.geoEstado === 'confirmado' && c.geoRevisadoAt && (!c.geoAt || c.geoAt <= c.geoRevisadoAt)) {
      resumen.confirmado++;
      continue;
    }

    const f = filas.get(c.id);
    // Se consultó otro punto (el cliente se movió) o nunca se consultó: pendiente.
    const vigente = !!f && mismoPunto(f.latitud, f.longitud, c.latitud!, c.longitud!);
    let nuevo: { estado: GeoEstado | null; km: number | null };

    if (!f || !vigente) {
      resumen.pendiente++;
      nuevo = { estado: null, km: null };
    } else {
      const r = comprobar({ direccion: c.direccion, municipio: c.municipio, latitud: c.latitud!, longitud: c.longitud! }, delPuntoDe(f), adelanteDe(f));

      resumen[r.estado]++;
      nuevo = { estado: r.estado, km: r.distanciaKm };
    }

    if ((c.geoEstado ?? null) !== nuevo.estado || (c.geoDistanciaKm ?? null) !== nuevo.km) {
      ids.push(c.id);
      estados.push(nuevo.estado);
      dist.push(nuevo.km);
    }
  }

  // Por tandas, en una sola sentencia cada una.
  for (let i = 0; i < ids.length; i += 2000) {
    await prisma.$executeRaw`
      UPDATE "Client" c
         SET "geoEstado" = v.e, "geoDistanciaKm" = v.d, "geoVecinoId" = NULL, "geoEvaluadoAt" = now()
        FROM (SELECT unnest(${ids.slice(i, i + 2000)}::text[]) AS id,
                     unnest(${estados.slice(i, i + 2000)}::text[]) AS e,
                     unnest(${dist.slice(i, i + 2000)}::float8[]) AS d) v
       WHERE c.id = v.id`;
  }

  return resumen;
}

/**
 * Pregunta al buscador de mapas por los puntos que faltan (o que cambiaron) y, cuando la calle del punto no es la
 * escrita, también dónde ubica el texto de la dirección. Una petición por segundo: `lote` marca cuántas por pasada.
 * Si el buscador falla, se para y se sigue en la próxima pasada.
 */
export async function geocodificarPendientes(lote = 150): Promise<{ consultados: number; direcciones: number; pendientes: number; parado?: string }> {
  const clientes = await prisma.cliente.findMany({
    where: { activo: true, latitud: { not: null }, longitud: { not: null } },
    select: { id: true, direccion: true, municipio: true, latitud: true, longitud: true },
  });
  const filas = new Map<string, FilaGeo>((await prisma.clienteGeocodificacion.findMany()).map((f) => [f.clienteId, f]));
  const buenos = clientes.filter((c) => puntoEnCuba(c.latitud, c.longitud));
  const faltan = buenos.filter((c) => {
    const f = filas.get(c.id);

    return !f || !mismoPunto(f.latitud, f.longitud, c.latitud!, c.longitud!);
  });

  let consultados = 0, direcciones = 0, parado: string | undefined;

  try {
    // 1) Qué hay en cada punto, y, si la calle no es la escrita, dónde ubica el buscador la dirección.
    for (const c of faltan.slice(0, lote)) {
      const p = await delPunto(c.latitud!, c.longitud!);

      await dormir(PAUSA_MS);
      consultados++;

      const base = { latitud: c.latitud!, longitud: c.longitud!, calle: p?.calle ?? null, barrio: p?.barrio ?? null, municipios: p ? p.municipios.join('|') : null, provincia: p?.provincia ?? null, completo: p?.completo ?? null };
      const quiereDireccion = !!p && !!c.direccion && hayQueUbicarLaDireccion({ direccion: c.direccion, municipio: c.municipio, latitud: c.latitud!, longitud: c.longitud! }, p);
      let adelante: { latitud: number; longitud: number } | null = null;

      if (quiereDireccion) {
        adelante = await deLaDireccion([c.direccion, c.municipio, 'Cuba'].filter(Boolean).join(', '));
        await dormir(PAUSA_MS);
        direcciones++;
      }

      const datos = {
        ...base, consultadoAt: new Date(),
        adelanteConsultado: quiereDireccion, adelanteLat: adelante?.latitud ?? null, adelanteLon: adelante?.longitud ?? null, adelanteAt: quiereDireccion ? new Date() : null,
      };

      await prisma.clienteGeocodificacion.upsert({ where: { clienteId: c.id }, create: { clienteId: c.id, ...datos }, update: datos });
    }
  } catch (e) {
    if (!(e instanceof GeocodificadorCaido)) throw e;
    parado = e.message;
  }

  if (consultados > 0) await evaluarGeoClientes();

  return { consultados, direcciones, pendientes: Math.max(0, faltan.length - consultados), parado };
}

/** Cada 5 minutos, una tanda de puntos por consultar. Aquí (worker) y no en la API: son peticiones lentas a un servicio externo. */
export function arrancarGeocodificacion(): void {
  let corriendo = false;
  const correr = () => {
    if (corriendo) return;
    corriendo = true;
    geocodificarPendientes()
      .then((r) => { if (r.consultados > 0 || r.parado) console.log(`[geocodificacion] ${r.consultados} puntos, ${r.direcciones} direcciones, quedan ${r.pendientes}${r.parado ? ` (parado: ${r.parado})` : ''}`); })
      .catch((e) => console.error('[geocodificacion] fallo:', e))
      .finally(() => { corriendo = false; });
  };
  setTimeout(correr, 60_000).unref();
  setInterval(correr, 5 * 60_000).unref();
}
