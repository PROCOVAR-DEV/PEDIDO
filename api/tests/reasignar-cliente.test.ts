import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planReasignacion } from '../src/lib/reasignarCliente';

const p = (id: string, vendedorId: string | null) => ({ id, vendedorId, vendedorNombre: vendedorId });

test('mueve todos los que no son del vendedor nuevo', () => {
  const r = planReasignacion([p('1', 'a'), p('2', 'b'), p('3', 'n'), p('4', null)], 'n');

  assert.deepEqual(r.mover.map((x) => x.id), ['1', '2', '4']);
  assert.equal(r.yaSuyos, 1);
});

test('con desde, solo toca los pedidos de ese vendedor', () => {
  const r = planReasignacion([p('1', 'a'), p('2', 'b'), p('3', 'a')], 'n', 'a');

  assert.deepEqual(r.mover.map((x) => x.id), ['1', '3']);
  assert.equal(r.yaSuyos, 0);
});

test('si ya son todos suyos no hay nada que mover', () => {
  const r = planReasignacion([p('1', 'n'), p('2', 'n')], 'n');

  assert.equal(r.mover.length, 0);
  assert.equal(r.yaSuyos, 2);
});
