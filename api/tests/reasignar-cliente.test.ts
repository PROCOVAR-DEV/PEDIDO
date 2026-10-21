import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planReasignacion, puedeReasignar } from '../src/lib/reasignarCliente';

const p = (id: string, vendedorId: string | null, estado: string | null = 'en_proceso') => ({
  id,
  vendedorId,
  vendedorNombre: vendedorId,
  estado,
});

test('solo se mueven los pedidos abiertos que no son ya del vendedor nuevo', () => {
  const r = planReasignacion([p('1', 'a'), p('2', 'b'), p('3', 'n'), p('4', null)], 'n');

  assert.deepEqual(r.mover.map((x) => x.id), ['1', '2', '4']);
  assert.equal(r.yaSuyos, 1);
});

test('lo completado o expirado se queda con el vendedor de entonces', () => {
  const r = planReasignacion([p('1', 'a', 'completada'), p('2', 'a', 'expirada'), p('3', 'a', null), p('4', 'a')], 'n');

  assert.deepEqual(r.mover.map((x) => x.id), ['4']);
});

test('si no hay nada abierto no hay nada que mover', () => {
  const r = planReasignacion([p('1', 'a', 'completada')], 'n');

  assert.equal(r.mover.length, 0);
  assert.equal(r.yaSuyos, 0);
});

test('reasignan Supervisor y todo lo de arriba; Gestor y Operador no', () => {
  for (const r of ['SUPERVISOR', 'GERENTE', 'ADMINISTRADOR', 'SUPER ADMIN', 'DESARROLLADOR']) {
    assert.equal(puedeReasignar(r, false), true, r);
  }
  for (const r of ['GESTOR', 'OPERADOR', 'ECONOMICA', 'ANALISTA', 'LOGISTICO', '', undefined]) {
    assert.equal(puedeReasignar(r, false), false, String(r));
  }
  assert.equal(puedeReasignar('OPERADOR', true), true);
});
