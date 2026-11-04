import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filasDeDomicilio } from '../src/lib/domicilioHistorial.ts';

const sin = { marcado: false, costo: null, tasa: null };

test('Entrega calcula el domicilio de un pedido que no lo pedía: cambia la marca, el costo y la tasa', () => {
  const f = filasDeDomicilio('p1', sin, { marcado: true, costo: 2.5, tasa: 760 });

  assert.deepEqual(f.map((x) => [x.campo, x.antes, x.despues]), [
    ['Requiere domicilio', 'no', 'sí'],
    ['Costo de domicilio', 'sin costo', '2.5'],
    ['Tasa de cambio del domicilio', 'sin costo', '760'],
  ]);
});

test('si el pedido ya pedía domicilio, solo cambia el costo', () => {
  const f = filasDeDomicilio('p1', { marcado: true, costo: null, tasa: 760 }, { marcado: true, costo: 1.23, tasa: 760 });

  assert.deepEqual(f.map((x) => x.campo), ['Costo de domicilio']);
});

test('la APK reintenta con lo mismo: no se apunta nada', () => {
  const e = { marcado: true, costo: 1.23, tasa: 760 };

  assert.equal(filasDeDomicilio('p1', e, { ...e }).length, 0);
});

test('un nuevo cálculo con otro importe apunta el antes y el después', () => {
  const f = filasDeDomicilio('p1', { marcado: true, costo: 1.23, tasa: 760 }, { marcado: true, costo: 1.5, tasa: 760 });

  assert.deepEqual(f.map((x) => [x.campo, x.antes, x.despues]), [['Costo de domicilio', '1.23', '1.5']]);
});

test('cancelar el domicilio: vuelve a «no» y sin costo', () => {
  const f = filasDeDomicilio('p1', { marcado: true, costo: 2.5, tasa: null }, { marcado: false, costo: null, tasa: null });

  assert.deepEqual(f.map((x) => [x.campo, x.antes, x.despues]), [
    ['Requiere domicilio', 'sí', 'no'],
    ['Costo de domicilio', '2.5', 'sin costo'],
  ]);
});
