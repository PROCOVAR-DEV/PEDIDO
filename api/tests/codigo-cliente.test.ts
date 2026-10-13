import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codigoDeCliente } from '../src/lib/codigoCliente';

test('el código de Parranda de la fila entra (antes se tiraba)', () => {
  assert.equal(codigoDeCliente('CM01TCP0397'), 'CM01TCP0397');
  assert.equal(codigoDeCliente(' ho09otr0239 '), 'HO09OTR0239');
  assert.equal(codigoDeCliente('GR05TCP0013'), 'GR05TCP0013');
});

test('el duplicado que Parranda marca con -DUP-n entra, porque el sync también lo guarda', () => {
  assert.equal(codigoDeCliente('SC08TCP0007-DUP-1'), 'SC08TCP0007-DUP-1');
});

test('el numérico de los archivos viejos sigue entrando', () => {
  assert.equal(codigoDeCliente('18572'), '18572');
});

test('«NO CREADO», vacíos y basura no son un código', () => {
  for (const x of ['NO CREADO', '', '   ', null, undefined, 'CM01TCP039', 'CM01TCP0397X', 'XX', 'cliente nuevo']) {
    assert.equal(codigoDeCliente(x), null, String(x));
  }
});
