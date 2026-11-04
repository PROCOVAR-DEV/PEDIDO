import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ubicacionEsNuestra } from '../src/lib/ubicacionNuestra.ts';

test('lo que corrigió la APK o un supervisor es nuestro', () => {
  assert.equal(ubicacionEsNuestra({ geoFuente: 'apk' }), true);
  assert.equal(ubicacionEsNuestra({ geoFuente: 'usuario:maria.stg' }), true);
});

test('lo que un supervisor confirmó es nuestro aunque el punto venga de Parranda', () => {
  assert.equal(ubicacionEsNuestra({ geoFuente: 'parranda', geoEstado: 'confirmado' }), true);
  assert.equal(ubicacionEsNuestra({ geoFuente: null, geoEstado: 'confirmado' }), true);
});

test('lo que viene de Parranda, o no tiene origen, no lo es', () => {
  assert.equal(ubicacionEsNuestra({ geoFuente: 'parranda', geoEstado: 'revisar' }), false);
  assert.equal(ubicacionEsNuestra({ geoFuente: null, geoEstado: null }), false);
  assert.equal(ubicacionEsNuestra({}), false);
});
