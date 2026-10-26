import { test } from 'node:test';
import assert from 'node:assert/strict';

import { arrancarCarril, type ColaMinima } from '../src/lib/carrilEnCola';

/** Una cola de mentira: guarda lo encolado y deja correr el procesador a mano. */
function colaFalsa() {
  const puestos: number[] = [];
  let procesador: (() => Promise<unknown>) | null = null;
  let activos = 0;
  const cola: ColaMinima = {
    process: (_c, fn) => {
      procesador = fn;
    },
    add: async (_d, o) => {
      puestos.push(o.delay);
    },
    getJobCounts: async () => ({ active: activos, waiting: 0, delayed: 0 }),
  };

  return {
    cola,
    puestos,
    correr: () => procesador!(),
    marcarActivos: (n: number) => {
      activos = n;
    },
  };
}

test('al arrancar con la cola vacía pone el primer trabajo, con su espera', async () => {
  const f = colaFalsa();
  const c = await arrancarCarril(f.cola, { nombre: 't', cadaMs: 30_000, primeraEnMs: 120_000, trabajo: async () => undefined });

  assert.deepEqual(f.puestos, [120_000]);
  c.parar();
});

test('si ya hay algo en la cola (de antes del reinicio) no pone otro', async () => {
  const f = colaFalsa();

  f.marcarActivos(1);
  const c = await arrancarCarril(f.cola, { nombre: 't', cadaMs: 30_000, primeraEnMs: 1, trabajo: async () => undefined });

  assert.deepEqual(f.puestos, []);
  c.parar();
});

test('al terminar el trabajo pone el siguiente, y si el trabajo falla también', async () => {
  const f = colaFalsa();
  let n = 0;
  const c = await arrancarCarril(f.cola, {
    nombre: 't',
    cadaMs: 30_000,
    primeraEnMs: 5,
    trabajo: async () => {
      if (n++ === 0) throw new Error('boom');
    },
  });

  f.puestos.length = 0;
  await f.correr(); // falla
  await f.correr(); // sale bien

  assert.deepEqual(f.puestos, [30_000, 30_000]);
  c.parar();
});

test('la vigilancia repone la cadena si se rompió', async () => {
  const f = colaFalsa();
  const c = await arrancarCarril(f.cola, { nombre: 't', cadaMs: 30_000, primeraEnMs: 7, vigilaMs: 10, trabajo: async () => undefined });

  f.puestos.length = 0;
  await new Promise((r) => setTimeout(r, 40));

  assert.ok(f.puestos.includes(7));
  c.parar();
});
