import prisma from '../prismaClient';

/**
 * Apunta un archivo que llegó a /orders/bulk, con lo que pasó. Ver `ImportacionArchivo`.
 *
 * Es información, no el trabajo: si apuntar falla, el archivo ya se importó (o ya se
 * rechazó) y NO se tumba nada. Por eso no devuelve error ni se espera en el camino caliente.
 */
export type RegistroIngesta = {
  archivo: string | null;
  sucursalId: string | null;
  fuente: string | null;
  origen: 'n8n' | 'pantalla';
  estado: 'entro' | 'con_problemas' | 'rechazado';
  estadoHttp: number;
  filas: number;
  creados?: number;
  actualizados?: number;
  fallidos?: number;
  omitidos?: number;
  motivo?: string | null;
  ms?: number | null;
};

export async function anotarImportacion(r: RegistroIngesta): Promise<void> {
  try {
    await prisma.importacionArchivo.create({
      data: {
        archivo: r.archivo, sucursalId: r.sucursalId, fuente: r.fuente, origen: r.origen,
        estado: r.estado, estadoHttp: r.estadoHttp, filas: r.filas,
        creados: r.creados ?? 0, actualizados: r.actualizados ?? 0, fallidos: r.fallidos ?? 0,
        omitidos: r.omitidos ?? 0, motivo: r.motivo ? r.motivo.slice(0, 500) : null, ms: r.ms ?? null,
      },
    });
  } catch (e) {
    console.error('[ingesta] no se pudo apuntar el archivo:', (e as Error)?.message);
  }
}
