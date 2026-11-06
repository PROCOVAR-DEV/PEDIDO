import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoDomicilioFactura as estado } from '../src/lib/domicilioFactura.ts';

const base = { requiere_domicilio: true, costoDomicilio: 2.5, facturaEstado: 'igual' };

test('pidió domicilio, con valor, y la factura no trae la línea: falta', () => {
  assert.equal(estado({ ...base, facturaDomicilio: null }), 'falta');
  assert.equal(estado({ ...base }), 'falta');
});

test('también falta si el valor puesto es 0', () => {
  assert.equal(estado({ ...base, costoDomicilio: 0, facturaDomicilio: null }), 'falta');
});

test('la línea está pero vale 0 y Pedido puso algo: sin precio', () => {
  assert.equal(estado({ ...base, facturaDomicilio: 0 }), 'sin_precio');
});

test('la línea cobra otro importe que el puesto: sin precio, también si cobra de más', () => {
  assert.equal(estado({ ...base, facturaDomicilio: 1.5 }), 'sin_precio');
  assert.equal(estado({ ...base, facturaDomicilio: 4 }), 'sin_precio');
});

test('cobra lo puesto, o difiere menos de un centavo: bien; con un centavo ya es error', () => {
  assert.equal(estado({ ...base, facturaDomicilio: 2.5 }), null);
  assert.equal(estado({ ...base, facturaDomicilio: 2.504 }), null);
  assert.equal(estado({ ...base, facturaDomicilio: 2.49 }), 'sin_precio');
});

test('domicilio gratis (0) con la línea a 0: bien', () => {
  assert.equal(estado({ ...base, costoDomicilio: 0, facturaDomicilio: 0 }), null);
});

test('marcado pero SIN valor (Entrega no lo calculó) no es una falta: no hay con qué comparar', () => {
  assert.equal(estado({ requiere_domicilio: true, costoDomicilio: null, facturaEstado: 'igual', facturaDomicilio: null }), null);
  assert.equal(estado({ requiere_domicilio: true, costoDomicilio: null, facturaEstado: 'igual', facturaDomicilio: 3 }), null);
});

test('sin domicilio marcado ni costo, o sin factura todavía, no hay aviso', () => {
  assert.equal(estado({ requiere_domicilio: false, costoDomicilio: 0, facturaEstado: 'igual', facturaDomicilio: null }), null);
  assert.equal(estado({ requiere_domicilio: null, costoDomicilio: null, facturaEstado: 'igual', facturaDomicilio: null }), null);
  assert.equal(estado({ ...base, facturaEstado: 'sin_factura', facturaDomicilio: null }), null);
  assert.equal(estado({ ...base, facturaEstado: null, facturaDomicilio: null }), null);
});

test('con un costo mayor que 0 se mira aunque la marca no esté (compatibilidad)', () => {
  assert.equal(estado({ requiere_domicilio: null, costoDomicilio: 2.5, facturaEstado: 'igual', facturaDomicilio: null }), 'falta');
});

test('una factura cambiada también se mira', () => {
  assert.equal(estado({ ...base, facturaEstado: 'cambiado', facturaDomicilio: 0 }), 'sin_precio');
});
