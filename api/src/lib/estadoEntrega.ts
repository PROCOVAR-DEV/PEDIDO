/**
 * En qué va cada entrega: lo que el REPARTO nos escribe de vuelta.
 *
 * Vive aquí y no en una ruta porque entra por dos puertas distintas y tiene que hacer
 * exactamente lo mismo en las dos:
 *
 *   /integration/orders/status   la puerta vieja, con la clave de servicio. La usa la
 *                                delivery de siempre y no se toca.
 *   /webhooks/reparto/estados    la de delivery-logistica: misma clave y ADEMÁS firmada,
 *                                que es lo que hace falta en una puerta que escribe.
 *
 * Con la lógica copiada en las dos, el día que se añada un estado se añade en una y la
 * otra empieza a rechazarlo sin que nadie lo note hasta que un camión ya salió.
 */
import prisma from '../prismaClient';
import { emitEvent } from './events';
import { readConfiguredSucursalId } from './sucursalLocal';

/**
 * Los cinco. `devuelto` y `cancelado` NO tocan el inventario: el reintegro lo hace
 * Ventra y la cuenta de lo que baja del camión la lleva el logístico.
 */
export const ESTADOS_ENTREGA = new Set(['despachado', 'en_transito', 'entregado', 'devuelto', 'cancelado']);

export const TOPE_POR_LLAMADA = 500;

export interface EstadoQueLlega {
  /** El id interno. Si viene, manda: es el camino de siempre. */
  pedidoId?: string;
  /**
   * Alternativa a `pedidoId` (desde el 22/10/2026): el folio del pedido, el `orderNumber`
   * de la nota de la factura. Reparto trabaja por factura y ya no conoce nuestro id.
   */
  folio?: string;
  /** Sólo con `folio`: id o código (`CAM`) de la sucursal. Estrecha la búsqueda, NUNCA la amplía. */
  sucursal?: string;
  /**
   * El número de la factura de Ventra a la que se refiere el aviso. Con él, el estado se
   * guarda POR FACTURA (un pedido puede tener varias). Sin él, el camino de siempre.
   */
  factura?: string;
  /** Sólo con `factura`: el punto de venta, por si dos tienen el mismo número. */
  puntoDeVenta?: string;
  estado?: string;
  nota?: string;
  at?: string;
}

export interface ResultadoEstados {
  ok: boolean;
  recibidos: number;
  aplicados: Array<{
    pedidoId: string;
    folio: string;
    estado: string;
    factura?: string;
    /** El aviso era más antiguo que el guardado de esa factura: se acusa recibo y no se pisa. */
    ignorado?: 'anterior_al_guardado';
  }>;
  rechazados: Array<{ pedidoId?: string; folio?: string; motivo: string }>;
}

/**
 * El folio tal como lo guardamos, aunque llegue con otra capitalización, con espacios, con
 * guiones raros (‐ – —) o con la `P-` de la nota delante.
 *
 * No existía un normalizador así: el cotejo (`emparejarFactura`) compara el folio EXACTO y
 * avisa de que quitar guiones es peligroso (`…-1828` y `…-1828-1` son dos pedidos). Por eso
 * aquí NO se quitan los guiones: sólo se limpia lo que no cambia de qué folio se habla.
 */
export function folioTolerante(folio: unknown): string {
  return String(folio ?? '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/^P-/, '');
}

export interface EntregaGuardada {
  factura: string;
  estado: string;
  nota: string | null;
  at: Date;
}

/**
 * El estado de entrega del PEDIDO, derivado de sus facturas. La regla, entera:
 *
 *   1. Si TODAS las facturas conocidas están `entregado`  ->  `entregado`.
 *   2. Si no, el estado de la factura con `at` más reciente (empate: la de número mayor,
 *      para que el resultado no dependa del orden en que la base devuelva las filas).
 *
 * Es literal (la 1 sale sola de la 2): con una factura `cancelado` y otra `entregado` no se cumple la 1 y manda la
 * más reciente. «Conocidas» son las que Reparto ha avisado; una factura de la que nunca se
 * ha avisado no existe aquí. Sin ninguna, `null`: el pedido conserva su estado de siempre.
 */
export function derivarEstadoDelPedido(
  filas: EntregaGuardada[],
): { estado: string; at: Date; nota: string | null } | null {
  if (filas.length === 0) return null;

  // La regla 1 es consecuencia de la 2 (si todas son `entregado`, la más reciente lo es);
  // se escribe aparte porque es lo que Jose pidió y lo que se quiere leer.
  const { estado, at, nota } = [...filas].sort(
    (a, b) => b.at.getTime() - a.at.getTime() || (a.factura < b.factura ? 1 : -1),
  )[0];

  return { estado, at, nota };
}

/**
 * Aplica los estados que vengan. En LOTE y por separado: que un pedido venga mal no es
 * razón para descartar los otros cuarenta que venían bien, y quien llama necesita saber
 * cuál de los suyos no entró y por qué, no un «falló» sobre el lote entero.
 *
 * `pedidoParaLista` se pasa desde fuera para no arrastrar aquí media ruta de pedidos.
 */
export async function aplicarEstadosDeEntrega(
  pedidos: EstadoQueLlega[],
  pedidoParaLista: (id: string) => Promise<unknown>,
): Promise<ResultadoEstados> {
  const local = readConfiguredSucursalId();
  const alcance = local ? { sucursalId: local } : {};
  const aplicados: ResultadoEstados['aplicados'] = [];
  const rechazados: ResultadoEstados['rechazados'] = [];
  const tocados: Array<{ id: string; sucursalId: string | null }> = [];
  const marcar = (t: { id: string; sucursalId: string | null }) => {
    if (!tocados.some((x) => x.id === t.id)) tocados.push(t);
  };
  /** `sucursal` del cuerpo -> id (o null si no existe): una consulta por valor y no por pedido. */
  const sucursales = new Map<string, string | null>();

  for (const e of pedidos) {
    if (!e || typeof e !== 'object') {
      rechazados.push({ motivo: 'entrada no es un objeto' });
      continue;
    }

    const estado = typeof e.estado === 'string' ? e.estado.trim() : '';
    // Sin `pedidoId`, el folio. Con él, todo como siempre y el folio ni se mira.
    const porFolio = !e.pedidoId && !!folioTolerante(e.folio);
    const factura = typeof e.factura === 'string' || typeof e.factura === 'number' ? String(e.factura).trim() : '';
    const quien = {
      ...(porFolio ? { folio: e.folio } : { pedidoId: e.pedidoId }),
      ...(factura ? { factura } : {}),
    };

    if (!ESTADOS_ENTREGA.has(estado)) {
      rechazados.push({
        ...quien,
        motivo: `estado '${estado}' desconocido (${[...ESTADOS_ENTREGA].join(' | ')})`,
      });
      continue;
    }

    // Por folio la factura es obligatoria: sin ella, el estado se pisaría entre facturas.
    if (porFolio && !factura) {
      rechazados.push({ ...quien, motivo: 'falta factura: con folio el estado se guarda por factura' });
      continue;
    }

    try {
      let pedido;

      if (porFolio) {
        const buscado = folioTolerante(e.folio);
        let sucursalId: string | undefined;

        if (e.sucursal) {
          const pedida = String(e.sucursal).trim();

          if (!sucursales.has(pedida)) {
            const s = await prisma.sucursal.findFirst({
              where: { OR: [{ id: pedida }, { codigo: pedida.toUpperCase() }] },
              select: { id: true },
            });
            sucursales.set(pedida, s?.id ?? null);
          }
          const id = sucursales.get(pedida);

          if (!id || (local && id !== local)) {
            rechazados.push({ ...quien, motivo: `sucursal '${pedida}' fuera del alcance de esta clave` });
            continue;
          }
          sucursalId = id;
        }

        // Dos para saber si hay más de uno: nunca se elige entre folios repetidos.
        const coinciden = await prisma.pedido.findMany({
          where: { folio: { equals: buscado, mode: 'insensitive' }, ...alcance, ...(sucursalId ? { sucursalId } : {}) },
          select: { id: true, folio: true, sucursalId: true, estadoEntrega: true, estadoEntregaAt: true, estadoEntregaNota: true },
          take: 2,
        });

        if (coinciden.length > 1) {
          rechazados.push({ ...quien, motivo: `folio ambiguo (${buscado}): hay más de un pedido; indica la sucursal o el pedidoId` });
          continue;
        }
        pedido = coinciden[0];
      } else if (e.pedidoId) {
        pedido = await prisma.pedido.findFirst({
          where: { id: String(e.pedidoId), ...alcance },
          select: { id: true, folio: true, sucursalId: true, estadoEntrega: true, estadoEntregaAt: true, estadoEntregaNota: true },
        });
      } else {
        rechazados.push({ motivo: 'falta pedidoId o folio' });
        continue;
      }

      if (!pedido) {
        rechazados.push({
          ...quien,
          motivo: porFolio ? `no existe aquí (folio ${folioTolerante(e.folio)})` : 'no existe aquí (¿otra sucursal?)',
        });
        continue;
      }

      const nota = e.nota ? String(e.nota).slice(0, 500) : null;

      if (factura) {
        const at = e.at ? new Date(e.at) : new Date();

        if (Number.isNaN(at.getTime())) {
          rechazados.push({ ...quien, motivo: `at inválido (${String(e.at)})` });
          continue;
        }
        const clave = { pedidoId: pedido.id, factura, puntoDeVenta: String(e.puntoDeVenta ?? '').trim() };
        const guardada = await prisma.entregaDeFactura.findUnique({
          where: { pedidoId_factura_puntoDeVenta: clave },
        });
        let cambio = false;

        if (!guardada) {
          await prisma.entregaDeFactura.create({ data: { ...clave, estado, nota, at } });
          cambio = true;
        } else if (guardada.estado === estado && guardada.nota === nota) {
          // Repetido: no cambia nada.
        } else if (at < guardada.at) {
          aplicados.push({ pedidoId: pedido.id, folio: pedido.folio, estado, factura, ignorado: 'anterior_al_guardado' });
          continue;
        } else {
          // El `at` en el WHERE cierra la carrera con otro aviso más nuevo que entre a la vez.
          const n = await prisma.entregaDeFactura.updateMany({
            where: { id: guardada.id, at: { lte: at } },
            data: { estado, nota, at },
          });
          if (n.count === 0) {
            aplicados.push({ pedidoId: pedido.id, folio: pedido.folio, estado, factura, ignorado: 'anterior_al_guardado' });
            continue;
          }
          cambio = true;
        }

        if (cambio) {
          const derivado = derivarEstadoDelPedido(await prisma.entregaDeFactura.findMany({ where: { pedidoId: pedido.id } }));

          if (
            derivado &&
            (pedido.estadoEntrega !== derivado.estado ||
              pedido.estadoEntregaNota !== derivado.nota ||
              pedido.estadoEntregaAt?.getTime() !== derivado.at.getTime())
          ) {
            await prisma.pedido.update({
              where: { id: pedido.id },
              data: { estadoEntrega: derivado.estado, estadoEntregaAt: derivado.at, estadoEntregaNota: derivado.nota },
            });
            marcar({ id: pedido.id, sucursalId: pedido.sucursalId });
          }
        }

        aplicados.push({ pedidoId: pedido.id, folio: pedido.folio, estado, factura });
        continue;
      }

      // Sólo si cambió: `updatedAt` es la marca de agua con la que sincronizan las tablets.
      if (pedido.estadoEntrega !== estado || pedido.estadoEntregaNota !== nota) {
        await prisma.pedido.update({
          where: { id: pedido.id },
          data: {
            estadoEntrega: estado,
            estadoEntregaAt: e.at ? new Date(e.at) : new Date(),
            estadoEntregaNota: nota,
          },
        });
        tocados.push({ id: pedido.id, sucursalId: pedido.sucursalId });
      }

      aplicados.push({ pedidoId: pedido.id, folio: pedido.folio, estado });
    } catch (err) {
      rechazados.push({ ...quien, motivo: (err as Error).message });
    }
  }

  for (const t of tocados) {
    emitEvent('pedido', { id: t.id, sucursalId: t.sucursalId, accion: 'update', datos: await pedidoParaLista(t.id) });
    /*
     * Y aquí NO se le avisa al reparto, a propósito.
     *
     * Esto es lo que el reparto acaba de decirnos. Avisarle de vuelta es contarle lo que
     * él mismo escribió: un eco. Su aviso le haría pedir el pedido, pedirlo no cambia
     * nada, y lo único que queda es tráfico dando vueltas entre los dos sistemas.
     */
  }

  /*
   * Pero a la PANTALLA sí. Esto no es un eco: la sincronización enseña «recibidos hoy»
   * y el último que entró, y esos dos números sólo se mueven aquí.
   *
   * Va UNA vez por lote y no una por pedido: un lote de quinientos son quinientos
   * eventos por un contador que se lee de una sola consulta, y con la red de las
   * sucursales eso es justo lo que no se puede mandar.
   */
  if (tocados.length) emitEvent('reparto', { accion: 'entrada' });

  return { ok: rechazados.length === 0, recibidos: pedidos.length, aplicados, rechazados };
}

/** Saca la lista de estados de las tres formas en que la mandan. */
export function comoVengan(cuerpo: any): EstadoQueLlega[] {
  if (Array.isArray(cuerpo?.pedidos)) return cuerpo.pedidos;
  if (Array.isArray(cuerpo)) return cuerpo;
  if (cuerpo?.estado) return [cuerpo];

  return [];
}
