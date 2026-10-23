/**
 * Estado de entrega por FOLIO y por FACTURA (`aplicarEstadosDeEntrega`).
 *
 * Sin base: se sustituye el cliente de Prisma por uno en memoria que entiende justo lo que
 * la función le pregunta (id, folio sin distinguir mayúsculas, sucursalId). Eso prueba la
 * lógica de alcance, ambigüedad y fusión; NO prueba que Postgres haga lo mismo.
 */
import test, { before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

type Fila = Record<string, any>;
let pedidos: Fila[] = [];
let entregas: Fila[] = [];
let n = 0;

const pasa = (p: Fila, where: Fila) =>
  Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' && 'equals' in v
      ? String(p[k]).toLowerCase() === String(v.equals).toLowerCase()
      : p[k] === v,
  );

const fake = {
  pedido: {
    findFirst: async ({ where }: any) => pedidos.find((p) => pasa(p, where)) ?? null,
    findMany: async ({ where, take }: any) => pedidos.filter((p) => pasa(p, where)).slice(0, take),
    update: async ({ where, data }: any) => Object.assign(pedidos.find((p) => p.id === where.id)!, data),
  },
  sucursal: {
    findFirst: async ({ where }: any) => {
      const [porId, porCodigo] = where.OR;
      const s = [{ id: 's1', codigo: 'CAM' }, { id: 's2', codigo: 'STG' }].find(
        (x) => x.id === porId.id || x.codigo === porCodigo.codigo,
      );
      return s ? { id: s.id } : null;
    },
  },
  entregaDeFactura: {
    findUnique: async ({ where }: any) => {
      const c = where.pedidoId_factura_puntoDeVenta;
      return entregas.find((x) => x.pedidoId === c.pedidoId && x.factura === c.factura && x.puntoDeVenta === c.puntoDeVenta) ?? null;
    },
    create: async ({ data }: any) => entregas.push({ id: `e${++n}`, ...data }),
    updateMany: async ({ where, data }: any) => {
      const f = entregas.find((x) => x.id === where.id && x.at <= where.at.lte);
      if (f) Object.assign(f, data);
      return { count: f ? 1 : 0 };
    },
    findMany: async ({ where }: any) => entregas.filter((x) => x.pedidoId === where.pedidoId),
  },
};

let aplicar: typeof import('../src/lib/estadoEntrega').aplicarEstadosDeEntrega;
let derivar: typeof import('../src/lib/estadoEntrega').derivarEstadoDelPedido;

before(async () => {
  (globalThis as any).prismaGlobal = fake;
  // La app se compila a CommonJS; aquí Node corre el .ts como ESM y `sucursalLocal` usa __dirname.
  (globalThis as any).__dirname ??= process.cwd();
  ({ aplicarEstadosDeEntrega: aplicar, derivarEstadoDelPedido: derivar } = await import('../src/lib/estadoEntrega'));
});

const ped = (id: string, folio: string, sucursalId: string, extra: Fila = {}) => ({
  id, folio, sucursalId, estadoEntrega: null, estadoEntregaAt: null, estadoEntregaNota: null, ...extra,
});

beforeEach(() => {
  n = 0;
  entregas = [];
  pedidos = [ped('p1', 'PSV26-261021-1062', 's1'), ped('p2', 'PAA26-260907-1828', 's1'), ped('p3', 'PAA26-260907-1828-1', 's1')];
});
afterEach(() => mock.restoreAll());

const sinPantalla = async () => ({});
const original = fs.readFileSync;
const local = (id: string) =>
  mock.method(fs, 'readFileSync', ((f: any, ...r: any[]) =>
    String(f).endsWith('config.json') ? JSON.stringify({ sucursalId: id }) : original(f, ...r)) as any);

// ------------------------------------------------------------------ lo de siempre

test('pedidoId sin factura: igual que siempre, escribe en el pedido', async () => {
  const r = await aplicar([{ pedidoId: 'p1', estado: 'entregado', nota: 'ok' }], sinPantalla);

  assert.deepEqual(r.aplicados, [{ pedidoId: 'p1', folio: 'PSV26-261021-1062', estado: 'entregado' }]);
  assert.equal(pedidos[0].estadoEntrega, 'entregado');
  assert.equal(entregas.length, 0);
});

test('pedidoId inexistente: el motivo de siempre', async () => {
  const r = await aplicar([{ pedidoId: 'nope', estado: 'entregado' }], sinPantalla);

  assert.deepEqual(r.rechazados, [{ pedidoId: 'nope', motivo: 'no existe aquí (¿otra sucursal?)' }]);
});

test('ni pedidoId ni folio: se rechaza con motivo', async () => {
  const r = await aplicar([{ estado: 'entregado' }], sinPantalla);

  assert.equal(r.aplicados.length, 0);
  assert.match(r.rechazados[0].motivo, /falta pedidoId o folio/);
});

test('estado desconocido sigue rechazándose, también por folio', async () => {
  const r = await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'volando' }], sinPantalla);

  assert.match(r.rechazados[0].motivo, /desconocido/);
  assert.equal(r.rechazados[0].folio, 'PSV26-261021-1062');
});

// ------------------------------------------------------------------ por folio

test('por folio + factura: aplica, y aplicados lleva el pedidoId interno', async () => {
  const r = await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'despachado' }], sinPantalla);

  assert.deepEqual(r.aplicados, [{ pedidoId: 'p1', folio: 'PSV26-261021-1062', estado: 'despachado', factura: 'F1' }]);
  assert.equal(entregas.length, 1);
  assert.equal(pedidos[0].estadoEntrega, 'despachado');
});

test('folio con otra capitalización, espacios, guion raro y P- delante: aplica', async () => {
  const r = await aplicar(
    [
      { folio: ' psv26-261021-1062 ', factura: 'F1', estado: 'despachado' },
      { folio: 'P-PSV26–261021–1062', factura: 'F2', estado: 'despachado' },
    ],
    sinPantalla,
  );

  assert.equal(r.aplicados.length, 2);
  assert.equal(r.aplicados[0].pedidoId, 'p1');
});

test('el sufijo -1 NO se pierde: son dos pedidos', async () => {
  const r = await aplicar([{ folio: 'paa26-260907-1828-1', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.equal(r.aplicados[0].pedidoId, 'p3');
});

test('folio inexistente: rechazado con «no existe aquí (folio …)»', async () => {
  const r = await aplicar([{ folio: 'zz-1', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.deepEqual(r.rechazados, [{ folio: 'zz-1', factura: 'F1', motivo: 'no existe aquí (folio ZZ-1)' }]);
});

test('folio repetido entre sucursales: «folio ambiguo», nunca elige', async () => {
  pedidos.push(ped('p9', 'PSV26-261021-1062', 's2'));
  const r = await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.equal(r.aplicados.length, 0);
  assert.match(r.rechazados[0].motivo, /^folio ambiguo/);
  assert.equal(entregas.length, 0);
});

test('...pero con `sucursal` se desambigua (estrecha, no amplía)', async () => {
  pedidos.push(ped('p9', 'PSV26-261021-1062', 's2'));
  const r = await aplicar([{ folio: 'PSV26-261021-1062', sucursal: 'STG', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.equal(r.aplicados[0].pedidoId, 'p9');
});

test('con el alcance de una sucursal, el folio de otra no se ve', async () => {
  local('s1');
  pedidos.push(ped('p9', 'ONLY-S2-1', 's2'));
  const r = await aplicar([{ folio: 'ONLY-S2-1', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.match(r.rechazados[0].motivo, /no existe aquí/);
});

test('con alcance, y folio repetido en otra sucursal: sólo cuenta el de la suya (no es ambiguo)', async () => {
  local('s1');
  pedidos.push(ped('p9', 'PSV26-261021-1062', 's2'));
  const r = await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.equal(r.aplicados[0].pedidoId, 'p1');
});

test('sucursal del cuerpo fuera del alcance: rechazada con motivo', async () => {
  local('s1');
  pedidos.push(ped('p9', 'PSV26-261021-1062', 's2'));
  const r = await aplicar([{ folio: 'PSV26-261021-1062', sucursal: 'STG', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.equal(r.aplicados.length, 0);
  assert.match(r.rechazados[0].motivo, /fuera del alcance/);
});

test('sucursal que no existe: rechazada', async () => {
  const r = await aplicar([{ folio: 'PSV26-261021-1062', sucursal: 'XXX', factura: 'F1', estado: 'entregado' }], sinPantalla);

  assert.match(r.rechazados[0].motivo, /fuera del alcance/);
});

test('por folio sin factura: rechazado (se pisarían entre facturas)', async () => {
  const r = await aplicar([{ folio: 'PSV26-261021-1062', estado: 'entregado' }], sinPantalla);

  assert.match(r.rechazados[0].motivo, /falta factura/);
  assert.equal(pedidos[0].estadoEntrega, null);
});

// ------------------------------------------------------------------ por factura

test('dos facturas del mismo pedido son DOS filas y no se pisan', async () => {
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'entregado', at: '2026-10-22T10:00:00Z' }], sinPantalla);
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F2', estado: 'en_transito', at: '2026-10-22T11:00:00Z' }], sinPantalla);

  assert.equal(entregas.length, 2);
  assert.equal(entregas.find((e) => e.factura === 'F1')!.estado, 'entregado');
  // No todas entregadas -> manda la más reciente.
  assert.equal(pedidos[0].estadoEntrega, 'en_transito');
});

test('con todas entregadas, el pedido queda entregado', async () => {
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'entregado', at: '2026-10-22T10:00:00Z' }], sinPantalla);
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F2', estado: 'en_transito', at: '2026-10-22T11:00:00Z' }], sinPantalla);
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F2', estado: 'entregado', at: '2026-10-22T12:00:00Z' }], sinPantalla);

  assert.equal(pedidos[0].estadoEntrega, 'entregado');
  assert.equal(entregas.length, 2);
});

test('repetir el mismo aviso no cambia nada (ni el pedido)', async () => {
  const aviso = { folio: 'PSV26-261021-1062', factura: 'F1', estado: 'despachado', at: '2026-10-22T10:00:00Z' };
  await aplicar([aviso], sinPantalla);
  const antes = JSON.stringify([entregas, pedidos]);
  const upd = mock.method(fake.pedido, 'update');
  const r = await aplicar([aviso, { ...aviso, at: '2026-10-22T10:05:00Z' }], sinPantalla);

  assert.equal(r.ok, true);
  assert.equal(JSON.stringify([entregas, pedidos]), antes);
  assert.equal(upd.mock.callCount(), 0);
});

test('un estado nuevo de la MISMA factura la reemplaza', async () => {
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'despachado', at: '2026-10-22T10:00:00Z' }], sinPantalla);
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'entregado', at: '2026-10-22T12:00:00Z' }], sinPantalla);

  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].estado, 'entregado');
  assert.equal(pedidos[0].estadoEntrega, 'entregado');
});

test('un aviso VIEJO que llega tarde no pisa al nuevo', async () => {
  await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'entregado', at: '2026-10-22T12:00:00Z' }], sinPantalla);
  const r = await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'despachado', at: '2026-10-22T10:00:00Z' }], sinPantalla);

  assert.equal(entregas[0].estado, 'entregado');
  assert.equal(pedidos[0].estadoEntrega, 'entregado');
  assert.equal(r.aplicados[0].ignorado, 'anterior_al_guardado');
  assert.equal(r.ok, true);
});

test('puntoDeVenta distinto con el mismo número de factura son filas distintas', async () => {
  await aplicar([{ pedidoId: 'p1', factura: '7', puntoDeVenta: 'A', estado: 'despachado', at: '2026-10-22T10:00:00Z' }], sinPantalla);
  await aplicar([{ pedidoId: 'p1', factura: '7', puntoDeVenta: 'B', estado: 'despachado', at: '2026-10-22T10:00:00Z' }], sinPantalla);

  assert.equal(entregas.length, 2);
});

test('un `at` inválido se rechaza', async () => {
  const r = await aplicar([{ folio: 'PSV26-261021-1062', factura: 'F1', estado: 'despachado', at: 'ayer' }], sinPantalla);

  assert.match(r.rechazados[0].motivo, /at inválido/);
  assert.equal(entregas.length, 0);
});

// ------------------------------------------------------------------ la regla de derivación

const fila = (factura: string, estado: string, hora: number, nota: string | null = null) => ({
  factura, estado, nota, at: new Date(Date.UTC(2026, 9, 22, hora)),
});

test('derivar: sin facturas, nada (el pedido conserva su estado de siempre)', () => {
  assert.equal(derivar([]), null);
});

test('derivar: todas entregadas -> entregado', () => {
  assert.equal(derivar([fila('A', 'entregado', 9), fila('B', 'entregado', 11)])!.estado, 'entregado');
});

test('derivar: si no, la de `at` más reciente (aunque la vieja sea entregado)', () => {
  assert.equal(derivar([fila('A', 'entregado', 9), fila('B', 'devuelto', 11)])!.estado, 'devuelto');
  assert.equal(derivar([fila('A', 'en_transito', 12), fila('B', 'entregado', 11)])!.estado, 'en_transito');
});

test('derivar: empate de hora, decide el número de factura mayor, no el orden de las filas', () => {
  const a = fila('A', 'devuelto', 9);
  const b = fila('B', 'despachado', 9);

  assert.equal(derivar([a, b])!.estado, 'despachado');
  assert.equal(derivar([b, a])!.estado, 'despachado');
});
