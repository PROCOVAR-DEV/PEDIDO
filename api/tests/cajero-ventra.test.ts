import assert from 'node:assert/strict';
import { test } from 'node:test';

import { elegirCajero, facturasDe } from '../src/lib/cajeroVentra';
import type { LineaVentaVentra, PagoVentra } from '../src/lib/ventra';
import { camposParaCompletar, POR_LA_FACTURA } from '../src/lib/reglaFactura';

const linea = (o: Partial<LineaVentaVentra>): LineaVentaVentra => ({
  id: '1', fecha: '2026-10-20T04:00:00.000Z', operNumber: '100', clienteCodigo: null, clienteNombre: 'ELIO LUIS GARCIA FALS',
  productoCodigo: null, productoNombre: 'ARROZ', cantidad: 1, precioUsd: 10, descuento: 0, nota: null, almacenCodigo: null,
  almacenNombre: 'ALM CAMAGUEY', ...o,
});
const pago = (o: Partial<PagoVentra>): PagoVentra => ({
  fecha: '2026-10-20', cliente: 'Elio Luis García Fals', almacen: 'ALM CAMAGUEY', importe: 129, cajero: 'Caja#3-Yasmani', ...o,
});

test('el total de la factura suma las líneas y resta el descuento', () => {
  const [f] = facturasDe([linea({ cantidad: 10, precioUsd: 13, descuento: 1 }), linea({ id: '2', cantidad: 0, precioUsd: 5 })]);

  assert.equal(f.total, 129);
  assert.equal(f.fecha, '2026-10-20');
});

test('dos facturas distintas no se mezclan', () => {
  assert.equal(facturasDe([linea({}), linea({ id: '2', operNumber: '101' })]).length, 2);
});

test('el cajero sale de fecha, cliente (sin tildes ni mayúsculas), almacén e importe', () => {
  const [f] = facturasDe([linea({ cantidad: 10, precioUsd: 12.9 })]);

  assert.equal(elegirCajero([pago({})], f), 'Caja#3-Yasmani');
});

test('un importe distinto, otro día u otro cliente no es su cobro', () => {
  const [f] = facturasDe([linea({ cantidad: 10, precioUsd: 12.9 })]);

  assert.equal(elegirCajero([pago({ importe: 128 })], f), null);
  assert.equal(elegirCajero([pago({ fecha: '2026-10-19' })], f), null);
  assert.equal(elegirCajero([pago({ cliente: 'OTRO CLIENTE' })], f), null);
});

test('dos cobros iguales del mismo cajero valen; de dos cajeros distintos, no se decide', () => {
  const [f] = facturasDe([linea({ cantidad: 10, precioUsd: 12.9 })]);

  assert.equal(elegirCajero([pago({}), pago({})], f), 'Caja#3-Yasmani');
  assert.equal(elegirCajero([pago({}), pago({ cajero: 'Caja#2-Roxana' })], f), null);
});

test('completar por factura pone al cajero; sin cajero, la marca de siempre', () => {
  assert.equal(camposParaCompletar('igual', 'en_proceso', 'Caja#1-Daineris')?.completadoPor, 'Caja#1-Daineris');
  assert.equal(camposParaCompletar('igual', 'en_proceso', null)?.completadoPor, POR_LA_FACTURA);
  assert.equal(camposParaCompletar('igual', 'en_proceso', '  ')?.completadoPor, POR_LA_FACTURA);
  assert.equal(camposParaCompletar('igual', 'completada', 'Caja#1-Daineris'), null); // ya completado: no se toca
});
