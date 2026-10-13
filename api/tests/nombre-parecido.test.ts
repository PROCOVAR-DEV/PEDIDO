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
