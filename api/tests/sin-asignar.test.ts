import assert from 'node:assert/strict';
import { test } from 'node:test';

import { esSinAsignar } from '../src/lib/gestores';

const base = { activo: true, sucursalId: 'TUN', gestorId: null, creadoPor: null };

test('llegó por un archivo (sin creador) y sin usuario enlazado: sin asignar, aunque ya tenga sucursal', () => {
  assert.equal(esSinAsignar(base), true);
});

test('sin sucursal siempre es sin asignar', () => {
  assert.equal(esSinAsignar({ ...base, sucursalId: null, creadoPor: 'maria' }), true);
});

test('el alta manual sin usuario, uno con usuario o uno dado de baja no lo son', () => {
  assert.equal(esSinAsignar({ ...base, creadoPor: 'maria' }), false);
  assert.equal(esSinAsignar({ ...base, gestorId: 'u1' }), false);
  assert.equal(esSinAsignar({ ...base, activo: false }), false);
});
