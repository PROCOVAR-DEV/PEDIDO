import assert from 'node:assert/strict';
import { test } from 'node:test';

import { esElMismoCliente, unicaFichaParecida } from '../src/lib/nombreParecido';

test('para fusionar hacen falta dos palabras con significado: un apellido compartido no basta', () => {
  assert.ok(esElMismoCliente('KIOSCO DAMARIS DAUNIS (MELLA)', 'KIOSCO DAGMARIS DAUNIS (MELLA)'));
  assert.ok(esElMismoCliente('JOAQUIN AREAS MEJIAS', 'CAFETERIA(JOAQUIN AREAS MEJIAS )'));
  assert.ok(esElMismoCliente('KIOSKO MAYRA URGELLES', 'KIOSKO MAYRA'));
  assert.ok(!esElMismoCliente('KIOSKO ALBERTO FABRE', 'KIOSKO GARCES FABRE'));
  assert.ok(!esElMismoCliente('CAFETERIA PEDRO', 'TCP JUAN'));
});

test('el cliente creado sin conexión se reconoce sólo si hay UNA ficha parecida', () => {
  const sinCodigo = [{ id: 'a', nombre: 'JOAQUIN AREAS MEJIAS' }, { id: 'b', nombre: 'PEPE LOPEZ RUIZ' }];

  assert.equal(unicaFichaParecida('CAFETERIA(JOAQUIN AREAS MEJIAS )', sinCodigo)?.id, 'a');
  assert.equal(unicaFichaParecida('OTRO CLIENTE DISTINTO', sinCodigo), null);
  // dos fichas parecidas: ambiguo, se crea una nueva
  assert.equal(unicaFichaParecida('JOAQUIN AREAS MEJIAS', [...sinCodigo, { id: 'c', nombre: 'KIOSKO JOAQUIN AREAS' }]), null);
});
