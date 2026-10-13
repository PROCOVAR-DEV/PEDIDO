import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codigoDeCliente } from '../src/lib/codigoCliente';

test('el código de Parranda de la fila entra (antes se tiraba)', () => {
  assert.equal(codigoDeCliente('CM01TCP0397'), 'CM01TCP0397');
  assert.equal(codigoDeCliente(' ho09otr0239 '), 'HO09OTR0239');
  assert.equal(codigoDeCliente('GR05TCP0013'), 'GR05TCP0013');
});

test('lo que Parranda pone sin conexión (client1, uuid) y los -DUP-n NO entran', () => {
  for (const x of ['client1', 'client2', 'Client10', '0190a5e2-7c3b-7d4e-9a1f-3b6c8d9e0f12', 'SC08TCP0007-DUP-1']) {
    assert.equal(codigoDeCliente(x), null, x);
  }
});

test('el numérico de los archivos viejos sigue entrando', () => {
  assert.equal(codigoDeCliente('18572'), '18572');
});

test('«NO CREADO», vacíos y basura no son un código', () => {
  for (const x of ['NO CREADO', '', '   ', null, undefined, 'CM01TCP039', 'CM01TCP0397X', 'XX', 'cliente nuevo']) {
    assert.equal(codigoDeCliente(x), null, String(x));
  }
});
