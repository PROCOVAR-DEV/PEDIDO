import { test } from 'node:test';
import assert from 'node:assert/strict';

import { indexarCatalogo } from '../src/lib/cruceProducto';
import { normalizarProducto } from '../src/lib/nombreProducto';

const cat = indexarCatalogo(
  [
    { nombre: 'PANEL SOLAR BIFACIAL JINKO 625 W', sku: 'TECN0032', precio: 170, pesoKg: 32, stock: 607 },
    { nombre: 'SERVILLETA AZANAR CAJA 60P', sku: 'HGHG0016', precio: 12, pesoKg: 3, stock: 50 },
    { nombre: 'ARROZ BLANCO 25 KG SACO', sku: 'ALAL0001', precio: 30, pesoKg: 25, stock: 10 },
  ],
  new Map(),
);

test('los vatios pegados («625W») se leen igual que «625 W»', () => {
  assert.equal(normalizarProducto('PANEL JINKO 625W'), normalizarProducto('PANEL JINKO 625 W'));
});

test('el panel Jinko cruza por nombre (625W) y por código', () => {
  assert.equal(cat.buscar('TECNOLOGIA PANEL SOLAR BIFACIAL JINKO 625W')?.sku, 'TECN0032');
  assert.equal(cat.buscar('NOMBRE QUE NO EXISTE', 'TECN0032')?.precio, 170);
});

test('la servilleta con la letra cambiada cruza por código aunque el nombre no cruce', () => {
  assert.equal(cat.buscar('HIGIENE-HOGAR SERVILLETA AZAHAR CAJA 60P'), undefined);
  assert.equal(cat.buscar('HIGIENE-HOGAR SERVILLETA AZAHAR CAJA 60P', 'HGHG0016')?.pesoKg, 3);
});

test('un código desconocido no inventa nada: cae al nombre, y si tampoco, undefined', () => {
  assert.equal(cat.buscar('ALIMENTOS ARROZ BLANCO 25KG SACO', 'XXXX9999')?.sku, 'ALAL0001');
  assert.equal(cat.buscar('COSA RARA', 'XXXX9999'), undefined);
});

test('el vínculo hecho a mano manda sobre el código', () => {
  const c = indexarCatalogo(
    [
      { nombre: 'ARROZ BLANCO 25 KG SACO', sku: 'A1', precio: 1, pesoKg: 25, stock: 1 },
      { nombre: 'ARROZ INTEGRAL 25 KG SACO', sku: 'A2', precio: 2, pesoKg: 25, stock: 1 },
    ],
    new Map([[normalizarProducto('ARROZ BLANCO 25 KG SACO'), normalizarProducto('ARROZ INTEGRAL 25 KG SACO')]]),
  );
  assert.equal(c.buscar('ARROZ BLANCO 25 KG SACO', 'A1')?.sku, 'A2');
});
