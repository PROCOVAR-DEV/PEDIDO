import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';
import {
  resolveSucursalFilter,
  getRequesterContext,
  alcanceDeLectura,
  soloLoSuyo,
} from '../lib/sucursalContext';
import { parrandaQueue } from '../lib/queues';
import { anotarHistorial } from '../lib/historialPedido';
import { ESTADO_ABIERTO, planReasignacion, puedeReasignar } from '../lib/reasignarCliente';
import { avisarReasignacion } from '../lib/avisoReasignacion';
import { avisarAlReparto } from '../lib/avisoAlReparto';
import { evaluarGeoClientes, puntoEnCuba } from '../lib/geoClientes';

const router = express.Router();

// POST /clientes/sync-parranda — dispara el sync de clientes desde Parranda (SOLO admin).
// ENCOLA un job; el worker lo procesa paginado (sin golpear la DB en el request).
router.post('/sync-parranda', async (req, res) => {
  const ctx = getRequesterContext(req);
  const serviceOk = !!process.env.SERVICE_API_KEY && req.header('x-api-key') === process.env.SERVICE_API_KEY;
  if (!ctx.isSuperAdmin && !serviceOk) {
    return res.status(403).json({ error: 'Solo el Super Admin (o el servicio) puede sincronizar clientes.' });
  }
  const q = parrandaQueue();
  if (!q) return res.status(503).json({ error: 'Redis/worker no disponible (sync por cola requerido).' });
  const job = await q.add({ reason: 'manual' });
  return res.status(202).json({ enqueued: true, jobId: String(job.id) });
});

// GET /clientes/resumen-parranda — resumen POR SUCURSAL (total / con geo) + último sync.
// Alimenta el panel de Configuración: ver qué entró por sucursal.
router.get('/resumen-parranda', async (req, res) => {
  const ctx = getRequesterContext(req);
  if (!ctx.isSuperAdmin) return res.status(403).json({ error: 'Solo el Super Admin.' });
  try {
    const sucursales = await prisma.sucursal.findMany({
      select: { id: true, nombre: true, codigo: true },
      orderBy: { nombre: 'asc' },
    });
    const total = await prisma.cliente.groupBy({ by: ['sucursalId'], _count: { _all: true } });
    const conGeo = await prisma.cliente.groupBy({
      by: ['sucursalId'], where: { latitud: { not: null } }, _count: { _all: true },
    });
    const tMap = new Map(total.map((t) => [t.sucursalId, t._count._all]));
    const gMap = new Map(conGeo.map((g) => [g.sucursalId, g._count._all]));
    const porSucursal = sucursales.map((s) => {
      const t = tMap.get(s.id) ?? 0;
      const g = gMap.get(s.id) ?? 0;
      return { id: s.id, codigo: s.codigo, nombre: s.nombre, total: t, conGeo: g, sinGeo: t - g };
    });

    // Historial GLOBAL de corridas del worker (para ver que corre y no sobrecarga Parranda).
    let syncs: unknown[] = [];
    const q = parrandaQueue();
    if (q) {
      // Lo APLAZADO va aparte de lo que está esperando turno.
      //
      // Desde que el sync diario está programado, Bull deja siempre el de mañana como
      // job aplazado. Metido en el mismo saco que lo pendiente, la pantalla enseñaría
      // una "pendiente" que no se va nunca —y eso se lee como que algo se atascó,
      // justo lo contrario de lo que significa.
      const [completos, fallidos, activos, programados] = await Promise.all([
        q.getJobs(['completed'], 0, 15),
        q.getJobs(['failed'], 0, 5),
        q.getJobs(['active', 'waiting'], 0, 5),
        q.getJobs(['delayed'], 0, 3),
      ]);
      const map = (j: any, estado: string) => ({
        jobId: String(j.id), estado,
        resultado: estado === 'completado' ? j.returnvalue : undefined,
        error: estado === 'error' ? j.failedReason : undefined,
        cuando: j.finishedOn || j.processedOn || j.timestamp || null,
      });
      const todas = [
        ...activos.map((j) => map(j, 'pendiente')),
        ...completos.map((j) => map(j, 'completado')),
        ...fallidos.map((j) => map(j, 'error')),
      ].sort((a, b) => Number(b.jobId) - Number(a.jobId));

      /**
       * SÓLO LAS DE HOY.
       *
       * Se devolvían las veinte últimas y la pantalla las pintaba todas, así que la lista
       * crecía sola y para ver si la de hoy había ido bien había que buscarla entre las de
       * la semana pasada. Lo que se viene a mirar aquí es una cosa: si lo de hoy corrió.
       *
       * El día es el de Cuba, no el del servidor: con el VPS en UTC, «hoy» empieza a las
       * ocho de la noche de allí y la sincronización de las seis saldría como de ayer.
       *
       * Si hoy no ha corrido ninguna —a media mañana es lo normal, corre a las seis—, se
       * devuelve la última que haya. Una lista vacía no distingue «todavía no toca» de
       * «lleva una semana sin correr», y son cosas muy distintas.
       */
      const hoyCuba = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const diaDe = (c: number | null) =>
        c
          ? new Intl.DateTimeFormat('en-CA', {
              timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date(c))
          : null;

      const deHoy = todas.filter((s) => diaDe(s.cuando) === hoyCuba);

      syncs = deHoy.length ? deHoy : todas.slice(0, 1);

      // Cuándo toca la próxima, en su propio campo: es la forma de comprobar de un
      // vistazo que lo automático sigue programado, que era justo lo que no se podía
      // saber cuando no lo estaba y nadie se enteró.
      const siguiente = programados
        .map((j: any) => Number(j.opts?.delay ? j.timestamp + j.opts.delay : 0))
        .filter((t) => t > 0)
        .sort((a, b) => a - b)[0];
      res.json({
        porSucursal,
        granTotal: porSucursal.reduce((a, s) => a + s.total, 0),
        granConGeo: porSucursal.reduce((a, s) => a + s.conGeo, 0),
        syncs,
        // Para que la pantalla pueda decir «hoy» o «la última que hubo» y no dejar a nadie
        // creyendo que una corrida de hace tres días es la de esta mañana.
        syncsSonDeHoy: deHoy.length > 0,
        proximaSync: siguiente ?? null,
      });
      return;
    }
    res.json({
      porSucursal,
      granTotal: porSucursal.reduce((a, s) => a + s.total, 0),
      granConGeo: porSucursal.reduce((a, s) => a + s.conGeo, 0),
      syncs,
    });
  } catch (err) {
    console.error('resumen-parranda error:', err);
    res.status(500).json({ error: 'No se pudo obtener el resumen.' });
  }
});

// GET /clientes/parranda-lista — clientes PAGINADOS + filtros (sucursal, municipio, tipo,
// búsqueda, solo-geo). Devuelve la fecha (createdAt = cuándo entró/se sincronizó).
router.get('/parranda-lista', async (req, res) => {
  const ctx = getRequesterContext(req);
  if (!ctx.isSuperAdmin) return res.status(403).json({ error: 'Solo el Super Admin.' });
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limitPedido = parseInt(String(req.query.limit)) || 25;
    const limit = Math.min(100, Math.max(1, limitPedido));
    const sucursalId = (req.query.sucursalId as string) || undefined;
    const municipio = (req.query.municipio as string)?.trim() || undefined;
    const tipo = (req.query.tipo as string)?.trim() || undefined;
    const search = (req.query.search as string)?.trim().toUpperCase() || undefined;
    const soloGeo = req.query.soloGeo === '1' || req.query.soloGeo === 'true';

    const where: any = {};
    if (sucursalId) where.sucursalId = sucursalId;
    if (municipio) where.municipio = { contains: municipio };
    if (tipo) where.tipoCliente = { contains: tipo };
    if (soloGeo) where.latitud = { not: null };
    if (search) where.AND = search.split(/\s+/).filter(Boolean).map((w) => ({ nombre: { contains: w } }));

    const [total, data] = await Promise.all([
      prisma.cliente.count({ where }),
      prisma.cliente.findMany({
        where,
        /**
         * `updatedAt` empata a lo bestia: una importación toca cientos de clientes en la
         * misma pasada y les deja la misma marca. Sin un desempate único, esas filas se
         * reordenan entre página y página y alguna sale dos veces.
         */
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, nombre: true, codigo: true, municipio: true, direccion: true,
          tipoCliente: true, latitud: true, longitud: true, geolocalizacion: true,
          createdAt: true, updatedAt: true, sucursal: { select: { nombre: true, codigo: true } },
        },
      }),
    ]);
    // El tope se anuncia: pedir 5.000 y recibir 100 sin decir nada se lee como «sólo hay
    // 100», y quien lo lee se lo cree.
    res.json({
      data, total, page, limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      ...(limitPedido > limit ? { limitPedido, limitRecortado: true } : {}),
    });
  } catch (err) {
    console.error('parranda-lista error:', err);
    res.status(500).json({ error: 'No se pudo listar los clientes.' });
  }
});

// GET /clientes/municipios — municipios distintos (para el filtro), opcional por sucursal.
router.get('/municipios', async (req, res) => {
  const ctx = getRequesterContext(req);
  if (!ctx.isSuperAdmin) return res.status(403).json({ error: 'Solo el Super Admin.' });
  const sucursalId = (req.query.sucursalId as string) || undefined;
  const rows = await prisma.cliente.findMany({
    where: { municipio: { not: null }, ...(sucursalId ? { sucursalId } : {}) },
    select: { municipio: true }, distinct: ['municipio'], orderBy: { municipio: 'asc' },
  });
  res.json({ municipios: rows.map((r) => r.municipio).filter(Boolean) });
});

// GET /clientes/sync-parranda/status/:jobId — pendiente | completado | error + resultado.
router.get('/sync-parranda/status/:jobId', async (req, res) => {
  const q = parrandaQueue();
  if (!q) return res.status(503).json({ error: 'Cola no disponible' });
  const job = await q.getJob(req.params.jobId);
  if (!job) return res.json({ jobId: req.params.jobId, estado: 'desconocido' });
  const state = await job.getState();
  const estado = state === 'completed' ? 'completado' : state === 'failed' ? 'error' : 'pendiente';
  return res.json({
    jobId: String(job.id), estado, state,
    resultado: state === 'completed' ? job.returnvalue : undefined,
    error: state === 'failed' ? job.failedReason : undefined,
  });
});

// GET /clientes - List clientes with pagination
/**
 * GET /clientes/por-vendedor
 *
 * Cuantos clientes trajo cada vendedor, para el desplegable de la vista y para
 * responder de un vistazo "¿cuantos clientes tiene fulano?".
 *
 * Un cliente cuenta para un vendedor si tiene AL MENOS UN pedido suyo. Como un
 * cliente puede haber comprado a varios, **la suma de la columna puede pasar del
 * total de clientes de la sucursal**. No es un descuadre: es que ese cliente lo
 * atienden dos.
 *
 * Va scopeado por sucursal como todo lo demas, y el Gestor solo ve lo suyo.
 */
router.get('/por-vendedor', async (req, res) => {
  try {
    const { where, error } = alcanceDeLectura(req);

    if (error) return res.status(400).json({ error });

    const soloSuyo = soloLoSuyo(req);

    const filas = await prisma.vendedor.findMany({
      where: {
        ...where,
        activo: true,
        ...(soloSuyo ? { gestorId: soloSuyo.gestorId } : {}),
      },
      select: {
        id: true,
        nombre: true,
        codigo: true,
        sucursal: { select: { nombre: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    // Los clientes DISTINTOS de cada vendedor, en UNA consulta para todos. Uno
    // por vendedor serian decenas de idas y vueltas.
    const conteos = await prisma.pedido.groupBy({
      by: ['vendedorId'],
      where: {
        ...where,
        vendedorId: { in: filas.map((v) => v.id) },
        clienteId: { not: null },
      },
      _count: { clienteId: true },
    });

    // groupBy cuenta PEDIDOS, no clientes distintos: dos pedidos del mismo
    // cliente contarian dos veces. Por eso los distintos se piden aparte.
    // El filtro de sucursal va TAMBIEN aqui. Sin el, el conteo saldria de todas
    // las sucursales y un operador veria numeros que no son los suyos — la
    // misma fuga que estamos quitando en el resto de la aplicacion.
    const distintos = await prisma.$queryRaw<Array<{ vendedorId: string; clientes: bigint }>>(
      Prisma.sql`
        select "sellerId" as "vendedorId", count(distinct "clientId") as clientes
          from "Order"
         where "sellerId" is not null
           and "clientId" is not null
           ${where.sucursalId ? Prisma.sql`and "sucursalId" = ${where.sucursalId}` : Prisma.empty}
         group by 1`,
    );
    const porVendedor = new Map(distintos.map((d) => [d.vendedorId, Number(d.clientes)]));
    const pedidosPorVendedor = new Map(conteos.map((c) => [c.vendedorId, c._count.clienteId]));

    res.json(
      filas.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        codigo: v.codigo,
        sucursal: v.sucursal?.nombre ?? null,
        clientes: porVendedor.get(v.id) ?? 0,
        pedidos: pedidosPorVendedor.get(v.id) ?? 0,
      })),
    );
  } catch (err) {
    console.error('Error en clientes por vendedor:', err);
    res.status(500).json({ error: 'Error al obtener los clientes por vendedor' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { sucursalId, error: sucursalError, status: sucursalStatus } = resolveSucursalFilter(req);
    if (sucursalError) {
      return res.status(sucursalStatus ?? 400).json({ error: sucursalError });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    /**
     * SIEMPRE HAY TOPE, SE PIDA O NO.
     *
     * Esto era `parseInt(...) || 10` sin `Math.min`: quien pidiera `limit=100000` se
     * llevaba los 56.000 clientes con su vendedor resuelto en una sola respuesta. El
     * servidor tiene que construir ese JSON entero en memoria antes de mandarlo, y es
     * exactamente así como se cayó el endpoint de integración en su día.
     *
     * 200 es de sobra para pintar una página y no llega a doler. Quien necesite más,
     * pagina.
     */
    const TOPE = 200;
    const limitPedido = parseInt(req.query.limit as string) || 10;
    const limit = Math.min(TOPE, Math.max(1, limitPedido));
    const search = req.query.search as string | undefined;

    const skip = (page - 1) * limit;

    const where: any = { sucursalId };
    // RBAC — rol GESTOR: SOLO los clientes de SUS pedidos (por su vendedor vinculado).
    const gestorCtx = getRequesterContext(req);
    if (gestorCtx.isGestor && gestorCtx.userId) {
      where.pedidos = { some: { vendedor: { gestorId: gestorCtx.userId } } };
    }
    // Filtros extra: municipio y estado de compra (Compra / No Compra). El scope de
    // sucursal ya lo aplicó resolveSucursalFilter según el rol y si eligió "Todas".
    const municipio = (req.query.municipio as string)?.trim();
    const estadoCompra = (req.query.estadoCompra as string)?.trim();
    if (municipio) where.municipio = municipio;
    if (estadoCompra) where.estadoCompra = estadoCompra;
    // Activo o inactivo (Parranda ya no lo manda). `1` sólo activos, `0` sólo inactivos; sin
    // parámetro, todos: las demás pantallas y la API no cambian.
    const activoQ = (req.query.activo as string)?.trim();
    if (activoQ === '1' || activoQ === 'true') where.activo = true;
    else if (activoQ === '0' || activoQ === 'false') where.activo = false;

    // Filtro por VENDEDOR: "los clientes que trajo fulano".
    //
    // No hay relacion directa cliente -> vendedor; la union son los pedidos. Un
    // cliente cuenta como de ese vendedor si tiene AL MENOS UN pedido suyo, que
    // es como lo entiende quien pregunta ("¿cuantos clientes tiene este
    // vendedor?"). Ojo: un cliente puede haber comprado a varios, asi que la
    // suma por vendedor puede pasar del total de clientes — y esta bien, no es
    // un error de cuentas.
    //
    // El scope de sucursal ya esta puesto arriba y NO se toca aqui: filtrar por
    // un vendedor de otra sucursal no puede enseñar sus clientes.
    /**
     * Filtros por DATO QUE FALTA: "enséñame los que no tienen teléfono".
     *
     * Es la pregunta que se hace de verdad cuando hay que completar fichas: no
     * "búscame a Fulano", sino "cuáles están incompletos y cuántos son". Sin esto,
     * la única forma de saberlo era ir pasando páginas a ojo.
     *
     * Cada uno trata el vacío igual que el nulo. En estos datos hay de los dos —lo
     * que llega del consolidado viene con cadenas vacías— y para quien mira la ficha
     * significan exactamente lo mismo: que ahí no hay nada.
     */
    const falta = (req.query.falta as string)?.trim();
    const VACIO = (campo: string) => ({ OR: [{ [campo]: null }, { [campo]: '' }] });
    const FALTANTES: Record<string, any> = {
      telefono: VACIO('telefono'),
      // La ubicación es la que impide cotizar el domicilio: sin ella no hay reparto.
      geo: { OR: [{ latitud: null }, { longitud: null }] },
      direccion: VACIO('direccion'),
      municipio: VACIO('municipio'),
      zona: VACIO('zona'),
      codigo: VACIO('codigo'),
    };
    if (falta && FALTANTES[falta]) Object.assign(where, FALTANTES[falta]);

    const vendedorId = (req.query.vendedorId as string)?.trim();

    if (vendedorId) {
      // De un vendedor: los que le asignaron a mano y, sin asignación, los que tienen pedidos suyos.
      const pedidosSuyos = where.pedidos
        ? { some: { AND: [where.pedidos.some, { vendedorId }] } }
        : { some: { vendedorId } };

      delete where.pedidos;
      where.AND = [...(where.AND ?? []), { OR: [{ vendedorAsignadoId: vendedorId }, { vendedorAsignadoId: null, pedidos: pedidosSuyos }] }];
    }
    const searchTerm = search?.trim().toUpperCase();

    if (searchTerm) {
      // Búsqueda por PALABRAS: el nombre debe contener TODAS las palabras buscadas,
      // sin importar cuántos espacios haya entre ellas. Así "MIVIALA RIVERO CONSUEGRA"
      // encuentra a "MIVIALA RIVERO  CONSUEGRA" (doble espacio, típico de estos datos).
      const palabras = searchTerm.split(/\s+/).filter(Boolean);
      where.OR = [
        { AND: palabras.map((w) => ({ nombre: { contains: w } })) },
        { codigo: { contains: searchTerm } },
        { zona: { contains: searchTerm } },
      ];
    }

    const [clientes, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        skip,
        take: limit,
        // Dos clientes se pueden llamar igual: el `id` decide cuál va antes, siempre el
        // mismo, y así la paginación no los baraja.
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      prisma.cliente.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    /**
     * Cuántos clientes le falta cada dato, con los MISMOS filtros que la lista.
     *
     * Van con el listado y no en otra llamada porque la pregunta es la misma: quien
     * ve "sin teléfono: 812" ya sabe si vale la pena entrar. Y respetan la sucursal y
     * el vendedor elegidos, que si no, el número diría una cosa y la lista otra.
     */
    const baseConteo = { ...where };
    delete (baseConteo as any).OR;   // el OR es del buscador y del filtro de faltantes
    const [sinTelefono, sinGeo, sinDireccion, sinMunicipio] = await Promise.all([
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.telefono } }),
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.geo } }),
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.direccion } }),
      prisma.cliente.count({ where: { ...baseConteo, ...FALTANTES.municipio } }),
    ]);
    const faltantes = { telefono: sinTelefono, geo: sinGeo, direccion: sinDireccion, municipio: sinMunicipio };

    /**
     * A QUIÉN PERTENECE UN CLIENTE: al que LE VENDE AHORA.
     *
     * Decidido por Jose el 07/09/2026. Antes era «quien lo trajo» —el vendedor de su
     * pedido más antiguo— y eso se quedaba anclado al dueño anterior para siempre, porque
     * Parranda reparte clientes entre vendedores: los que tienen muchos le pasan a los que
     * tienen pocos.
     *
     * Lo que costaba, medido el 27/08/2026 sobre producción:
     *
     *     Santiago    3.147 clientes ->  377 atribuidos a quien ya no les vende
     *     Las Tunas     967          ->  249
     *     Camagüey    1.284          ->   74
     *     Habana        782          ->   30
     *     TOTAL       9.155          ->  849   (casi 1 de cada 10)
     *
     * El caso que lo destapó: KIOSKO HENRY ODAEL FROMETA CANEY (SC06TCP0502, Santiago).
     * Lo trajo frank.emilio con 6 pedidos entre enero y febrero; desde marzo le vende
     * gari.duran, 26 pedidos y el último el 27/08. A Entrega le llegaba como cliente de
     * Frank, así que en la cartera de Gari —el que de verdad lo atiende— no aparecía.
     *
     * Esto se calcula en DOS sitios: aquí y en `integration.ts`, que es lo que se le manda
     * a Entrega como `usuario_vendedor`. **Los dos tienen que decir lo mismo**: si uno mira
     * el pedido más reciente y el otro el más antiguo, el panel y la APK dicen cosas
     * distintas del mismo cliente y no hay forma de saber cuál creer.
     *
     * Lo que NO cambia: para comisiones puede seguir importando quién lo trajo. Ese cálculo
     * no vive aquí; el día que haga falta, se saca aparte y no invirtiendo esto otra vez.
     */
    // Quién le vende a cada cliente: el vendedor de su pedido MÁS RECIENTE. No hay
    // relación directa cliente->vendedor, la unión son los pedidos. Con los datos
    // actuales el 91% de los clientes tiene un solo vendedor (6918 de 7579), así
    // que para casi todos da igual cuál se mire; el criterio decide justo para el 9%
    // restante, que es donde estaba el problema.
    //
    // Se resuelve en UNA consulta para toda la página, no una por cliente: con
    // ~600 ms de latencia por petición, un N+1 aquí sería letal.
    const ids = clientes.map((c) => c.id);
    const porCliente = new Map<string, { vendedor: string | null; codigo: string | null; otros: number }>();

    if (ids.length > 0) {
      const pedidos = await prisma.pedido.findMany({
        where: { clienteId: { in: ids } },
        select: {
          clienteId: true,
          fecha: true,
          vendedor: { select: { nombre: true, codigo: true } },
        },
        // DESC: el primero que salga de cada cliente es su pedido más reciente.
        orderBy: { fecha: 'desc' },
      });

      const vistos = new Map<string, Set<string>>();

      for (const p of pedidos) {
        if (!p.clienteId) continue;
        // El primero que aparece es el más RECIENTE: los pedidos vienen ordenados.
        if (!porCliente.has(p.clienteId)) {
          porCliente.set(p.clienteId, {
            vendedor: p.vendedor?.nombre ?? null,
            codigo: p.vendedor?.codigo ?? null,
            otros: 0,
          });
        }
        if (p.vendedor?.nombre) {
          if (!vistos.has(p.clienteId)) vistos.set(p.clienteId, new Set());
          vistos.get(p.clienteId)!.add(p.vendedor.nombre);
        }
      }
      // "otros" = cuántos vendedores MÁS, aparte del que lo trajo.
      for (const [cid, set] of vistos) {
        const e = porCliente.get(cid);

        if (e) e.otros = Math.max(0, set.size - 1);
      }
    }

    // La sucursal es la PROVINCIA del consolidado de Parranda: el mismo dato con otro
    // nombre. Se manda con el cliente para que la ficha no tenga que adivinarla.
    const sucursalesTodas = await prisma.sucursal.findMany({ select: { id: true, nombre: true, codigo: true } });
    const porSucursal = new Map(sucursalesTodas.map((x) => [x.id, x]));

    // Un cliente reasignado a mano es de su vendedor asignado, tenga los pedidos que tenga.
    const idsAsignados = [...new Set(clientes.map((c) => c.vendedorAsignadoId).filter((x): x is string => !!x))];
    const asignados = new Map(
      (idsAsignados.length
        ? await prisma.vendedor.findMany({ where: { id: { in: idsAsignados } }, select: { id: true, nombre: true, codigo: true } })
        : []
      ).map((v) => [v.id, v]),
    );
    const clientesConVendedor = clientes.map((c) => ({
      ...c,
      vendedorNombre: (c.vendedorAsignadoId && asignados.get(c.vendedorAsignadoId)?.nombre) || (porCliente.get(c.id)?.vendedor ?? null),
      vendedorCodigo: (c.vendedorAsignadoId && asignados.get(c.vendedorAsignadoId)?.codigo) || (porCliente.get(c.id)?.codigo ?? null),
      otrosVendedores: porCliente.get(c.id)?.otros ?? 0,
      sucursalNombre: c.sucursalId ? porSucursal.get(c.sucursalId)?.nombre ?? null : null,
      sucursalCodigo: c.sucursalId ? porSucursal.get(c.sucursalId)?.codigo ?? null : null,
    }));

    // Municipios distintos del scope actual (para poblar el dropdown del filtro).
    const municipiosRaw = await prisma.cliente.findMany({
      where: { sucursalId, municipio: { not: null } },
      select: { municipio: true }, distinct: ['municipio'], orderBy: { municipio: 'asc' },
    });

    res.json({
      data: clientesConVendedor,
      /**
       * Si se recortó el `limit`, SE DICE.
       *
       * Un tope que no se anuncia es la peor clase de tope: quien pide 5.000 y recibe 200
       * sin más no ve un error, ve una lista corta — y da por hecho que ésos son todos los
       * que hay. `limitPedido` sólo aparece cuando difiere del aplicado, así que quien no
       * choque con el tope no ve un campo de más.
       */
      pagination: {
        page, limit, total, totalPages,
        ...(limitPedido > limit ? { limitPedido, limitRecortado: true } : {}),
      },
      municipios: municipiosRaw.map((m) => m.municipio).filter(Boolean),
      faltantes,
    });
  } catch (error) {
    console.error('Error fetching clientes:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// POST /clientes/reasignar-vendedor { clienteIds: string[], vendedorId }
// Pasa VARIOS clientes al vendedor nuevo (ver lib/reasignarCliente): quedan suyos desde ahora y
// sus pedidos ABIERTOS pasan con ellos; lo ya hecho se queda con el vendedor de entonces. Una
// fila de historial por pedido movido. Todos tienen que ser de la misma sucursal que el vendedor.
// Solo Supervisor para arriba (de SU sucursal; los globales, de cualquiera).
router.post('/reasignar-vendedor', async (req, res) => {
  const ctx = getRequesterContext(req);
  if (!puedeReasignar(ctx.role, ctx.isGlobalAdmin)) {
    return res.status(403).json({ error: 'Solo un Supervisor o un rol superior puede reasignar clientes.' });
  }
  const ids: string[] = Array.isArray(req.body?.clienteIds)
    ? [...new Set<string>(req.body.clienteIds.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim()))]
    : [];
  const vendedorId = typeof req.body?.vendedorId === 'string' ? req.body.vendedorId.trim() : '';
  if (ids.length === 0) return res.status(400).json({ error: 'No hay clientes elegidos.' });
  if (ids.length > 500) return res.status(400).json({ error: 'Demasiados clientes de una vez (máximo 500).' });
  if (!vendedorId) return res.status(400).json({ error: 'Falta el vendedor nuevo.' });

  try {
    const clientes = await prisma.cliente.findMany({
      where: { id: { in: ids } },
      select: { id: true, sucursalId: true },
    });
    // Un Administrador solo toca clientes de su sucursal; los globales, de cualquiera.
    // Si falta alguno (o es de otra sucursal) no se hace NADA: mejor parar que dejar a medias.
    if (clientes.length !== ids.length || (!ctx.isGlobalAdmin && clientes.some((c) => c.sucursalId !== ctx.sucursalId))) {
      return res.status(404).json({ error: 'Algún cliente no se encontró.' });
    }

    const nuevo = await prisma.vendedor.findUnique({
      where: { id: vendedorId },
      select: { id: true, nombre: true, activo: true, sucursalId: true },
    });
    if (!nuevo || !nuevo.activo) return res.status(400).json({ error: 'El vendedor no existe o está de baja.' });
    // Nunca a un vendedor de otra sucursal: los pedidos quedarían ocultos para su sucursal.
    if (clientes.some((c) => c.sucursalId !== nuevo.sucursalId)) {
      return res.status(400).json({ error: 'Todos los clientes tienen que ser de la misma sucursal que el vendedor.' });
    }

    const pedidos = (
      await prisma.pedido.findMany({
        where: { clienteId: { in: ids }, estado: ESTADO_ABIERTO },
        select: { id: true, estado: true, vendedorId: true, vendedor: { select: { nombre: true } } },
      })
    ).map((p) => ({ id: p.id, estado: p.estado, vendedorId: p.vendedorId, vendedorNombre: p.vendedor?.nombre ?? null }));

    // De ahora en adelante son del vendedor nuevo, tengan o no pedidos abiertos.
    await prisma.cliente.updateMany({ where: { id: { in: ids } }, data: { vendedorAsignadoId: nuevo.id } });

    const plan = planReasignacion(pedidos, nuevo.id);
    if (plan.mover.length > 0) {
      await prisma.pedido.updateMany({
        where: { id: { in: plan.mover.map((p) => p.id) } },
        data: { vendedorId: nuevo.id },
      });
      await anotarHistorial(
        { origen: 'pantalla', por: ctx.username ?? null },
        plan.mover.map((p) => ({
          pedidoId: p.id,
          tipo: 'editado' as const,
          campo: 'vendedor',
          antes: p.vendedorNombre,
          despues: nuevo.nombre,
          nota: 'Pedido abierto: el cliente se reasignó a otro vendedor',
        })),
      );
    }

    await avisarReasignacion(ids, nuevo.sucursalId);

    return res.json({ clientes: ids.length, movidos: plan.mover.length, yaSuyos: plan.yaSuyos, vendedor: nuevo.nombre });
  } catch (error) {
    console.error('Error reasignando clientes:', error);
    return res.status(500).json({ error: 'Error al reasignar los clientes' });
  }
});

// POST /clientes/baja { clienteIds } y POST /clientes/reactivar { clienteIds }
// Dar de baja A MANO: el cliente queda inactivo (no sale al reparto ni a Entrega) y, aunque
// Parranda lo siga mandando, no se reactiva solo. Los pedidos NUEVOS que traigan los archivos para
// él se omiten; los ya cargados siguen igual y el cliente no se pierde. Mismos permisos y alcance
// que reasignar. `reactivar` lo deshace.
async function cambiarBaja(req: express.Request, res: express.Response, baja: boolean) {
  const ctx = getRequesterContext(req);
  if (!puedeReasignar(ctx.role, ctx.isGlobalAdmin)) {
    return res.status(403).json({ error: 'Solo un Supervisor o un rol superior puede dar de baja clientes.' });
  }
  const ids: string[] = Array.isArray(req.body?.clienteIds)
    ? [...new Set<string>(req.body.clienteIds.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim()))]
    : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No hay clientes elegidos.' });
  if (ids.length > 500) return res.status(400).json({ error: 'Demasiados clientes de una vez (máximo 500).' });

  try {
    const clientes = await prisma.cliente.findMany({ where: { id: { in: ids } }, select: { id: true, sucursalId: true } });
    if (clientes.length !== ids.length || (!ctx.isGlobalAdmin && clientes.some((c) => c.sucursalId !== ctx.sucursalId))) {
      return res.status(404).json({ error: 'Algún cliente no se encontró.' });
    }

    await prisma.cliente.updateMany({
      where: { id: { in: ids } },
      data: baja
        ? { activo: false, desactivadoAt: new Date(), bajaManual: true, bajaPor: ctx.username ?? null, bajaEn: new Date() }
        : { activo: true, desactivadoAt: null, bajaManual: false, bajaPor: null, bajaEn: null },
    });
    // Un aviso por sucursal implicada: el reparto repasa esa sucursal y deja de ver (o vuelve a ver) a estos.
    for (const sucursalId of new Set(clientes.map((c) => c.sucursalId))) {
      await avisarReasignacion(
        clientes.filter((c) => c.sucursalId === sucursalId).map((c) => c.id),
        sucursalId,
      );
    }

    return res.json({ clientes: ids.length, baja });
  } catch (error) {
    console.error('Error cambiando la baja de clientes:', error);
    return res.status(500).json({ error: 'Error al cambiar el estado de los clientes' });
  }
}
router.post('/baja', (req, res) => cambiarBaja(req, res, true));
router.post('/reactivar', (req, res) => cambiarBaja(req, res, false));

// GET /clientes/:id - Get cliente details
// ---------------------------------------------------------------------------------------------
// ¿El punto del cliente cae donde dice su dirección? (issue #13, 04/11/2026). La comparación y
// por qué es un AVISO y no un bloqueo están en `lib/geoDireccion.ts`. Solo Supervisor para arriba
// (de SU sucursal; el Super Admin, de cualquiera).
// ---------------------------------------------------------------------------------------------

/** La sucursal a la que se acota quien pide: la suya, o la que tenga elegida si es global (sin elegir, todas). */
function sucursalDeGeo(req: express.Request): { ok: boolean; sucursalId?: string; status?: number; error?: string } {
  const ctx = getRequesterContext(req);

  if (!puedeReasignar(ctx.role, ctx.isGlobalAdmin)) {
    return { ok: false, status: 403, error: 'Solo un Supervisor o un rol superior puede revisar las ubicaciones.' };
  }

  const f = resolveSucursalFilter(req);

  if (f.error) return { ok: false, status: f.status ?? 400, error: f.error };

  return { ok: true, sucursalId: f.sucursalId };
}

// POST /clientes/geo-evaluar — vuelve a comparar el punto de cada cliente con su calle y guarda el resultado.
router.post('/geo-evaluar', async (req, res) => {
  const alcance = sucursalDeGeo(req);

  if (!alcance.ok) return res.status(alcance.status ?? 400).json({ error: alcance.error });

  try {
    res.json({ sucursalId: alcance.sucursalId ?? null, resumen: await evaluarGeoClientes(alcance.sucursalId) });
  } catch (err) {
    console.error('geo-evaluar error:', err);
    res.status(500).json({ error: 'No se pudieron revisar las ubicaciones.' });
  }
});

// GET /clientes/geo-dudosos?sucursalId=&estado=revisar|no_coincide|todos&page=&limit=
router.get('/geo-dudosos', async (req, res) => {
  const alcance = sucursalDeGeo(req);

  if (!alcance.ok) return res.status(alcance.status ?? 400).json({ error: alcance.error });

  try {
    const estado = String(req.query.estado ?? 'todos');
    const estados = estado === 'revisar' || estado === 'no_coincide' ? [estado] : ['revisar', 'no_coincide'];
    // POR QUÉ se avisa, que es lo que el supervisor quiere ver. Sale del estado y de si hay distancia:
    // sin distancia y «no coincide» = el punto cae en otro municipio; sin distancia y «revisar» = la calle del punto
    // no es la escrita y el mapa no pudo ubicar la dirección (ver `geoComprobacion.ts`).
    const MOTIVOS: Record<string, { geoEstado: string; geoDistanciaKm: null | { not: null } }> = {
      otro_municipio: { geoEstado: 'no_coincide', geoDistanciaKm: null },
      lejos: { geoEstado: 'no_coincide', geoDistanciaKm: { not: null } },
      media_distancia: { geoEstado: 'revisar', geoDistanciaKm: { not: null } },
      calle_distinta: { geoEstado: 'revisar', geoDistanciaKm: null },
    };
    const motivo = String(req.query.motivo ?? 'todos');
    const filtroEstado = MOTIVOS[motivo] ?? { geoEstado: { in: estados } };
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 25));
    const donde = { activo: true, ...(alcance.sucursalId ? { sucursalId: alcance.sucursalId } : {}) };
    const q = String(req.query.search ?? '').trim();
    const buscar = q
      ? { OR: [{ nombre: { contains: q, mode: 'insensitive' as const } }, { codigo: { contains: q, mode: 'insensitive' as const } }] }
      : {};

    const [total, filas, cuentas, ...porMotivo] = await Promise.all([
      prisma.cliente.count({ where: { ...donde, ...buscar, ...filtroEstado } }),
      prisma.cliente.findMany({
        where: { ...donde, ...buscar, ...filtroEstado },
        // Lo más seguro primero: «no coincide» antes que «revisar», y dentro de cada uno el más lejos.
        orderBy: [{ geoEstado: 'asc' }, { geoDistanciaKm: { sort: 'desc', nulls: 'last' } }, { nombre: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, codigo: true, nombre: true, direccion: true, municipio: true, latitud: true, longitud: true,
          geoEstado: true, geoDistanciaKm: true, geoFuente: true, geoAt: true,
          sucursal: { select: { id: true, codigo: true, nombre: true } },
        },
      }),
      prisma.cliente.groupBy({ by: ['geoEstado'], where: donde, _count: { _all: true } }),
      ...Object.values(MOTIVOS).map((m) => prisma.cliente.count({ where: { ...donde, ...m } })),
    ]);

    const geos = filas.length
      ? await prisma.clienteGeocodificacion.findMany({
          where: { clienteId: { in: filas.map((f) => f.id) } },
          select: { clienteId: true, latitud: true, longitud: true, calle: true, barrio: true, municipios: true, adelanteConsultado: true, adelanteLat: true, adelanteLon: true },
        })
      : [];
    const porId = new Map(geos.map((g) => [g.clienteId, g]));
    // Cuántos puntos todavía no se han consultado al buscador de mapas (la primera pasada tarda horas).
    const pendientes = await prisma.cliente.count({ where: { ...donde, latitud: { not: null }, longitud: { not: null }, geoEstado: null } });

    res.json({
      total, page, limit,
      motivos: Object.fromEntries(Object.keys(MOTIVOS).map((k, i) => [k, porMotivo[i]])),
      pendientes,
      cuentas: Object.fromEntries(cuentas.map((c) => [c.geoEstado ?? 'sin_evaluar', c._count._all])),
      items: filas.map((f) => {
        const g = porId.get(f.id);

        return {
          ...f,
          // Lo que el mapa dice del punto y de la dirección, para que el supervisor vea por qué se avisa.
          delPunto: g ? { calle: g.calle, barrio: g.barrio, municipios: g.municipios ? g.municipios.split('|') : [] } : null,
          dondeSeUbicaLaDireccion: g?.adelanteConsultado && g.adelanteLat != null && g.adelanteLon != null ? { latitud: g.adelanteLat, longitud: g.adelanteLon } : null,
        };
      }),
    });
  } catch (err) {
    console.error('geo-dudosos error:', err);
    res.status(500).json({ error: 'No se pudo leer la lista.' });
  }
});

/** El cliente, si es de la sucursal de quien pide (o es global). */
async function clienteParaGeo(req: express.Request, res: express.Response) {
  const ctx = getRequesterContext(req);
  const alcance = sucursalDeGeo(req);

  if (!alcance.ok) {
    res.status(alcance.status ?? 400).json({ error: alcance.error });
    return null;
  }

  const c = await prisma.cliente.findUnique({
    where: { id: req.params.id },
    select: { id: true, sucursalId: true, latitud: true, longitud: true },
  });

  if (!c || (!ctx.isGlobalAdmin && c.sucursalId !== ctx.sucursalId)) {
    res.status(404).json({ error: 'Cliente no encontrado.' });
    return null;
  }

  return { c, ctx };
}

// POST /clientes/:id/geo-confirmar   body: { motivo }  — el supervisor da el punto por bueno.
router.post('/:id/geo-confirmar', async (req, res) => {
  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';

  if (motivo.length < 3 || motivo.length > 200) return res.status(400).json({ error: 'Escribe un motivo corto (3 a 200 letras).' });

  try {
    const r = await clienteParaGeo(req, res);

    if (!r) return;

    const por = r.ctx.username ?? 'desconocido';

    await prisma.$transaction([
      prisma.cliente.update({
        where: { id: r.c.id },
        data: { geoEstado: 'confirmado', geoRevisadoPor: por, geoRevisadoAt: new Date(), geoMotivo: motivo },
      }),
      // Queda apuntado quién y cuándo, junto a los demás cambios de ubicación del cliente.
      prisma.clienteGeoCambio.create({
        data: {
          clienteId: r.c.id,
          latitudAnterior: r.c.latitud, longitudAnterior: r.c.longitud,
          latitudNueva: r.c.latitud, longitudNueva: r.c.longitud,
          fuente: `confirmada:${por}`.slice(0, 120),
        },
      }),
    ]);
    res.json({ ok: true, estado: 'confirmado' });
  } catch (err) {
    console.error('geo-confirmar error:', err);
    res.status(500).json({ error: 'No se pudo confirmar.' });
  }
});

// PATCH /clientes/:id/geo   body: { latitud, longitud }  — el supervisor corrige el punto.
router.patch('/:id/geo', async (req, res) => {
  const lat = Number(req.body?.latitud);
  const lon = Number(req.body?.longitud);

  if (!puntoEnCuba(lat, lon)) return res.status(400).json({ error: 'Esas coordenadas no caen en Cuba: revisa latitud y longitud.' });

  try {
    const r = await clienteParaGeo(req, res);

    if (!r) return;

    const por = r.ctx.username ?? 'desconocido';

    await prisma.$transaction([
      prisma.clienteGeoCambio.create({
        data: {
          clienteId: r.c.id,
          latitudAnterior: r.c.latitud, longitudAnterior: r.c.longitud,
          latitudNueva: lat, longitudNueva: lon,
          fuente: `usuario:${por}`.slice(0, 120),
        },
      }),
      prisma.cliente.update({
        where: { id: r.c.id },
        data: {
          latitud: lat, longitud: lon, geolocalizacion: `${lat},${lon}`, geoFuente: `usuario:${por}`.slice(0, 120), geoAt: new Date(),
          // La distancia al almacén se midió desde donde el cliente estaba: se borra para que se recalcule.
          distanciaKm: null, distanciaDesde: null, distanciaAt: null,
          geoEstado: null, geoDistanciaKm: null, geoVecinoId: null, geoRevisadoPor: null, geoRevisadoAt: null, geoMotivo: null,
        },
      }),
    ]);
    // El reparto trabaja con dónde está el cliente: que se entere de que se movió.
    avisarAlReparto({ id: r.c.id, sucursalId: r.c.sucursalId, entidad: 'cliente', motivo: 'cliente', accion: 'update' });

    // Se vuelve a comparar su sucursal (tarda menos de un segundo) y se devuelve cómo quedó este cliente.
    await evaluarGeoClientes(r.c.sucursalId ?? undefined);

    const c = await prisma.cliente.findUnique({
      where: { id: r.c.id },
      select: { id: true, latitud: true, longitud: true, geoEstado: true, geoDistanciaKm: true },
    });

    res.json({ ok: true, cliente: c });
  } catch (err) {
    console.error('geo-corregir error:', err);
    res.status(500).json({ error: 'No se pudo corregir la ubicación.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sucursalId, error: sucursalError, status: sucursalStatus } = resolveSucursalFilter(req);
    if (sucursalError) {
      return res.status(sucursalStatus ?? 400).json({ error: sucursalError });
    }

    const cliente = await prisma.cliente.findFirst({
      where: { id, sucursalId }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(cliente);
  } catch (error) {
    console.error('Error fetching cliente:', error);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

export default router;
