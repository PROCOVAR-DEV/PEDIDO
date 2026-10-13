/**
 * Atar cada factura a UN pedido, por el folio de su nota.
 *
 * Esto salió de un fallo real y caro. Se emparejaba por NOMBRE DE CLIENTE, y con eso no
 * se puede: CAFETERIA POLO pidió el 30 y el 31 de agosto, y la factura 1024237 acabó
 * pegada a los DOS pedidos —uno completado y otro en proceso—. Ninguno de los dos decía
 * la verdad, y el que estaba mal parecía correcto.
 *
 * La regla es simple y no admite excepciones: una factura nombra un folio, y va a ese
 * pedido. Si no nombra ninguno, no va a ninguna parte.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { facturasPorFolio, folioDeLaNota } from '../src/lib/emparejarFactura.ts'

test('LA NOTA REAL de Ventra: se lee el folio de la etiqueta P-', () => {
  // Tal cual llega en producción, con sus tres partes etiquetadas.
  assert.equal(
    folioDeLaNota('P-PXC25-260831-1337; V-XENIA CORDIEZ MORASEN; C-LH15TCP0295;'),
    'PXC25-260831-1337',
  )
  // Y el código del cliente que va detrás no se confunde con el folio.
  assert.notEqual(folioDeLaNota('P-PXC25-260831-1337; C-LH15TCP0295;'), 'LH15TCP0295')
})

test('las ventas de mostrador no tienen pedido: no emparejan con nada', () => {
  // Son un tercio de las líneas y es correcto que no aten a ningún pedido.
  assert.equal(folioDeLaNota('VENTA ALMACEN'), null)
  assert.equal(folioDeLaNota('V-RAYDEL MESA GUTIERREZ;'), null)
})

test('el folio se saca de la nota, venga solo o con texto alrededor', () => {
  assert.equal(folioDeLaNota('PMH25-260901-1001'), 'PMH25-260901-1001')
  assert.equal(folioDeLaNota('pedido PLB25-260831-1585 entregado'), 'PLB25-260831-1585')
  // Con el sufijo que añade la importación cuando dos clientes comparten folio.
  assert.equal(folioDeLaNota('PGD26-260831-2531-1'), 'PGD26-260831-2531-1')
})

test('EL FOLIO PEGADO de Alfredo: fecha y número sin guion en medio', () => {
  // Caso real de producción. La factura 18201 lleva este folio en su nota y se quedaba
  // sin emparejar porque el patrón exigía un guion que este folio no tiene.
  assert.equal(
    folioDeLaNota('P-PAH25-2609111134; V-ALFREDO HERNANDEZ OLIVA; C-CM11TCP0034;'),
    'PAH25-2609111134',
  )
  // Con el sufijo de cliente repetido, que también los tiene.
  assert.equal(folioDeLaNota('P-PAH25-2609101131-9;'), 'PAH25-2609101131-9')
  assert.equal(folioDeLaNota('PAH25-2609101131'), 'PAH25-2609101131')
})

test('aceptar el folio pegado NO rompe el sufijo de dos clientes', () => {
  // `-1828` es el número del pedido y `-1` el sufijo del segundo cliente. Son DOS
  // pedidos distintos y el sufijo no se puede perder por el camino.
  assert.equal(folioDeLaNota('P-PAA26-260907-1828;'), 'PAA26-260907-1828')
  assert.equal(folioDeLaNota('P-PAA26-260907-1828-1;'), 'PAA26-260907-1828-1')
  assert.notEqual(folioDeLaNota('P-PAA26-260907-1828-1;'), 'PAA26-260907-1828')
})

test('una nota sin folio no empareja nada', () => {
  assert.equal(folioDeLaNota('recoger en el almacén'), null)
  assert.equal(folioDeLaNota(''), null)
  assert.equal(folioDeLaNota(null), null)
})

test('cada factura va a UN folio, y una factura no se reparte', () => {
  const mapa = facturasPorFolio([
    { operNumber: '1024237', nota: 'PLB25-260831-1585' },
    // La misma factura tiene una línea por producto: el folio sale igual.
    { operNumber: '1024237', nota: 'PLB25-260831-1585' },
    { operNumber: '1024240', nota: 'PLB25-260830-1576' },
  ])

  assert.deepEqual([...(mapa.get('PLB25-260831-1585') ?? [])], ['1024237'])
  assert.deepEqual([...(mapa.get('PLB25-260830-1576') ?? [])], ['1024240'])
})

test('EL FALLO DE VERDAD: la factura del 31 no toca el pedido del 30', () => {
  /**
   * Es el caso exacto que se rompió. Dos pedidos del mismo cliente, días seguidos, la
   * misma mercancía. Por nombre de cliente los dos parecían dueños de la misma factura.
   */
  const mapa = facturasPorFolio([{ operNumber: '1024237', nota: 'PLB25-260831-1585' }])

  assert.deepEqual([...(mapa.get('PLB25-260831-1585') ?? [])], ['1024237'])
  assert.equal(mapa.get('PLB25-260830-1576'), undefined, 'el del 30 no puede quedarse esa factura')
})

test('un pedido facturado en DOS documentos se queda con los dos', () => {
  // Esto sí pasa y es legítimo: se factura en dos partes. Lo contrario —una factura
  // repartida entre dos pedidos— es lo que no puede ocurrir.
  const mapa = facturasPorFolio([
    { operNumber: '1024202', nota: 'PRM25-260831-1797' },
    { operNumber: '1024269', nota: 'PRM25-260831-1797' },
  ])

  assert.deepEqual([...(mapa.get('PRM25-260831-1797') ?? [])].sort(), ['1024202', '1024269'])
})

test('las facturas sin nota se quedan fuera, no se reparten a ojo', () => {
  const mapa = facturasPorFolio([
    { operNumber: '99', nota: null },
    { operNumber: '98', nota: 'venta de mostrador' },
  ])

  assert.equal(mapa.size, 0)
})

// ------------------------------------------------------------------ el folio del CRM
//
// Desde el 13/10/2026 los pedidos llegan del CRM con SU folio (`A001-20261013-000042`),
// que es el que el operador copia en la nota. Los de Retool que ya hay siguen casando.

test('EL FOLIO DEL CRM se lee de la nota, con etiqueta o suelto', () => {
  assert.equal(folioDeLaNota('P-A001-20261013-000042; V-ANA PEREZ; C-LH15TCP0295;'), 'A001-20261013-000042')
  assert.equal(folioDeLaNota('pedido a7p1-20260903-000042 entregado'), 'A7P1-20260903-000042')
})

test('un código de vendedor que parece de Retool (AB12) no se parte por la fecha', () => {
  // El patrón de Retool, suelto, leería `AB12-20261013` como un folio «pegado».
  assert.equal(folioDeLaNota('P-AB12-20261013-000042;'), 'AB12-20261013-000042')
  assert.notEqual(folioDeLaNota('P-AB12-20261013-000042;'), 'AB12-20261013')
})

test('un folio del CRM que acaba en -000002 es SU número, no el sufijo de otro', () => {
  assert.equal(folioDeLaNota('P-A001-20261013-000002;'), 'A001-20261013-000002')
  const porFolio = facturasPorFolio([
    { operNumber: '1', nota: 'P-A001-20261013-000001; V-ANA;' },
    { operNumber: '2', nota: 'P-A001-20261013-000002; V-ANA;' },
  ])
  assert.deepEqual([...porFolio.get('A001-20261013-000001')!], ['1'])
  assert.deepEqual([...porFolio.get('A001-20261013-000002')!], ['2'])
  assert.equal(porFolio.size, 2)
})

test('un folio del CRM con un sufijo pegado está mal copiado: no empareja con nada', () => {
  // Los pedidos del CRM no llevan sufijo. Quitarlo para que case es el error de julio.
  assert.equal(folioDeLaNota('P-A001-20261013-000042-1;'), null)
  assert.equal(folioDeLaNota('P-A001-20261013-0000421;'), null)
})

test('los folios de Retool siguen como estaban, sufijo incluido', () => {
  assert.equal(folioDeLaNota('P-PDG26-260906-2992;'), 'PDG26-260906-2992')
  assert.equal(folioDeLaNota('P-PDG26-260906-2992-2;'), 'PDG26-260906-2992-2')
  assert.equal(folioDeLaNota('P-PAH25-2609111134;'), 'PAH25-2609111134')
})
