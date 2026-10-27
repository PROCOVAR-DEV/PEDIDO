import { REGLA_APAGADA, type ReglaLiberacion } from './liberacionPedidos';

/**
 * La regla de una sucursal, leída de la base.
 *
 * Con una caché de segundos: una ingesta de CSV crea cientos de pedidos seguidos y no hace
 * falta preguntar lo mismo en cada uno. Cambiarla en Configuración tarda lo que la caché.
 */
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; regla: ReglaLiberacion }>();

export function olvidarReglas(): void {
  cache.clear();
}

export async function reglaDeSucursal(sucursalId: string | null | undefined): Promise<ReglaLiberacion> {
  if (!sucursalId) return REGLA_APAGADA;

  const hit = cache.get(sucursalId);

  if (hit && Date.now() - hit.at < TTL_MS) return hit.regla;

  // Import tardío: las pruebas de funciones puras que pasan por aquí no tienen base.
  const prisma = (await import('../prismaClient')).default;
  const s = await prisma.sucursal.findUnique({
    where: { id: sucursalId },
    select: { liberacionActiva: true, liberacionAyerHasta: true, liberacionHoyDesde: true },
  });
  const regla: ReglaLiberacion = s
    ? { activa: s.liberacionActiva, ayerHasta: s.liberacionAyerHasta, hoyDesde: s.liberacionHoyDesde }
    : REGLA_APAGADA;

  cache.set(sucursalId, { at: Date.now(), regla });

  return regla;
}
