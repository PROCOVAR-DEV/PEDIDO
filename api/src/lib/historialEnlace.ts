import prisma from '../prismaClient';

/**
 * A quién estuvo ligado cada vendedor. Ver `VendedorEnlace`.
 *
 * Es información, no el trabajo: si apuntar falla, el cambio ya se hizo y NO se tumba nada. Por eso
 * no lanza. Guarda el NOMBRE del usuario además de su id, para que el historial se pueda leer aunque
 * el usuario ya no exista.
 */
export type CambioDeEnlace = {
  vendedorId: string;
  vendedorNombre?: string | null;
  antesId: string | null;
  despuesId: string | null;
  por?: string | null;
  motivo: 'pantalla' | 'alta' | 'usuario_borrado' | 'reasignar_usuario';
};

export async function anotarEnlaces(cambios: CambioDeEnlace[]): Promise<void> {
  // Un «cambio» al mismo valor no es un cambio.
  const reales = cambios.filter((c) => (c.antesId ?? null) !== (c.despuesId ?? null));
  if (reales.length === 0) return;

  try {
    const ids = [...new Set(reales.flatMap((c) => [c.antesId, c.despuesId]).filter((x): x is string => !!x))];
    const usuarios = ids.length
      ? await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
      : [];
    const nombre = new Map(usuarios.map((u) => [u.id, u.username]));

    await prisma.vendedorEnlace.createMany({
      data: reales.map((c) => ({
        vendedorId: c.vendedorId,
        vendedorNombre: c.vendedorNombre ?? null,
        gestorAntesId: c.antesId,
        gestorAntes: c.antesId ? (nombre.get(c.antesId) ?? null) : null,
        gestorDespuesId: c.despuesId,
        gestorDespues: c.despuesId ? (nombre.get(c.despuesId) ?? null) : null,
        por: c.por ?? null,
        motivo: c.motivo,
      })),
    });
  } catch (e) {
    console.error('[enlace] no se pudo apuntar:', (e as Error)?.message);
  }
}
