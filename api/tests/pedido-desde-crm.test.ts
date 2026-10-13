/**
 * Lo que decide si un pedido del CRM entra.
 *
 * Su folio es el del CRM, tal cual. Lo delicado es que el cotejo lo reconozca en la nota
 * de la factura: si no, el pedido no se daría por facturado nunca. Por eso se prueba
 * contra `folioDeLaNota`, la función de verdad (más casos en `emparejar-factura.test.ts`).
 * El alta contra una base de verdad está en `scripts/pruebas-crm.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { importeDeLinea, leerPedidoCrm, mismasLineas } from '../src/lib/pedidoDesdeCrm';
import { facturasPorFolio, folioDeLaNota, prefijoDeFolio } from '../src/lib/emparejarFactura';

const bueno = () => ({
  folio: 'A001-20261013-000042',
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
  b.folio = 'PDG26-260906-2992';
  b.fecha = '13/10/2026';
  b.lineas = [{ producto: '', cantidad: 0 }];
  const r = leerPedidoCrm(b);
  assert.equal(r.ok, false);
  const campos = 'campos' in r ? r.campos.map((c) => c.campo) : [];
  assert.deepEqual(campos, ['folio', 'fecha', 'lineas[0].producto', 'lineas[0].cantidad']);
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

test('el folio del CRM lo reconoce el cotejo en la nota de la factura', () => {
  const r = leerPedidoCrm(bueno());
  assert.ok('pedido' in r);
  if (!('pedido' in r)) return;
  assert.equal(r.pedido.folio, 'A001-20261013-000042');
  assert.equal(folioDeLaNota(`P-${r.pedido.folio}; V-ANA PEREZ; C-LH15TCP0295;`), r.pedido.folio);
  assert.equal(prefijoDeFolio(`P-${r.pedido.folio}`), 'P-A001-20261013');
});

test('el código del vendedor tiene que ser el del principio del folio', () => {
  const b: any = bueno();
  b.vendedor.codigo = 'B002';
  const r = leerPedidoCrm(b);
  assert.equal(r.ok, false);
  assert.deepEqual('campos' in r ? r.campos.map((c) => c.campo) : [], ['vendedor.codigo']);
});

test('el importe de la línea sólo si vino en CUP', () => {
  const l = { sku: 'x', producto: 'x', cantidad: 3, precioUnitario: 10.105, moneda: 'CUP', hl: null };
  assert.equal(importeDeLinea(l), 30.32);
  assert.equal(importeDeLinea({ ...l, moneda: 'MLC' }), null);
  assert.equal(importeDeLinea({ ...l, precioUnitario: null }), null);
});

test('mismas líneas: por cantidades, sin mirar nombres ni orden', () => {
  assert.equal(mismasLineas([{ unidades: 24 }, { unidades: 6 }], [{ unidades: 6 }, { unidades: 24 }]), true);
  assert.equal(mismasLineas([{ unidades: 24 }], [{ unidades: 24 }, { unidades: 6 }]), false);
  assert.equal(mismasLineas([{ unidades: 24 }], [{ unidades: 12 }]), false);
  assert.equal(mismasLineas([], []), false);
});

test('Retool y el CRM conviven: una nota de cada uno casa con SU pedido', () => {
  const porFolio = facturasPorFolio([
    { operNumber: '100', nota: 'P-PDG26-261013-2992; V-DIANGO GOLA; C-LH15;' },
    { operNumber: '101', nota: 'P-PDG26-261013-2992-1; V-DIANGO GOLA; C-LH16;' },
    { operNumber: '102', nota: 'P-A001-20261013-000042; V-ANA PEREZ; C-LH15;' },
  ]);
  assert.deepEqual([...porFolio.get('PDG26-261013-2992')!], ['100']);
  assert.deepEqual([...porFolio.get('PDG26-261013-2992-1')!], ['101']);
  assert.deepEqual([...porFolio.get('A001-20261013-000042')!], ['102']);
});
