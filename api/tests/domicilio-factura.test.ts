import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoDomicilioFactura as estado } from '../src/lib/domicilioFactura.ts';

const base = { costoDomicilio: 2.5, facturaEstado: 'igual' };

test('la factura no trae la línea de domicilio: falta', () => {
  assert.equal(estado({ ...base, facturaDomicilio: null }), 'falta');
  assert.equal(estado({ ...base }), 'falta');
});

test('la línea está pero vale 0: sin precio', () => {
  assert.equal(estado({ ...base, facturaDomicilio: 0 }), 'sin_precio');
});

test('la línea cobra otro importe que el cotizado: sin precio, también si cobra de más', () => {
  assert.equal(estado({ ...base, facturaDomicilio: 1.5 }), 'sin_precio');
  assert.equal(estado({ ...base, facturaDomicilio: 4 }), 'sin_precio');
});

test('cobra lo cotizado, o difiere menos de un centavo: bien', () => {
  assert.equal(estado({ ...base, facturaDomicilio: 2.5 }), null);
  assert.equal(estado({ ...base, facturaDomicilio: 2.504 }), null);
  assert.equal(estado({ ...base, facturaDomicilio: 2.49 }), 'sin_precio');
});

test('sin domicilio cotizado, o sin factura todavía, no hay aviso', () => {
  assert.equal(estado({ costoDomicilio: null, facturaEstado: 'igual', facturaDomicilio: null }), null);
  assert.equal(estado({ costoDomicilio: 0, facturaEstado: 'igual', facturaDomicilio: 0 }), null);
  assert.equal(estado({ costoDomicilio: 2.5, facturaEstado: 'sin_factura', facturaDomicilio: null }), null);
  assert.equal(estado({ costoDomicilio: 2.5, facturaEstado: null, facturaDomicilio: null }), null);
});

test('una factura corregida o cambiada también se mira', () => {
  assert.equal(estado({ costoDomicilio: 2.5, facturaEstado: 'cambiado', facturaDomicilio: 0 }), 'sin_precio');
});
