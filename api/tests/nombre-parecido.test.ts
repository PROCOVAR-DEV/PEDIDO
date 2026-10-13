import assert from 'node:assert/strict';
import { test } from 'node:test';

import { comparteNombre } from '../src/lib/nombreParecido';

test('la misma persona con la etiqueta de ruta o el tipo de más sí es el mismo nombre', () => {
  assert.ok(comparteNombre('RESTAURANTE SEDUCENTE RAMON', 'S7 RESTAURANTE SEDUCENTE RAMON'));
  assert.ok(comparteNombre('KIOSKO YELIANIS VIENS', 'KIOSKO YELIANIS VIENS S2'));
  assert.ok(comparteNombre('RICHARD (KIOSKO)', 'RICHARD MICHEL GONZALEZ ALEA.'));
  assert.ok(comparteNombre('KIOSCO MINI', 'KIOSCO ANA JULIA ( MINI) LA MAYA'));
  assert.ok(comparteNombre('MARITZA MUNOZ RODRIGUEZ', 'MARITZA MUNOŻ RODRIGUEZ'));
});

test('dos clientes distintos con un código mal puesto no comparten nombre', () => {
  assert.ok(!comparteNombre('PUNTO DE VENTA CARRETERA DEL VALLE JOSE ENRIQUE', 'CAFETERIA AMAURI'));
  assert.ok(!comparteNombre('CAFETERIA PEDRO', 'TCP JUAN'));
});

test('sólo tipo y etiqueta no es un nombre', () => {
  assert.ok(!comparteNombre('KIOSCO', 'CAFETERIA'));
  assert.ok(!comparteNombre('L7 KIOSKO', 'V8 TCP'));
});

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
