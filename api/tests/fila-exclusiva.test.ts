import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearFilaExclusiva } from '../src/lib/filaExclusiva';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('dos trabajos pedidos a la vez no se solapan y salen en orden', async () => {
  const enFila = crearFilaExclusiva();
  const eventos: string[] = [];
  const trabajo = (n: string, ms: number) => async () => {
    eventos.push(`empieza ${n}`);
    await espera(ms);
    eventos.push(`acaba ${n}`);
  };

  await Promise.all([enFila(trabajo('A', 30)), enFila(trabajo('B', 5))]);

  assert.deepEqual(eventos, ['empieza A', 'acaba A', 'empieza B', 'acaba B']);
});

test('si uno falla, el siguiente corre igual', async () => {
  const enFila = crearFilaExclusiva();
  const malo = enFila(async () => {
    throw new Error('boom');
  });
  const bueno = enFila(async () => 'ok');

  await assert.rejects(malo, /boom/);
  assert.equal(await bueno, 'ok');
});
