import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filaDeFactura } from '../src/lib/facturaHistorial.ts';

test('aparece la factura de un pedido que estaba sin factura: se apunta con su número', () => {
  const f = filaDeFactura('p1', { estado: 'sin_factura', numero: null }, { estado: 'cambiado', numero: '877', diferencias: ['CERVEZA: facturado 10, no pedido'] });

  assert.equal(f?.campo, 'Factura');
  assert.equal(f?.antes, 'sin factura');
  assert.equal(f?.despues, 'facturado, distinto del pedido (factura 877)');
  assert.equal(f?.nota, 'CERVEZA: facturado 10, no pedido');
});

test('un pedido recién llegado, sin factura, no apunta nada', () => {
  assert.equal(filaDeFactura('p1', { estado: null, numero: null }, { estado: 'sin_factura', numero: null }), null);
});

test('lo que no cambió no apunta nada', () => {
  const e = { estado: 'igual', numero: '10' };

  assert.equal(filaDeFactura('p1', e, { ...e }), null);
});

test('cambia el número de factura, o se deja de encontrar la que había', () => {
  assert.equal(filaDeFactura('p1', { estado: 'igual', numero: '10' }, { estado: 'igual', numero: '11' })?.despues, 'facturado, igual al pedido (factura 11)');
  assert.equal(filaDeFactura('p1', { estado: 'igual', numero: '10' }, { estado: 'sin_factura', numero: null })?.despues, 'sin factura');
});
