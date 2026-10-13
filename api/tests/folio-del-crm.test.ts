/**
 * El cotejo con Ventra reconoce TAMBIÉN el folio del CRM (`A001-20261013-000042`).
 *
 * Es un añadido: los de Retool (`P…`, con nuestro sufijo `-1`/`-2`) tienen que seguir
 * leyéndose exactamente igual, y sus pruebas (`emparejar-factura.test.ts`,
 * `prefijoDeFolio.test.ts`) no se han tocado. Aquí sólo lo nuevo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { facturasPorFolio, folioDeLaNota, prefijoDeFolio, prefijoDeNota } from '../src/lib/emparejarFactura';

test('EL FOLIO DEL CRM se lee de la nota, con etiqueta o suelto', () => {
  assert.equal(folioDeLaNota('P-A001-20261013-000042; V-ANA PEREZ; C-LH15TCP0295;'), 'A001-20261013-000042');
  assert.equal(folioDeLaNota('pedido a7p1-20260903-000042 entregado'), 'A7P1-20260903-000042');
});

test('un código de vendedor que parece de Retool (AB12) no se parte por la fecha', () => {
  // El patrón de Retool, suelto, leería `AB12-20261013` como un folio «pegado».
  assert.equal(folioDeLaNota('P-AB12-20261013-000042;'), 'AB12-20261013-000042');
});

test('un folio del CRM que acaba en -000002 es SU número, no el sufijo de otro', () => {
  assert.equal(folioDeLaNota('P-A001-20261013-000002;'), 'A001-20261013-000002');
  const porFolio = facturasPorFolio([
    { operNumber: '1', nota: 'P-A001-20261013-000001; V-ANA;' },
    { operNumber: '2', nota: 'P-A001-20261013-000002; V-ANA;' },
  ]);
  assert.deepEqual([...porFolio.get('A001-20261013-000001')!], ['1']);
  assert.deepEqual([...porFolio.get('A001-20261013-000002')!], ['2']);
  assert.equal(porFolio.size, 2);
});

test('un folio del CRM con un sufijo pegado está mal copiado: no empareja con nada', () => {
  // Los pedidos del CRM no llevan sufijo. Quitarlo para que case es el error de julio.
  assert.equal(folioDeLaNota('P-A001-20261013-000042-1;'), null);
  assert.equal(folioDeLaNota('P-A001-20261013-0000421;'), null);
});

test('RETOOL Y EL CRM A LA VEZ: cada nota casa con SU pedido, sufijo incluido', () => {
  const porFolio = facturasPorFolio([
    { operNumber: '100', nota: 'P-PDG26-261013-2992; V-DIANGO GOLA; C-LH15;' },
    { operNumber: '101', nota: 'P-PDG26-261013-2992-1; V-DIANGO GOLA; C-LH16;' },
    { operNumber: '102', nota: 'P-PAH25-2609111134; V-ALFREDO HERNANDEZ OLIVA;' },
    { operNumber: '103', nota: 'P-A001-20261013-000042; V-ANA PEREZ; C-LH15;' },
  ]);
  assert.deepEqual([...porFolio.get('PDG26-261013-2992')!], ['100']);
  assert.deepEqual([...porFolio.get('PDG26-261013-2992-1')!], ['101']);
  assert.deepEqual([...porFolio.get('PAH25-2609111134')!], ['102']);
  assert.deepEqual([...porFolio.get('A001-20261013-000042')!], ['103']);
});

test('el prefijo del carril rápido: vendedor y día del CRM; los de Retool, igual que antes', () => {
  assert.equal(prefijoDeFolio('P-A001-20261013-000042'), 'P-A001-20261013');
  assert.equal(prefijoDeNota('A001-20261013-000042'), 'P-A001-20261013');
  assert.equal(prefijoDeNota('PDG26-260907-2988'), 'P-PDG26-260907');
  // Un pegado de Retool sigue sin prefijo (cae al camino por fechas, como antes).
  assert.equal(prefijoDeNota('PAH25-26091112'), null);
});
