import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inicioDeVentanaDePedidos } from '../src/lib/ventanaDePedidos';

test('el pedido del viernes a mediodía sigue dentro el lunes por la tarde (el caso PAL26-261023-1108)', () => {
  const lunesTarde = new Date('2026-10-26T13:55:00Z');
  const pedidoDelViernes = new Date('2026-10-23T12:00:00Z');

  assert.ok(pedidoDelViernes >= inicioDeVentanaDePedidos(lunesTarde, 3));
});

test('cuenta días enteros: empieza a las 00:00 UTC del día de hace N días', () => {
  assert.equal(inicioDeVentanaDePedidos(new Date('2026-10-26T13:55:00Z'), 3).toISOString(), '2026-10-23T00:00:00.000Z');
  assert.equal(inicioDeVentanaDePedidos(new Date('2026-10-26T00:00:01Z'), 3).toISOString(), '2026-10-23T00:00:00.000Z');
});

test('un pedido de hace cuatro días queda fuera', () => {
  assert.ok(new Date('2026-10-22T12:00:00Z') < inicioDeVentanaDePedidos(new Date('2026-10-26T13:55:00Z'), 3));
});
