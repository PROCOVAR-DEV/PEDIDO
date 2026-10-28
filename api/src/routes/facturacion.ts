import { Router } from 'express';

import prisma from '../prismaClient';
import { estadoDeFactura, HORA_CORTE, type EstadoFactura } from '../lib/corteFacturacion';
import { leerUltimaPasada, soloErroresSostenidos } from '../lib/cotejoEstado';
import { extremosDelDia, hoyEnCuba } from '../lib/diaCubano';
import { soloVisibles } from '../lib/liberacionPedidos';
import { catalogosDeSucursales } from '../lib/catalogoSucursal';
import { getRequesterContext, resolveSucursalFilter } from '../lib/sucursalContext';

/**
 * La vista del SINCRONIZADOR de facturación: qué se cotejó, qué cuadró y qué no.
 *
 * # Por qué hace falta una pantalla para esto
 *
 * «Completado» y «facturado» son cosas distintas y en la lista de pedidos se veían igual.
 * El 07/09/2026, de los 148 pedidos del día anterior sólo 10 tenían factura en Ventra. Los
 * otros 138 podían estar en tres situaciones que desde fuera no se distinguen:
 *
 *   1. Todavía no se ha facturado. El día 6 fue domingo: La Habana facturó cero líneas ese
 *      día y treinta y ocho el viernes. Se factura al día siguiente, y eso es normal.
 *   2. Se facturó y NO se pegó el folio en la nota. El folio lo copia y lo pega una
 *      persona al facturar en Ventra, así que aquí es donde se pierde de verdad.
 *   3. Se pegó mal.
 *
 * # UN DÍA CADA VEZ, Y PAGINADO
 *
 * La primera versión enseñaba siete días de golpe y todos los pedidos sin factura de esos
 * siete días en una tabla sin fin. Era ilegible: se abría, salían cientos de filas de
 * todos los días mezcladas, y no se distinguía lo de hoy —lo que está pasando ahora— de lo
 * de la semana pasada.
 *
 * Ahora se pide UN día, y por defecto el de hoy. La lista va aparte y paginada, con
 * buscador y filtros. Lo de otros días sigue estando: se cambia la fecha.
 *
 * # Y NO le pregunta nada a Ventra
 *
 * Todo sale de nuestra base y de Redis. El cotejo ya corre en el worker cada diez minutos y
 * deja ahí el resultado de su última pasada; la pantalla lo lee. Si sondeara, abrirla ocho
 * veces serían ochenta consultas por la VPN, y el trabajo de fondo pasaría a depender de
 * que alguien tenga una pestaña abierta.
 */
const router = Router();

/**
 * Esto no es para el Operador, igual que los informes: es una pantalla de control, y quien
 * sube pedidos no tiene por qué ver el estado de la facturación de la sucursal entera.
 * Se comprueba una vez para todo el router, para que una ruta nueva nazca protegida.
 */
router.use((req, res, next) => {
  // El RESUMEN del día es la excepción: lo ven también el Operador y el Gestor, que son quienes
  // suben y facturan los pedidos y necesitan saber qué hay hoy y qué quedó de ayer. Solo sus cifras:
  // las de SU sucursal (y el Gestor, solo las de SUS vendedores), sin el desglose de las demás.
  if (req.method === 'GET' && req.path === '/resumen') return next();

  if (!getRequesterContext(req).puedeImportarYReportar) {
    return res.status(403).json({ error: 'Tu usuario no puede ver el estado de la facturación.' });
  }

  return next();
});

const ESTADOS: EstadoFactura[] = [
  'facturado', 'cambiado', 'buscando', 'no_aparecio', 'sin_completar', 'sin_cotejar',
];

/**
 * El RESUMEN de un día: los totales y el desglose por sucursal. Nada de listas.
 *
 * Va aparte de los pedidos a propósito. Es lo primero que se pinta —y lo único que hace
 * falta para saber si el día va bien— así que tiene que llegar sin esperar a una tabla de
 * cientos de filas.
 */
router.get('/resumen', async (req, res) => {
  const { sucursalId, error, status } = resolveSucursalFilter(req);

  if (error) return res.status(status ?? 400).json({ error });

  const dia = typeof req.query.dia === 'string' && req.query.dia ? req.query.dia : hoyEnCuba();
  const rango = extremosDelDia(dia);

  if (!rango) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD.' });

  // El Gestor ve SOLO los pedidos de sus vendedores, como en el resto de la aplicación.
  const quien = getRequesterContext(req);
  const soloSuyos = quien.isGestor && quien.userId ? { vendedor: { gestorId: quien.userId } } : {};

  const pedidos = await prisma.pedido.findMany({
    where: {
      fecha: { gte: rango.desde, lte: rango.hasta },
      ...(sucursalId ? { sucursalId } : {}),
      ...soloSuyos,
      // Lo retenido por la liberación por hora aún no cuenta: no se puede facturar.
      ...soloVisibles(),
    },
    select: {
      fecha: true,
      estado: true,
      facturaEstado: true,
      sucursalId: true,
      sucursal: { select: { nombre: true } },
    },
  });

  /**
   * Los pedidos que RECIBIERON factura ese día, sean de la fecha que sean.
   *
   * No es lo mismo que los facturados de entre los pedidos del día: en las sucursales que facturan
   * al día siguiente (Camagüey) las facturas de hoy son de pedidos de ayer, y mirar solo los
   * pedidos de hoy hacía parecer que casi no se facturaba nada.
   */
  const facturadosEseDia = await prisma.pedido.count({
    where: {
      facturaAt: { gte: rango.desde, lte: rango.hasta },
      facturaEstado: { in: ['igual', 'cambiado'] },
      ...(sucursalId ? { sucursalId } : {}),
      ...soloSuyos,
    },
  });

  // De esos, cuántos son de pedidos de ESE MISMO día (el resto son de días anteriores): así el 70 y el
  // «2 con factura» de los pedidos de hoy cuadran a la vista (70 = 2 de hoy + 68 de antes).
  const facturadosDePedidosDelDia = await prisma.pedido.count({
    where: {
      facturaAt: { gte: rango.desde, lte: rango.hasta },
      facturaEstado: { in: ['igual', 'cambiado'] },
      fecha: { gte: rango.desde, lte: rango.hasta },
      ...(sucursalId ? { sucursalId } : {}),
      ...soloSuyos,
    },
  });

  const ahora = new Date();
  const vacio = () => ({
    total: 0, facturado: 0, cambiado: 0, buscando: 0,
    no_aparecio: 0, sin_completar: 0, sin_cotejar: 0,
  });
  const totales = vacio();
  const porSucursal = new Map<string, ReturnType<typeof vacio> & { sucursalId: string | null; sucursal: string }>();

  for (const p of pedidos) {
    const est = estadoDeFactura(p.facturaEstado, p.fecha, ahora, p.estado);
    const clave = p.sucursalId ?? '-';
    const fila =
      porSucursal.get(clave) ??
      { ...vacio(), sucursalId: p.sucursalId, sucursal: p.sucursal?.nombre ?? 'sin sucursal' };

    fila.total++;
    fila[est]++;
    porSucursal.set(clave, fila);

    totales.total++;
    totales[est]++;
  }

  const limitado = quien.isGestor || !quien.puedeImportarYReportar;
  const ultima = soloErroresSostenidos(await leerUltimaPasada());

  return res.json({
    dia,
    hoy: hoyEnCuba(),
    horaCorte: HORA_CORTE,
    facturadosEseDia,
    facturadosDePedidosDelDia,
    totales,
    // Quien no es de control (Operador, Gestor) no recibe el desglose ni los errores de las demás sucursales.
    sucursales: limitado ? [] : [...porSucursal.values()].sort((a, b) => b.total - a.total),
    ultimaPasada: limitado && ultima ? { ...ultima, sucursales: [] } : ultima,
  });
});

/**
 * Los PEDIDOS de un día, paginados, con buscador y filtros.
 *
 * Paginado en el servidor y no en la pantalla: un día flojo son veinte pedidos y uno bueno
 * son cuatrocientos. Mandarlos todos para enseñar veinte es gastar el cable y la memoria
 * del navegador en algo que nadie va a mirar.
 */
router.get('/pedidos', async (req, res) => {
  const { sucursalId, error, status } = resolveSucursalFilter(req);

  if (error) return res.status(status ?? 400).json({ error });

  const dia = typeof req.query.dia === 'string' && req.query.dia ? req.query.dia : hoyEnCuba();
  const rango = extremosDelDia(dia);

  if (!rango) return res.status(400).json({ error: 'La fecha tiene que ser AAAA-MM-DD.' });

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const filtroSucursal = typeof req.query.sucursalId === 'string' ? req.query.sucursalId : '';
  const pedidos = typeof req.query.estado === 'string' && req.query.estado
    ? req.query.estado.split(',').filter((e): e is EstadoFactura => ESTADOS.includes(e as EstadoFactura))
    : [];

  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = Math.min(100, Math.max(5, Number(req.query.porPagina) || 25));

  /**
   * El filtro por estado NO se puede pasar a la consulta tal cual.
   *
   * `buscando` y `no_aparecio` son el MISMO `facturaEstado` en la base —`sin_factura`— y lo
   * que los separa es la hora de corte, que se calcula aquí. Así que a la base se le pide
   * el conjunto de estados guardados que puedan dar los pedidos, y el reparto fino se hace
   * después. Es la única parte que no puede vivir en SQL.
   */
  const guardados = new Set<string | null>();

  for (const e of pedidos) {
    if (e === 'facturado') guardados.add('igual');
    else if (e === 'cambiado') guardados.add('cambiado');
    else if (e === 'buscando' || e === 'no_aparecio' || e === 'sin_completar') guardados.add('sin_factura');
    else guardados.add(null);
  }

  const where = {
    fecha: { gte: rango.desde, lte: rango.hasta },
    ...(sucursalId ? { sucursalId } : filtroSucursal ? { sucursalId: filtroSucursal } : {}),
    ...(guardados.size
      ? {
          OR: [
            ...(guardados.has(null) ? [{ facturaEstado: null }] : []),
            ...([...guardados].filter((g): g is string => g != null).length
              ? [{ facturaEstado: { in: [...guardados].filter((g): g is string => g != null) } }]
              : []),
          ],
        }
      : {}),
    // Lo retenido por la liberación por hora aún no cuenta: no se puede facturar.
    AND: [
      soloVisibles(),
      ...(q
        ? [
            {
              OR: [
                { folio: { contains: q, mode: 'insensitive' as const } },
                { facturaNumero: { contains: q, mode: 'insensitive' as const } },
                { cliente: { nombre: { contains: q, mode: 'insensitive' as const } } },
                { vendedor: { nombre: { contains: q, mode: 'insensitive' as const } } },
              ],
            },
          ]
        : []),
    ],
  };

  const filas = await prisma.pedido.findMany({
    where,
    select: {
      id: true,
      folio: true,
      fecha: true,
      estado: true,
      facturaEstado: true,
      facturaNumero: true,
      // Quién dijo «esto ya se facturó». Es a quien hay que preguntarle cuando el pedido
      // sale completado y sin factura, que es justo lo que esta pantalla persigue.
      completadoPor: true,
      sucursal: { select: { nombre: true } },
      vendedor: { select: { nombre: true } },
      cliente: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'desc' }, { folio: 'asc' }],
  });

  /**
   * El corte se aplica DESPUÉS de la consulta, así que la página se recorta aquí.
   *
   * Traer el día entero y cortar en memoria es correcto para esto: un día son como mucho
   * unos cientos de pedidos de una sucursal. Paginar en SQL daría páginas descuadradas,
   * porque `buscando` y `no_aparecio` no se distinguen hasta después de mirar la hora.
   */
  const ahora = new Date();
  const conEstado = filas
    .map((p) => ({
      id: p.id,
      folio: p.folio,
      fecha: p.fecha,
      estado: p.estado,
      facturaNumero: p.facturaNumero,
      sucursal: p.sucursal?.nombre ?? 'sin sucursal',
      vendedor: p.vendedor?.nombre ?? null,
      cliente: p.cliente?.nombre ?? null,
      completadoPor: p.completadoPor ?? null,
      factura: estadoDeFactura(p.facturaEstado, p.fecha, ahora, p.estado),
    }))
    .filter((p) => (pedidos.length ? pedidos.includes(p.factura) : true));

  const desde = (pagina - 1) * porPagina;

  return res.json({
    dia,
    total: conEstado.length,
    pagina,
    porPagina,
    paginas: Math.max(1, Math.ceil(conEstado.length / porPagina)),
    pedidos: conEstado.slice(desde, desde + porPagina),
  });
});

/**
 * PRODUCTOS DE PEDIDOS QUE NO CRUZAN CON VENTRA, para que no se vuelva a caer uno en silencio.
 *
 * Un producto que no cruza sale «sin precio, sin peso, no hay en esta sucursal» y no falla nada: lo vio
 * una sucursal con el panel Jinko («625W» contra «625 W») y con la servilleta («Azahar» contra «Azanar»).
 * Aquí se listan los productos distintos de los pedidos de los últimos 30 días que ni por código ni por
 * nombre encuentran su fila en el catálogo de su sucursal. Lo normal es que esté VACÍO.
 */
router.get('/productos-sin-cruce', async (req, res) => {
  const quien = getRequesterContext(req);

  // Es una comprobación de la casa: Administrador, Super Admin y Desarrollador.
  if (!quien.canManageUsers && !quien.isGlobalAdmin) {
    return res.status(403).json({ error: 'Solo un administrador puede ver los productos sin cruce con Ventra.' });
  }

  const { sucursalId, error, status } = resolveSucursalFilter(req);

  if (error) return res.status(status ?? 400).json({ error });

  const filas = await prisma.$queryRaw<
    Array<{ sucursalId: string; sucursal: string; producto: string; code: string | null; lineas: number; ultimo: Date }>
  >`
    select o."sucursalId" as "sucursalId", s.codigo as sucursal, i.producto, i.code,
           count(*)::int as lineas, max(o.fecha) as ultimo
      from "OrderItem" i
      join "Order" o on o.id = i."orderId"
      join "Sucursal" s on s.id = o."sucursalId"
     where o.fecha >= now() - interval '30 days'
       and i.producto is not null and i.producto <> ''
       and (${sucursalId ?? null}::text is null or o."sucursalId" = ${sucursalId ?? null})
     group by 1, 2, 3, 4`;

  const catalogos = await catalogosDeSucursales(filas.map((f) => f.sucursalId));
  const sinCruce = new Map<string, { producto: string; code: string | null; sucursales: string[]; lineas: number; ultimo: Date }>();

  for (const f of filas) {
    if (catalogos.get(f.sucursalId)?.buscar(f.producto, f.code)) continue;
    const k = `${f.producto}|${f.code ?? ''}`;
    const a = sinCruce.get(k) ?? { producto: f.producto, code: f.code, sucursales: [], lineas: 0, ultimo: f.ultimo };

    a.sucursales.push(f.sucursal);
    a.lineas += f.lineas;
    if (f.ultimo > a.ultimo) a.ultimo = f.ultimo;
    sinCruce.set(k, a);
  }

  const productos = [...sinCruce.values()].sort((a, b) => b.lineas - a.lineas);

  return res.json({ dias: 30, total: productos.length, productos });
});

export default router;
