/**
 * Lo que decide si un pedido del CRM entra, y con qué folio.
 *
 * Lo delicado es el folio: si el nuestro no tuviera la forma que reconoce el cotejo, la
 * factura que lo lleve en la nota no se emparejaría con nada y el pedido no se daría por
 * facturado nunca. Por eso se prueba contra `folioDeLaNota`, la función de verdad.
 * El alta contra una base de verdad está en `scripts/pruebas-crm.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { folioDePedidoCrm, importeDeLinea, leerPedidoCrm } from '../src/lib/pedidoDesdeCrm';
import { folioDeLaNota, prefijoDeFolio } from '../src/lib/emparejarFactura';

const bueno = () => ({
  crmPedidoId: '0192f1e2-3b4c-7d5e-8f60-718293a4b5c6',
  folioCrm: 'A001-20261013-000042',
  sucursal: 'cam',
  fecha: '2026-10-13',
  fechaComprometida: null,
  vendedor: { codigo: 'a001', accesosId: 'u-1', nombre: 'ANA PEREZ' },
  cliente: { codigo: 'CLI-1', codigoCcsa: 'LH15TCP0295', nombre: 'Kiosco Alien', telefono: '5355' },
  puntoDeVenta: { codigo: 'PV-1', nombre: 'Kiosco Alien', direccion: 'Calle 1' },
  domicilio: { requiere: true, costoUsd: 3.5, distanciaKm: 4.2, tasa: 410 },
  lineas: [{ sku: 'PAR-355', producto: 'Parranda 355ml', cantidad: 24, precioUnitario: 120, moneda: 'CUP', hl: 0.0852 }],
});

test('un pedido bueno entra limpio: códigos en mayúsculas y nulos donde no hay dato', () => {
  const r = leerPedidoCrm(bueno());
  assert.ok(r.ok);
  if (!('pedido' in r)) return;
  assert.equal(r.pedido.sucursal, 'CAM');
  assert.equal(r.pedido.vendedor.codigo, 'A001');
  assert.equal(r.pedido.domicilio.costoUsd, 3.5);
  assert.equal(r.pedido.detalles, null);
});

test('devuelve TODOS los campos que fallan de una vez', () => {
  const b: any = bueno();
  b.crmPedidoId = 'no-es-uuid';
  b.folioCrm = 'PDG26-260906-2992';
  b.fecha = '13/10/2026';
  b.lineas = [{ producto: '', cantidad: 0 }];
  const r = leerPedidoCrm(b);
  assert.equal(r.ok, false);
  const campos = 'campos' in r ? r.campos.map((c) => c.campo) : [];
  assert.deepEqual(campos, ['crmPedidoId', 'folioCrm', 'fecha', 'lineas[0].producto', 'lineas[0].cantidad']);
});

test('sin código de vendedor (LOC0) no entra: todos los que no lo tienen serían el mismo', () => {
  const b: any = bueno();
  b.vendedor.codigo = 'LOC0';
  const r = leerPedidoCrm(b);
  assert.equal(r.ok, false);
});

test('un costo que falta es nulo, no cero; uno negativo o que no es número no entra', () => {
  const b: any = bueno();
  b.domicilio = { requiere: false };
  const r = leerPedidoCrm(b);
  assert.ok('pedido' in r && r.pedido.domicilio.costoUsd === null);

  b.domicilio = { requiere: true, costoUsd: 'tres' };
  assert.equal(leerPedidoCrm(b).ok, false);
  b.domicilio = { requiere: true, costoUsd: -1 };
  assert.equal(leerPedidoCrm(b).ok, false);
});

test('nuestro folio tiene la forma que el cotejo lee de la nota de la factura', () => {
  const folio = folioDePedidoCrm('2026-10-13', 17);
  assert.equal(folio, 'CRM26-261013-17');
  assert.equal(folioDeLaNota(`P-${folio}; V-ANA PEREZ; C-LH15TCP0295;`), folio);
  assert.equal(prefijoDeFolio(`P-${folio}`), 'P-CRM26-261013');
  // Y el número llega a seis cifras sin dejar de casar.
  assert.equal(folioDeLaNota(`P-${folioDePedidoCrm('2026-10-13', 999999)};`), 'CRM26-261013-999999');
});

test('el folio del CRM NO lo reconoce el cotejo: por eso no va en `folio`', () => {
  assert.equal(folioDeLaNota('P-A001-20261013-000042; V-ANA PEREZ;'), null);
});

test('el importe de la línea sólo si vino en CUP', () => {
  const l = { sku: 'x', producto: 'x', cantidad: 3, precioUnitario: 10.105, moneda: 'CUP', hl: null };
  assert.equal(importeDeLinea(l), 30.32);
  assert.equal(importeDeLinea({ ...l, moneda: 'MLC' }), null);
  assert.equal(importeDeLinea({ ...l, precioUnitario: null }), null);
});
