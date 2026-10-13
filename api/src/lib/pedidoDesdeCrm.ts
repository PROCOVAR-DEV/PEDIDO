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
 * El del CRM (`A001-20261013-000042`) NO va en `folio`. El cotejo con Ventra saca el
 * folio de la nota de la factura con la forma de Retool (`PDG26-260906-2992`, ver
 * `emparejarFactura.ts`), y uno del CRM no casaría con ninguna: el pedido no se facturaría
 * nunca a ojos de PEDIDO. Así que:
 *
 *   - `folioCrm` guarda el del CRM, ÚNICO: es la referencia externa.
 *   - `folio` lleva uno nuestro con la forma que el cotejo reconoce: `CRM26-261013-17`
 *     (`CRM` + año, el día del pedido y un número del día que no se repite).
 *
 * Nuestro sufijo `-1`/`-2` no entra en juego: un pedido del CRM es UN cliente, así que su
 * folio nunca se comparte, y la ingesta de CSV no lo toca porque ningún folio de Retool
 * empieza por `CRM` (todos empiezan por `P`).
 */
import { Prisma } from '@prisma/client';
import { nombreComparable, codigoComparable } from './nombreVendedor';

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
  crmPedidoId: string;
  folioCrm: string;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** El folio del CRM (D-25, P-01 todavía abierta): XXXX-YYYYMMDD-CCCCCC. */
const FOLIO_CRM = /^[A-Z0-9]{4}-\d{8}-\d{6}$/;
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

  const crmPedidoId = texto(b.crmPedidoId).toLowerCase();
  if (!UUID.test(crmPedidoId)) mal('crmPedidoId', 'obligatorio, un uuid');

  const folioCrm = texto(b.folioCrm).toUpperCase();
  if (!FOLIO_CRM.test(folioCrm)) mal('folioCrm', 'obligatorio, con la forma XXXX-YYYYMMDD-CCCCCC');

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
      crmPedidoId, folioCrm, sucursal, fecha, fechaComprometida,
      vendedor, cliente, puntoDeVenta, domicilio,
      detalles: textoONulo(b.detalles),
      lineas,
    },
  };
}

/**
 * Nuestro folio para un pedido del CRM: `CRM26-261013-17`.
 *
 * Con la forma que reconoce el cotejo (`[A-Z]{2,5}\d{2}-\d{6}-?\d{1,6}`), así que la
 * factura que lo lleve en su nota se empareja como cualquier otra. El número es del DÍA y
 * no se repite en ninguna sucursal (ver `ContadorFolioCrm`).
 */
export function folioDePedidoCrm(fecha: string, numero: number): string {
  const [anio, mes, dia] = fecha.split('-');
  const aa = anio.slice(2);

  return `CRM${aa}-${aa}${mes}${dia}-${numero}`;
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
 * Da de alta un pedido del CRM, o devuelve el que ya entró con ese uuid.
 *
 * Idempotente: el integrador reenvía cuando no le llega la respuesta, y el segundo envío
 * tiene que contestar lo mismo que el primero. 409 sólo si el FOLIO del CRM ya lo tiene
 * otro pedido —eso no lo arregla reenviar—. 422 cuando falta algo de este lado (la
 * sucursal, un vendedor de baja): tampoco.
 */
export async function recibirPedidoCrm(p: PedidoCrm): Promise<Recepcion> {
  const prisma = await base();
  // Por uuid O por folio en UNA consulta: con dos, un envío simultáneo del mismo pedido
  // podía entrar entre las dos y salir como «folio de otro pedido».
  const yaEsta = await prisma.pedido.findFirst({
    where: { OR: [{ crmPedidoId: p.crmPedidoId }, { folioCrm: p.folioCrm }] },
  });
  if (yaEsta?.crmPedidoId === p.crmPedidoId) {
    return { status: 200, cuerpo: { pedidoId: yaEsta.id, folio: yaEsta.folio, duplicado: true } };
  }
  const otroConEseFolio = yaEsta;
  if (otroConEseFolio) {
    return { status: 409, cuerpo: { error: `El folio ${p.folioCrm} ya es del pedido ${otroConEseFolio.folio}, que vino de otro pedido del CRM.` } };
  }

  const sucursal = await prisma.sucursal.findUnique({ where: { codigo: p.sucursal } });
  if (!sucursal) return { status: 422, cuerpo: { error: `La sucursal ${p.sucursal} no existe en PEDIDO.` } };
  // Cada instalación de PEDIDO puede ser de UNA sucursal (config.json): lo de otra no entra.
  // (Tarde también: `sucursalLocal` lee `__dirname`, que en las pruebas no existe.)
  const local = (await import('./sucursalLocal')).readConfiguredSucursalId();
  if (local && local !== sucursal.id) {
    return { status: 422, cuerpo: { error: `Esta instalación de PEDIDO no es de ${p.sucursal}.` } };
  }

  const vendedor = await vendedorDelCrm(p, sucursal.id);
  if ('error' in vendedor) return { status: 422, cuerpo: { error: vendedor.error } };

  const cliente = await clienteDelCrm(p, sucursal.id);

  const contador = await prisma.contadorFolioCrm.upsert({
    where: { dia: p.fecha },
    create: { dia: p.fecha, ultimo: 1 },
    update: { ultimo: { increment: 1 } },
  });
  const folio = folioDePedidoCrm(p.fecha, contador.ultimo);
  const d = p.domicilio;

  try {
    const creado = await prisma.pedido.create({
      data: {
        folio,
        folioCrm: p.folioCrm,
        crmPedidoId: p.crmPedidoId,
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
    const ganador = await prisma.pedido.findUnique({ where: { crmPedidoId: p.crmPedidoId } });
    if (ganador) return { status: 200, cuerpo: { pedidoId: ganador.id, folio: ganador.folio, duplicado: true } };

    return { status: 409, cuerpo: { error: `El folio ${p.folioCrm} ya lo tiene otro pedido.` } };
  }
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
  crmPedidoId: string;
  existe: boolean;
  pedidoId?: string;
  folio?: string;
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
 * En qué punto está cada pedido que mandó el CRM. `existe: false` es que aquí ya no está:
 * alguien lo borró desde el panel, que en PEDIDO es anularlo.
 */
export async function estadoDePedidosCrm(ids: string[]): Promise<EstadoPedidoCrm[]> {
  const prisma = await base();
  const pedidos = await prisma.pedido.findMany({
    where: { crmPedidoId: { in: ids } },
    select: {
      id: true, crmPedidoId: true, folio: true, estado: true,
      facturaEstado: true, facturaNumero: true, facturaAt: true,
      estadoEntrega: true, estadoEntregaAt: true, completedAt: true, updatedAt: true,
    },
  });
  const porId = new Map(pedidos.map((x) => [x.crmPedidoId, x]));

  return ids.map((crmPedidoId) => {
    const x = porId.get(crmPedidoId);
    if (!x) return { crmPedidoId, existe: false };
    const { id, crmPedidoId: _c, ...resto } = x;

    return { crmPedidoId, existe: true, pedidoId: id, ...resto };
  });
}
