/**
 * ¿La ubicación de este cliente es NUESTRA (la corrigió la APK de Entrega o un supervisor, o un
 * supervisor la dio por buena) y por tanto no la puede pisar Parranda?
 *
 * Lo nuestro manda más que lo de Parranda: quien corrige es quien está en la calle o quien lo revisó, y
 * Parranda manda el mismo punto viejo en cada sincronización. Sin esta regla, el 04/11/2026, 79 de las
 * 128 correcciones de la APK ya estaban deshechas.
 *
 * Puro, para probarlo solo.
 */
export function ubicacionEsNuestra(c: { geoFuente?: string | null; geoEstado?: string | null }): boolean {
  const f = c.geoFuente ?? '';

  return f === 'apk' || f.startsWith('usuario:') || c.geoEstado === 'confirmado';
}
