import prisma from '../prismaClient';

/**
 * El historial de un pedido: cuándo, quién y por qué vía se creó, se editó, se completó o se
 * reabrió. Ver `PedidoHistorial`.
 *
 * Es información, no el trabajo: si apuntar falla, el pedido ya se guardó y NO se tumba nada.
 * Por eso `anotarHistorial` no lanza y no devuelve error.
 */
export type TipoHistorial = 'creado' | 'editado' | 'ignorado' | 'completado' | 'reabierto';

/** Quién y desde dónde: lo mismo para todas las filas de una tanda. */
export type ContextoHistorial = {
  origen: 'n8n' | 'pantalla' | 'sistema';
  /** El usuario, si fue una persona. */
  por?: string | null;
  archivo?: string | null;
  /** El flujo de n8n («Ingesta Habana»); en la pantalla no hay. */
  fuente?: string | null;
};

export type Anotacion = {
  pedidoId: string;
  tipo: TipoHistorial;
  campo?: string | null;
  antes?: string | null;
  despues?: string | null;
  nota?: string | null;
};

export async function anotarHistorial(ctx: ContextoHistorial, filas: Anotacion[]): Promise<void> {
  if (filas.length === 0) return;

  try {
    await prisma.pedidoHistorial.createMany({
      data: filas.map((f) => ({
        pedidoId: f.pedidoId,
        tipo: f.tipo,
        origen: ctx.origen,
        por: ctx.por ?? null,
        archivo: ctx.archivo ?? null,
        fuente: ctx.fuente ?? null,
        campo: f.campo ?? null,
        antes: f.antes ?? null,
        despues: f.despues ?? null,
        nota: f.nota ?? null,
      })),
    });
  } catch (e) {
    console.error('[historial] no se pudo apuntar:', (e as Error)?.message);
  }
}
