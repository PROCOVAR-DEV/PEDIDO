/**
 * La lista (GET /orders) y el pedido que viaja por SSE (`pedidoParaLista`) llevan el
 * estado de CADA factura: `entregasDeFactura`, la más reciente primero.
 *
 * Sin base: el cliente de Prisma se sustituye por uno en memoria que HACE CASO al `include`
 * (relación, `select` y `orderBy`). Así, quitar el include o cambiar el orden rompe la prueba.
 * NO prueba que Postgres ordene igual; eso es el `orderBy` de Prisma.
 */
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type Fila = Record<string, any>;
let pedidos: Fila[] = [];
let entregas: Fila[] = [];
let consultasDeEntregas = 0;

/** Ordena como Prisma: criterios en orden, `desc` invierte. */
const ordenar = (filas: Fila[], orderBy: Array<Record<string, 'asc' | 'desc'>>) =>
  [...filas].sort((a, b) => {
    for (const c of orderBy) {
      const [k, dir] = Object.entries(c)[0];
      const d = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0;
      if (d) return dir === 'desc' ? -d : d;
    }
    return 0;
  });

const conInclude = (p: Fila, include: Fila) => {
  const salida: Fila = { ...p, items: [], cliente: null, vendedor: null };
  const rel = include.entregasDeFactura;

  if (rel) {
    consultasDeEntregas++;
    let filas = entregas.filter((e) => e.pedidoId === p.id);
    if (rel.orderBy) filas = ordenar(filas, rel.orderBy);
    salida.entregasDeFactura = filas.map((e) =>
      Object.fromEntries(Object.keys(rel.select).map((k) => [k, e[k]])),
    );
  }

  return salida;
};

const fake = {
  pedido: {
    findUnique: async ({ where, include }: any) => {
      const p = pedidos.find((x) => x.id === where.id);
      return p ? conInclude(p, include) : null;
    },
    count: async () => pedidos.length,
    groupBy: async () => [],
    findMany: async ({ include }: any) => pedidos.map((p) => conInclude(p, include)),
  },
};

let pedidoParaLista: typeof import('../src/routes/orders').pedidoParaLista;
let router: any;

before(async () => {
  (globalThis as any).prismaGlobal = fake;
  (globalThis as any).__dirname ??= process.cwd();
  const m = await import('../src/routes/orders');
  pedidoParaLista = m.pedidoParaLista;
  router = m.default;
});

const d = (iso: string) => new Date(iso);
const ent = (pedidoId: string, factura: string, estado: string, at: string, nota: string | null = null) => ({
  id: `${pedidoId}-${factura}`, pedidoId, factura, puntoDeVenta: '1', estado, nota, at: d(at), createdAt: d(at), updatedAt: d(at),
});

beforeEach(() => {
  consultasDeEntregas = 0;
  pedidos = [
    { id: 'p1', folio: 'A-1', sucursalId: 's1', estado: null, fecha_comprometida: null, costoDomicilio: null },
    { id: 'p2', folio: 'A-2', sucursalId: 's1', estado: null, fecha_comprometida: null, costoDomicilio: null },
  ];
  entregas = [
    ent('p1', '100', 'en_transito', '2026-10-23T10:00:00Z'),
    ent('p1', '300', 'cancelado', '2026-10-23T18:12:00Z', 'cliente no estaba'),
    ent('p1', '200', 'entregado', '2026-10-23T14:00:00Z'),
  ];
});

/** Llama al manejador real de GET / con una clave de servicio (identidad global de lectura). */
async function lista() {
  const capa = router.stack.find((l: any) => l.route?.path === '/' && l.route.methods.get);
  const handler = capa.route.stack.at(-1).handle;
  let cuerpo: any;
  const req: any = { query: { sucursalId: 's1' }, headers: {}, body: {}, apiKeyCtx: { id: 'k', label: 'k' } };
  const res: any = { status: () => res, json: (c: any) => (cuerpo = c) };

  await handler(req, res);

  return cuerpo;
}

test('la lista lleva las facturas de cada pedido, la más reciente primero, solo con los cinco campos', async () => {
  const r = await lista();
  const p1 = r.data.find((p: Fila) => p.id === 'p1');

  assert.deepEqual(p1.entregasDeFactura.map((e: Fila) => e.factura), ['300', '200', '100']);
  assert.deepEqual(Object.keys(p1.entregasDeFactura[0]).sort(), ['at', 'estado', 'factura', 'nota', 'puntoDeVenta']);
  assert.equal(p1.entregasDeFactura[0].nota, 'cliente no estaba');
});

test('la lista: un pedido sin filas por factura trae el arreglo vacío', async () => {
  const r = await lista();

  assert.deepEqual(r.data.find((p: Fila) => p.id === 'p2').entregasDeFactura, []);
});

test('el pedido que viaja por SSE (pedidoParaLista) lleva lo mismo y en el mismo orden', async () => {
  const p = (await pedidoParaLista('p1')) as Fila;

  assert.deepEqual(p.entregasDeFactura.map((e: Fila) => e.factura), ['300', '200', '100']);
  assert.deepEqual(((await pedidoParaLista('p2')) as Fila).entregasDeFactura, []);
});

test('empate de hora: manda la factura de número mayor, igual que el estado derivado del pedido', async () => {
  entregas.push(ent('p1', '400', 'devuelto', '2026-10-23T18:12:00Z'));
  const p = (await pedidoParaLista('p1')) as Fila;

  assert.deepEqual(p.entregasDeFactura.slice(0, 2).map((e: Fila) => e.factura), ['400', '300']);
});
