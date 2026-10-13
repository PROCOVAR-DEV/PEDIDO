/**
 * Un pedido del CRM dispara lo mismo que uno de Retool al entrar.
 *
 * La ingesta (`processBulkImport` → `avisarDeLaTanda`) avisa al reparto de cada pedido
 * tocado que `esParaElReparto`, con motivo `importacion` y accion `bulk`, y luego emite
 * el evento de clientes. Aquí se comprueba que el CRM llama a esas mismas funciones con
 * esos mismos datos, con dobles que apuntan las llamadas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dispararComoLaIngesta } from '../src/lib/pedidoDesdeCrm';
import { esParaElReparto } from '../src/lib/avisoAlReparto';

test('el CRM avisa al reparto y emite el evento de clientes como la ingesta', () => {
  const avisos: unknown[] = [];
  const eventos: unknown[] = [];
  dispararComoLaIngesta(
    { id: 'p1', sucursalId: 'cam' },
    (c) => void avisos.push(c),
    (tipo, opts) => void eventos.push([tipo, opts]),
  );

  // Lo que `avisarDeLaTanda` manda por cada pedido suyo, menos `esDelReparto`: aquí la
  // misma regla la aplica `avisarAlReparto` leyendo el pedido de la base.
  assert.deepEqual(avisos, [{ id: 'p1', sucursalId: 'cam', motivo: 'importacion', accion: 'bulk' }]);
  assert.deepEqual(eventos, [['cliente', { sucursalId: 'cam', accion: 'bulk' }]]);
});

test('sin sucursal tampoco se inventa una', () => {
  const avisos: any[] = [];
  const eventos: any[] = [];
  dispararComoLaIngesta({ id: 'p2', sucursalId: null }, (c) => void avisos.push(c), (t, o) => void eventos.push(o));
  assert.equal(avisos[0].sucursalId, null);
  assert.equal(eventos[0].sucursalId, null);
});

test('la regla del reparto trata igual un pedido nuevo del CRM y uno de Retool', () => {
  // Recién creados, ninguno de los dos tiene factura: ninguno le toca todavía al reparto.
  const retool = { requiere_domicilio: true, facturaDomicilio: null, facturaNumero: null, facturaEstado: null };
  const crm = { ...retool };
  assert.equal(esParaElReparto(crm), esParaElReparto(retool));
  assert.equal(esParaElReparto(crm), false);
  // Con la factura del cotejo, los dos sí.
  assert.equal(esParaElReparto({ ...crm, facturaEstado: 'igual' }), true);
});
