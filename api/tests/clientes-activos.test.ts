import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decidirActivos, type ClienteBase, type FilaDeParranda } from '../src/lib/clientesActivos';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const S = 'STG';
const cli = (id: string, nombre: string, codigo: string | null, activo = true): ClienteBase => ({ id, nombre, sucursalId: S, codigo, activo });
const fila = (nombre: string, codigo: string | null): FilaDeParranda => ({ sucursalId: S, nombre, codigo });
// Relleno para pasar el mínimo de filas por sucursal sin ensuciar cada caso.
const relleno = (n: number) => Array.from({ length: n }, (_, i) => ({ c: cli(`r${i}`, `RELLENO ${i}`, `C${i}`), f: fila(`Relleno ${i}`, `C${i}`) }));

test('EL CASO DE DAGMARIS: Parranda renombra a «V3» conservando el código; la ficha vieja queda inactiva y el código pasa a la viva', () => {
  const r = relleno(60);
  const d = decidirActivos(
    [...r.map((x) => x.c), cli('vieja', 'DAGMARIS ZAMBRANA MATOS', 'SC06TCP0169'), cli('viva', 'DAGMARIS ZAMBRANA MATOS V3', null)],
    [...r.map((x) => x.f), fila('Dagmaris Zambrana Matos V3', 'SC06TCP0169')],
    norm,
  );

  assert.deepEqual(d.desactivar, ['vieja']);
  assert.deepEqual(d.codigosMovidos, [{ de: 'vieja', para: 'viva', codigo: 'SC06TCP0169' }]);
});

test('un cliente con código que Parranda ya no manda se desactiva', () => {
  const r = relleno(60);
  const d = decidirActivos([...r.map((x) => x.c), cli('x', 'CLIENTE VIEJO', 'SC01TCP0001')], r.map((x) => x.f), norm);

  assert.deepEqual(d.desactivar, ['x']);
});

test('uno que Parranda renombró SIN que nadie creara otra ficha sigue activo (casa por código)', () => {
  const r = relleno(60);
  const d = decidirActivos([...r.map((x) => x.c), cli('a', 'NOMBRE VIEJO', 'SC01TCP0002')], [...r.map((x) => x.f), fila('Nombre Nuevo', 'SC01TCP0002')], norm);

  assert.deepEqual(d.desactivar, []);
});

test('el cliente nacido de un pedido, sin código, nunca se desactiva', () => {
  const r = relleno(60);
  const d = decidirActivos([...r.map((x) => x.c), cli('p', 'SOLO DE PEDIDOS', null)], r.map((x) => x.f), norm);

  assert.deepEqual(d.desactivar, []);
});

test('un inactivo que reaparece en Parranda se reactiva', () => {
  const r = relleno(60);
  const d = decidirActivos([...r.map((x) => x.c), cli('v', 'VUELVE', 'SC01TCP0003', false)], [...r.map((x) => x.f), fila('Vuelve', 'SC01TCP0003')], norm);

  assert.deepEqual(d.reactivar, ['v']);
});

test('una sucursal que Parranda no manda (Palma, Granma, Moa) no se toca', () => {
  const r = relleno(60);
  const otra: ClienteBase = { id: 'pls', nombre: 'DE PALMA', sucursalId: 'PLS', codigo: 'PS01TCP0001', activo: true };
  const d = decidirActivos([...r.map((x) => x.c), otra], r.map((x) => x.f), norm);

  assert.deepEqual(d.desactivar, []);
});

test('si faltan demasiados se sospecha de Parranda y no se desactiva a nadie', () => {
  const r = relleno(60);
  const muchos = Array.from({ length: 50 }, (_, i) => cli(`m${i}`, `AUSENTE ${i}`, `Z${i}`));
  const d = decidirActivos([...r.map((x) => x.c), ...muchos], r.map((x) => x.f), norm);

  assert.deepEqual(d.desactivar, []);
  assert.equal(d.avisos.length, 1);
});

test('con muy pocas filas de una sucursal no se desactiva a nadie', () => {
  const d = decidirActivos([cli('a', 'A', 'C1'), cli('b', 'B', 'C2')], [fila('A', 'C1')], norm);

  assert.deepEqual(d.desactivar, []);
});

test('no vuelve a desactivar al que ya está inactivo', () => {
  const r = relleno(60);
  const d = decidirActivos([...r.map((x) => x.c), cli('x', 'YA INACTIVO', 'SC01TCP0009', false)], r.map((x) => x.f), norm);

  assert.deepEqual(d.desactivar, []);
});

test('dos clientes de Parranda con el mismo nombre y distinto código: cada fila reclama al dueño de su código', () => {
  const r = relleno(60);
  // «Los Hermanos» existe dos veces en Parranda (0289 y 0290). Una ficha lleva el nombre y el
  // 0289; el 0290 lo tiene otra ficha con otro nombre, que estaba inactiva.
  const nombre = cli('los-hermanos', 'LOS HERMANOS', 'LT0289');
  const otra = cli('andy', 'ANDY NAVARRO GONZALEZ', 'LT0290', false);
  const d = decidirActivos(
    [...r.map((x) => x.c), nombre, otra],
    [...r.map((x) => x.f), fila('Los Hermanos', 'LT0289'), fila('Los Hermanos', 'LT0290')],
    norm,
  );

  assert.deepEqual(d.desactivar, []);
  assert.deepEqual(d.reactivar, ['andy']);
  assert.deepEqual(d.codigosMovidos, []);
});

test('la ficha viva con un código caducado recibe el que Parranda le pone hoy (caso J8 Raúl Creach)', () => {
  const r = relleno(60);
  // Parranda manda «J8 Raúl Creach» con el 2127, que tiene una ficha vieja sin uso. La ficha
  // viva lleva el 2195, que ya no viene: es el código caducado, no otro cliente.
  const vieja = cli('vieja', 'RAUL CREACH', 'SC2127');
  const viva = cli('viva', 'J8 RAUL CREACH', 'SC2195');
  const d = decidirActivos([...r.map((x) => x.c), vieja, viva], [...r.map((x) => x.f), fila('J8 Raúl Creach', 'SC2127')], (s) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, ''));

  assert.deepEqual(d.desactivar, ['vieja']);
  assert.deepEqual(d.codigosMovidos, [{ de: 'vieja', para: 'viva', codigo: 'SC2127' }]);
});

test('mismo nombre y un código que nadie tiene: Parranda lo recodificó, no se desactiva', () => {
  const r = relleno(60);
  const d = decidirActivos([...r.map((x) => x.c), cli('a', 'PEPE', 'C-VIEJO')], [...r.map((x) => x.f), fila('Pepe', 'C-NUEVO')], norm);

  assert.deepEqual(d.desactivar, []);
});

test('una ficha con un pedido reciente no se desactiva por no venir en Parranda', () => {
  const r = relleno(60);
  const enUso = cli('uso', 'LO SIGUEN PIDIENDO', 'SC0001');
  const sinUso = cli('sinuso', 'NADIE LO PIDE', 'SC0002');
  const d = decidirActivos([...r.map((x) => x.c), enUso, sinUso], r.map((x) => x.f), norm, new Set(['uso']));

  assert.deepEqual(d.desactivar, ['sinuso']);
});

test('la ficha vieja de un renombre se desactiva aunque tenga pedidos recientes (el pedido va a la viva)', () => {
  const r = relleno(60);
  // Caso Dagmaris: la vieja lleva el código, la viva lleva el nombre nuevo y no tiene código.
  const vieja = cli('vieja', 'DAGMARIS ZAMBRANA MATOS', 'SC06TCP0169');
  const viva = cli('viva', 'DAGMARIS ZAMBRANA MATOS V3', null);
  const d = decidirActivos([...r.map((x) => x.c), vieja, viva], [...r.map((x) => x.f), fila('Dagmaris Zambrana Matos V3', 'SC06TCP0169')], norm, new Set(['vieja']));

  assert.deepEqual(d.desactivar, ['vieja']);
  assert.deepEqual(d.codigosMovidos, [{ de: 'vieja', para: 'viva', codigo: 'SC06TCP0169' }]);
});

test('un inactivo con pedido reciente y sin sucesora vuelve a activo; con sucesora no', () => {
  const r = relleno(60);
  const enUso = cli('uso', 'LO PIDEN', 'SC0001', false);
  const conSucesora = { ...cli('vieja', 'FICHA VIEJA', 'SC0002', false), sucesorId: 'viva' };
  const d = decidirActivos([...r.map((x) => x.c), enUso, conSucesora], r.map((x) => x.f), norm, new Set(['uso', 'vieja']));

  assert.deepEqual(d.reactivar, ['uso']);
});
