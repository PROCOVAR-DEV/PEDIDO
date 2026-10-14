/**
 * El aviso de vuelta al CRM (lib/avisoAlCrm.ts).
 *
 * Lo que se prueba es lo que decide SI se avisa y A DÓNDE: que sin las variables no haga
 * nada, y que sólo avise cuando cambia lo que le importa al CRM (factura, entrega, borrado),
 * no en cada edición del pedido.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { avisarAlCrm, configDelCrm, debeAvisar, huellaDe, DESTINO_CRM } from '../src/lib/avisoAlCrm';

const FOLIO = 'A001-20261014-000042';

test('sin CRM_WEBHOOK_URL y CRM_WEBHOOK_SECRET el destino del CRM está apagado', () => {
  for (const env of [{}, { CRM_WEBHOOK_URL: 'http://crm' }, { CRM_WEBHOOK_SECRET: 's' }, { CRM_WEBHOOK_URL: ' ', CRM_WEBHOOK_SECRET: ' ' }]) {
    const c = configDelCrm(DESTINO_CRM, env);
    assert.equal(c?.activo, false, JSON.stringify(env));
    // Sin URL, entregarWebhook no manda nada: no es un fallo, es que no aplica.
    assert.equal(c?.url, '');
  }
});

test('con las dos variables se manda, firmado con el secreto', () => {
  const c = configDelCrm(DESTINO_CRM, { CRM_WEBHOOK_URL: ' http://crm-sync:8081/api/v1/sync/pedido/estado ', CRM_WEBHOOK_SECRET: 'secreto' });
  assert.deepEqual(c, { url: 'http://crm-sync:8081/api/v1/sync/pedido/estado', key: '', secret: 'secreto', activo: true });
});

test('los destinos de siempre no se tocan: siguen saliendo de WebhookConfig', () => {
  const env = { CRM_WEBHOOK_URL: 'http://crm', CRM_WEBHOOK_SECRET: 's' };
  assert.equal(configDelCrm('reparto', env), null);
  assert.equal(configDelCrm('domicilio', env), null);
});

test('sólo avisa cuando cambia la factura, la entrega o si se borró', () => {
  const base = { folio: FOLIO, existe: true, facturaEstado: null, facturaNumero: null, estadoEntrega: null };
  const antes = JSON.stringify({ folio: FOLIO, huella: huellaDe(base) });

  // Otra edición (la dirección, el domicilio…): la huella es la misma, no hay aviso.
  assert.equal(debeAvisar(antes, huellaDe({ ...base, updatedAt: new Date() }), 'update'), false);
  assert.equal(debeAvisar(antes, huellaDe({ ...base, estado: 'completada' }), 'update'), false);

  assert.equal(debeAvisar(antes, huellaDe({ ...base, facturaEstado: 'igual', facturaNumero: '44830' }), 'update'), true);
  assert.equal(debeAvisar(antes, huellaDe({ ...base, estadoEntrega: 'entregado' }), 'update'), true);
  assert.equal(debeAvisar(antes, huellaDe({ folio: FOLIO, existe: false }), 'delete'), true);
});

test('al crearse no se avisa (lo acaba de mandar el CRM); sin huella previa, sí', () => {
  const h = huellaDe({ folio: FOLIO, existe: true });
  assert.equal(debeAvisar(null, h, 'create'), false);
  assert.equal(debeAvisar(null, h, 'update'), true);
  // Una huella ilegible no calla el aviso.
  assert.equal(debeAvisar('{roto', h, 'update'), true);
});

test('avisarAlCrm nunca lanza: ni apagado, ni encendido sin Redis, ni con otra entidad', () => {
  const antes = { ...process.env };
  try {
    delete process.env.CRM_WEBHOOK_URL;
    delete process.env.CRM_WEBHOOK_SECRET;
    assert.equal(avisarAlCrm('pedido', { id: 'x', accion: 'update' }), undefined);

    process.env.CRM_WEBHOOK_URL = 'http://crm';
    process.env.CRM_WEBHOOK_SECRET = 'secreto';
    assert.equal(avisarAlCrm('pedido', { id: 'x', accion: 'update' }), undefined);
    assert.equal(avisarAlCrm('pedido', {}), undefined);
    assert.equal(avisarAlCrm('cliente', { id: 'x' }), undefined);
  } finally {
    process.env = antes;
  }
});
