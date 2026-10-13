/**
 * Los pedidos que llegan del CRM.
 *
 * Decidido por Jose (13/10/2026): el CRM es LA aplicación de los vendedores. Clientes,
 * puntos de venta y pedidos son suyos; el folio lo genera él y él se lo manda a PEDIDO,
 * que sigue con lo suyo (facturación, reparto, integraciones). Quien llama es el
 * `integrador/` del CRM, con la clave de servicio, y reintenta hasta que le contestan.
 * Contrato completo: `docs/2026-10-13-integrador-crm-pedido.md` en el repo del CRM.
 *
 * # El folio
 *
 * El del CRM (`A001-20261013-000042`) ES el folio del pedido, tal cual. Es el que se
 * copia en la nota de la factura, y el cotejo lo reconoce (`folioDeLaNota` en
 * `emparejarFactura.ts`).
 *
 * Es un camino AÑADIDO: Retool → n8n → `/orders/bulk` sigue exactamente igual, con sus
 * folios `P…` y nuestro sufijo `-1`/`-2` (Jose, 13/10/2026: «tenemos que tener las dos
 * opciones»). Un pedido del CRM es UN cliente, así que su folio no lleva sufijo, y no
 * puede confundirse con uno de Retool: la fecha de ellos son seis cifras, la de éste ocho.
 */
import { Prisma } from '@prisma/client';
import { nombreComparable, codigoComparable } from './nombreVendedor';
import { avisarAlReparto } from './avisoAlReparto';
import { emitEvent } from './events';

/**
 * Prisma, tarde: `prismaClient` abre la conexión al cargarse, y las pruebas de la validación
 * y del folio no tienen base. Mismo truco que `avisoAlReparto.ts`.
 */
async function base() {
  return (await import('../prismaClient')).default;
}

export interface LineaCrm {
  sku: string;
  producto: string;
  cantidad: number;
  precioUnitario: number | null;
  moneda: string | null;
  hl: number | null;
}

export interface PedidoCrm {
  folio: string;
  sucursal: string;
  fecha: string;
  fechaComprometida: string | null;
  vendedor: { codigo: string; accesosId: string | null; nombre: string | null };
  cliente: { codigo: string; codigoCcsa: string | null; nombre: string; telefono: string | null };
  puntoDeVenta: { codigo: string; nombre: string; direccion: string | null } | null;
  domicilio: { requiere: boolean; costoUsd: number | null; distanciaKm: number | null; tasa: number | null };
  detalles: string | null;
  lineas: LineaCrm[];
}

export interface Campo {
  campo: string;
  mensaje: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** El folio del CRM (D-25, P-01 todavía abierta): XXXX-YYYYMMDD-CCCCCC. */
export const FORMA_FOLIO_CRM = /^[A-Z0-9]{4}-\d{8}-\d{6}$/;
/** Más líneas que esto no es un pedido de un kiosco: es un error de quien manda. */
const MAX_LINEAS = 500;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const textoONulo = (v: unknown): string | null => texto(v) || null;
/** Un número que falta es `null`, nunca cero: un cero inventado parece un dato. */
const numeroONulo = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Lee y valida el cuerpo. Devuelve el pedido limpio, o TODOS los campos que fallan de
 * una vez —el integrador los guarda como error de datos y alguien los tiene que leer—.
 */
export function leerPedidoCrm(cuerpo: unknown): { ok: true; pedido: PedidoCrm } | { ok: false; campos: Campo[] } {
  const b = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, any>;
  const campos: Campo[] = [];
  const mal = (campo: string, mensaje: string) => campos.push({ campo, mensaje });

  const folio = texto(b.folio).toUpperCase();
  if (!FORMA_FOLIO_CRM.test(folio)) mal('folio', 'obligatorio, con la forma XXXX-YYYYMMDD-CCCCCC');

  const sucursal = texto(b.sucursal).toUpperCase();
  if (!sucursal) mal('sucursal', 'obligatorio, el código (CAM, HAB…)');

  const fecha = texto(b.fecha);
  if (!FECHA.test(fecha) || Number.isNaN(Date.parse(fecha))) mal('fecha', 'obligatoria, YYYY-MM-DD');
  const fechaComprometida = textoONulo(b.fechaComprometida);
  if (fechaComprometida && (!FECHA.test(fechaComprometida) || Number.isNaN(Date.parse(fechaComprometida)))) {
    mal('fechaComprometida', 'YYYY-MM-DD o nula');
  }

  const v = b.vendedor ?? {};
  const vendedor = { codigo: texto(v.codigo).toUpperCase(), accesosId: textoONulo(v.accesosId), nombre: textoONulo(v.nombre) };
  // `LOC0` es lo que pone el CRM cuando la persona no tiene código en Accesos: si se
  // aceptara, todos los que no lo tienen acabarían siendo el MISMO vendedor aquí.
  if (!/^[A-Z0-9]{4}$/.test(vendedor.codigo) || vendedor.codigo === 'LOC0') {
    mal('vendedor.codigo', 'obligatorio: el código de vendedor de 4 caracteres de Accesos');
  } else if (FORMA_FOLIO_CRM.test(folio) && !folio.startsWith(`${vendedor.codigo}-`)) {
    // El folio empieza por el código del vendedor: si no casan, uno de los dos está mal.
    mal('vendedor.codigo', `no casa con el folio ${folio}`);
  }

  const c = b.cliente ?? {};
  const cliente = {
    codigo: texto(c.codigo),
    codigoCcsa: textoONulo(c.codigoCcsa),
    nombre: texto(c.nombre),
    telefono: textoONulo(c.telefono),
  };
  if (!cliente.codigo) mal('cliente.codigo', 'obligatorio');
  if (!cliente.nombre) mal('cliente.nombre', 'obligatorio');

  let puntoDeVenta: PedidoCrm['puntoDeVenta'] = null;
  if (b.puntoDeVenta != null) {
    const pv = b.puntoDeVenta;
    puntoDeVenta = { codigo: texto(pv.codigo), nombre: texto(pv.nombre), direccion: textoONulo(pv.direccion) };
    if (!puntoDeVenta.codigo || !puntoDeVenta.nombre) mal('puntoDeVenta', 'si viene, con codigo y nombre');
  }

  const d = b.domicilio ?? {};
  const domicilio = {
    requiere: d.requiere === true,
    costoUsd: numeroONulo(d.costoUsd),
    distanciaKm: numeroONulo(d.distanciaKm),
    tasa: numeroONulo(d.tasa),
  };
  for (const k of ['costoUsd', 'distanciaKm', 'tasa'] as const) {
    const n = domicilio[k];
    if (n !== null && (Number.isNaN(n) || n < 0)) mal(`domicilio.${k}`, 'número ≥ 0 o nulo');
  }

  const lineas: LineaCrm[] = [];
  if (!Array.isArray(b.lineas) || b.lineas.length === 0) {
    mal('lineas', 'al menos una');
  } else if (b.lineas.length > MAX_LINEAS) {
    mal('lineas', `como mucho ${MAX_LINEAS}`);
  } else {
    b.lineas.forEach((l: any, i: number) => {
      const linea = {
        sku: texto(l?.sku),
        producto: texto(l?.producto),
        cantidad: Number(l?.cantidad),
        precioUnitario: numeroONulo(l?.precioUnitario),
        moneda: textoONulo(l?.moneda)?.toUpperCase() ?? null,
        hl: numeroONulo(l?.hl),
      };
      if (!linea.producto) mal(`lineas[${i}].producto`, 'obligatorio');
      if (!Number.isInteger(linea.cantidad) || linea.cantidad <= 0) mal(`lineas[${i}].cantidad`, 'entero > 0');
      if (Number.isNaN(linea.precioUnitario as number) || (linea.precioUnitario ?? 0) < 0) {
        mal(`lineas[${i}].precioUnitario`, 'número ≥ 0 o nulo');
      }
      if (Number.isNaN(linea.hl as number) || (linea.hl ?? 0) < 0) mal(`lineas[${i}].hl`, 'número ≥ 0 o nulo');
      lineas.push(linea);
    });
  }

  if (campos.length) return { ok: false, campos };

  return {
    ok: true,
    pedido: {
      folio, sucursal, fecha, fechaComprometida,
      vendedor, cliente, puntoDeVenta, domicilio,
      detalles: textoONulo(b.detalles),
      lineas,
    },
  };
}

/** El importe de la línea, sólo si vino en CUP: es en lo que están los de Parranda. */
export function importeDeLinea(l: LineaCrm): number | null {
  if (l.precioUnitario == null || (l.moneda && l.moneda !== 'CUP')) return null;

  return Math.round(l.cantidad * l.precioUnitario * 100) / 100;
}

export type Recepcion =
  | { status: 200 | 201; cuerpo: { pedidoId: string; folio: string; duplicado: boolean } }
  | { status: 409 | 422; cuerpo: { error: string } };

const esUnicoRepetido = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Da de alta un pedido del CRM, o devuelve el que ya entró con ese folio.
 *
 * Idempotente por el FOLIO: el del CRM es único allí (y aquí lo protege el único
 * `(sucursal, folio, vendedor)` de siempre), así que el mismo folio es el mismo pedido.
 * El integrador reenvía cuando no le llega la respuesta, y el segundo envío contesta lo
 * mismo que el primero. 409 si ese folio lo tiene un pedido de OTRO vendedor o sucursal
 * —eso no lo arregla reenviar—. 422 cuando falta algo de este lado (la sucursal, un
 * vendedor de baja): tampoco.
 */
export async function recibirPedidoCrm(p: PedidoCrm): Promise<Recepcion> {
  const prisma = await base();
  const sucursal = await prisma.sucursal.findUnique({ where: { codigo: p.sucursal } });
  if (!sucursal) return { status: 422, cuerpo: { error: `La sucursal ${p.sucursal} no existe en PEDIDO.` } };

  const yaEsta = await prisma.pedido.findFirst({ where: { folio: p.folio }, include: { vendedor: true } });
  if (yaEsta) return mismoOtro(yaEsta, sucursal.id, p);

  // Cada instalación de PEDIDO puede ser de UNA sucursal (config.json): lo de otra no entra.
  // (Tarde también: `sucursalLocal` lee `__dirname`, que en las pruebas no existe.)
  const local = (await import('./sucursalLocal')).readConfiguredSucursalId();
  if (local && local !== sucursal.id) {
    return { status: 422, cuerpo: { error: `Esta instalación de PEDIDO no es de ${p.sucursal}.` } };
  }

  const vendedor = await vendedorDelCrm(p, sucursal.id);
  if ('error' in vendedor) return { status: 422, cuerpo: { error: vendedor.error } };

  const cliente = await clienteDelCrm(p, sucursal.id);

  const d = p.domicilio;

  try {
    const creado = await prisma.pedido.create({
      data: {
        folio: p.folio,
        sucursalId: sucursal.id,
        vendedorId: vendedor.id,
        clienteId: cliente.id,
        direccion: p.puntoDeVenta?.direccion ?? null,
        telefono: p.cliente.telefono,
        // Mediodía UTC: el día del pedido no puede cambiar al pasarlo a la hora de Cuba.
        fecha: new Date(`${p.fecha}T12:00:00Z`),
        fecha_comprometida: p.fechaComprometida ? new Date(`${p.fechaComprometida}T12:00:00Z`) : null,
        estado: 'en_proceso',
        requiere_domicilio: d.requiere,
        // Lo cotizado en campo (P-21 / D-31: manda lo que se le prometió al cliente).
        costoDomicilio: d.requiere ? d.costoUsd : null,
        tasaDomicilio: d.requiere ? d.tasa : null,
        items: {
          create: p.lineas.map((l) => ({
            producto: l.producto.toUpperCase(),
            codigo: l.sku || null,
            unidades: l.cantidad,
            packs: 0,
            descripcion: p.puntoDeVenta ? `PV ${p.puntoDeVenta.codigo} ${p.puntoDeVenta.nombre}` : null,
            hl: l.hl,
            precio_linea: importeDeLinea(l),
          })),
        },
      },
    });

    return { status: 201, cuerpo: { pedidoId: creado.id, folio: creado.folio, duplicado: false } };
  } catch (e) {
    // Dos envíos del mismo pedido a la vez: el otro ganó. Se devuelve el suyo.
    if (!esUnicoRepetido(e)) throw e;
    const ganador = await prisma.pedido.findFirst({ where: { folio: p.folio }, include: { vendedor: true } });
    if (ganador) return mismoOtro(ganador, sucursal.id, p);

    return { status: 409, cuerpo: { error: `El folio ${p.folio} ya lo tiene otro pedido.` } };
  }
}

/** Ese folio ya está: es el mismo pedido si es de la misma sucursal y del mismo vendedor. */
function mismoOtro(
  x: { id: string; folio: string; sucursalId: string | null; vendedor: { codigo: string | null } | null },
  sucursalId: string,
  p: PedidoCrm,
): Recepcion {
  if (x.sucursalId === sucursalId && x.vendedor?.codigo === codigoComparable(p.vendedor.codigo)) {
    return { status: 200, cuerpo: { pedidoId: x.id, folio: x.folio, duplicado: true } };
  }

  return { status: 409, cuerpo: { error: `El folio ${p.folio} ya lo tiene otro pedido en PEDIDO (${x.id}), de otra sucursal o vendedor.` } };
}

/**
 * El vendedor, por su código de Accesos (4 caracteres). Si no existe se crea, igual que
 * la ingesta crea el que llega por primera vez en un CSV: sin gestor, o sea «Sin
 * asignar», hasta que alguien lo enlace desde Gestores.
 */
async function vendedorDelCrm(p: PedidoCrm, sucursalId: string): Promise<{ id: string } | { error: string }> {
  const prisma = await base();
  const codigo = codigoComparable(p.vendedor.codigo);
  const existe = await prisma.vendedor.findUnique({ where: { codigo } });
  if (existe) {
    return existe.activo ? existe : { error: `El vendedor ${codigo} (${existe.nombre}) está de baja en PEDIDO.` };
  }
  try {
    return await prisma.vendedor.create({
      data: {
        codigo,
        nombre: nombreComparable(p.vendedor.nombre || `CRM ${codigo}`),
        sucursalId,
        creadoPor: 'crm',
      },
    });
  } catch (e) {
    if (!esUnicoRepetido(e)) throw e;
    const ganador = await prisma.vendedor.findUnique({ where: { codigo } });
    if (ganador) return ganador;

    return { error: `Ya hay en ${p.sucursal} otro vendedor llamado «${p.vendedor.nombre}» con otro código.` };
  }
}

/**
 * El cliente: por el código de Parranda (CCSA) si lo trae, si no por el nombre —que es
 * como lo busca la ingesta—, y si no existe se crea. El código propio del CRM no se usa
 * para buscar: `Cliente.codigo` es el de Parranda, y mezclar numeraciones ahí es lo que
 * hace que dos clientes distintos casen.
 */
async function clienteDelCrm(p: PedidoCrm, sucursalId: string): Promise<{ id: string }> {
  const prisma = await base();
  const nombre = nombreComparable(p.cliente.nombre);
  const codigo = p.cliente.codigoCcsa;

  const porCodigo = codigo ? await prisma.cliente.findFirst({ where: { sucursalId, codigo } }) : null;
  if (porCodigo) return porCodigo;
  const porNombre = await prisma.cliente.findFirst({ where: { sucursalId, nombre } });
  if (porNombre) return porNombre;

  try {
    return await prisma.cliente.create({
      data: { nombre, codigo, sucursalId, telefono: p.cliente.telefono, direccion: p.puntoDeVenta?.direccion ?? null },
    });
  } catch (e) {
    if (!esUnicoRepetido(e)) throw e;
    const ganador = await prisma.cliente.findFirst({ where: { sucursalId, nombre } });
    if (ganador) return ganador;

    // El código de Parranda lo tiene otro nombre: se crea sin él, como la ingesta.
    return prisma.cliente.create({ data: { nombre, sucursalId, telefono: p.cliente.telefono } });
  }
}

export interface EstadoPedidoCrm {
  folio: string;
  existe: boolean;
  pedidoId?: string;
  estado?: string | null;
  facturaEstado?: string | null;
  facturaNumero?: string | null;
  facturaAt?: Date | null;
  estadoEntrega?: string | null;
  estadoEntregaAt?: Date | null;
  completedAt?: Date | null;
  updatedAt?: Date;
}

/**
 * En qué punto está cada pedido que mandó el CRM, por su folio. `existe: false` es que
 * aquí ya no está: alguien lo borró desde el panel, que en PEDIDO es anularlo. Sólo se
 * contesta por folios con la forma del CRM: esto no es una puerta para leer los de Retool.
 */
export async function estadoDePedidosCrm(folios: string[]): Promise<EstadoPedidoCrm[]> {
  const prisma = await base();
  const delCrm = folios.filter((f) => FORMA_FOLIO_CRM.test(f));
  const pedidos = await prisma.pedido.findMany({
    where: { folio: { in: delCrm } },
    select: {
      id: true, folio: true, estado: true,
      facturaEstado: true, facturaNumero: true, facturaAt: true,
      estadoEntrega: true, estadoEntregaAt: true, completedAt: true, updatedAt: true,
    },
  });
  const porFolio = new Map(pedidos.map((x) => [x.folio, x]));

  return folios.map((folio) => {
    const x = porFolio.get(folio);
    if (!x || !FORMA_FOLIO_CRM.test(folio)) return { folio, existe: false };
    const { id, folio: _f, ...resto } = x;

    return { folio, existe: true, pedidoId: id, ...resto };
  });
}

/**
 * ¿Son las mismas líneas? Se comparan las CANTIDADES (cuántas líneas y cuántas unidades
 * cada una), no los nombres: Retool usa los de Parranda y el CRM los suyos, y comparando
 * nombres no casaría nunca.
 */
export function mismasLineas(a: Array<{ unidades: number }>, b: Array<{ unidades: number }>): boolean {
  const orden = (x: Array<{ unidades: number }>) => x.map((l) => l.unidades).sort((m, n) => m - n).join(',');

  return a.length > 0 && orden(a) === orden(b);
}

export interface PosibleDuplicado {
  crm: { pedidoId: string; folio: string };
  retool: { pedidoId: string; folio: string };
  clienteId: string | null;
}

/**
 * INFORME, sólo lectura: pedidos del CRM que parecen el mismo que uno de Retool.
 *
 * Mientras conviven (Jose, 13/10/2026: «tenemos que tener las dos opciones»), un vendedor
 * puede meter el mismo pedido por los dos lados y aparecería dos veces. Aquí sólo se
 * LISTA: mismo cliente y sucursal, el mismo día o el de al lado, las mismas cantidades. No
 * bloquea, no borra y no se mete en ningún flujo: quién sobra lo decide una persona.
 */
export async function posiblesDuplicados(desde: Date, hasta: Date): Promise<PosibleDuplicado[]> {
  const prisma = await base();
  const margen = 36 * 3600e3;
  const pedidos = await prisma.pedido.findMany({
    where: { fecha: { gte: new Date(desde.getTime() - margen), lte: new Date(hasta.getTime() + margen) }, clienteId: { not: null } },
    select: { id: true, folio: true, fecha: true, sucursalId: true, clienteId: true, items: { select: { unidades: true } } },
  });
  const salida: PosibleDuplicado[] = [];

  for (const c of pedidos) {
    if (!FORMA_FOLIO_CRM.test(c.folio) || c.fecha < desde || c.fecha > hasta) continue;
    for (const r of pedidos) {
      if (FORMA_FOLIO_CRM.test(r.folio) || r.clienteId !== c.clienteId || r.sucursalId !== c.sucursalId) continue;
      if (Math.abs(r.fecha.getTime() - c.fecha.getTime()) > margen || !mismasLineas(r.items, c.items)) continue;
      salida.push({ crm: { pedidoId: c.id, folio: c.folio }, retool: { pedidoId: r.id, folio: r.folio }, clienteId: c.clienteId });
    }
  }

  return salida;
}

/**
 * Lo que la ingesta de Retool dispara al terminar una tanda (`processBulkImport` en
 * `routes/orders.ts`), para UN pedido del CRM recién creado. Sin esto se quedaba parado.
 *
 * Las mismas funciones y los mismos datos que `avisarDeLaTanda`: aviso al reparto con
 * motivo `importacion` y accion `bulk`, y luego el evento de clientes. El filtro de
 * `esParaElReparto` lo hace `avisarAlReparto` al no pasarle `esDelReparto` (lo lee de la
 * base), igual que la tanda lo hace antes de llamarlo. El evento `pedido` ya lo emite la ruta.
 */
export function dispararComoLaIngesta(
  p: { id: string; sucursalId: string | null },
  avisar: typeof avisarAlReparto = avisarAlReparto,
  emitir: typeof emitEvent = emitEvent,
): void {
  avisar({ id: p.id, sucursalId: p.sucursalId, motivo: 'importacion', accion: 'bulk' });
  emitir('cliente', { sucursalId: p.sucursalId, accion: 'bulk' });
}
