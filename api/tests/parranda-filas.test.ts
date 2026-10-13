import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filasGanadoras } from '../src/lib/parrandaFilas';

type Fila = { nombre: string; codigo: string | null };
type Ficha = { id: string; codigo: string | null };

const fichas: Record<string, Ficha> = {
  hansel: { id: 'hansel', codigo: 'B' },
  tatiana: { id: 'tatiana', codigo: 'X' },
  nuevo: { id: 'nuevo', codigo: null },
};
const porNombre = (f: Fila) => fichas[f.nombre];

test('una fila por ficha: todas son ganadoras', () => {
  const filas: Fila[] = [{ nombre: 'hansel', codigo: 'B' }, { nombre: 'tatiana', codigo: 'X' }];

  assert.deepEqual([...filasGanadoras(filas, porNombre)], [0, 1]);
});

test('dos filas con el mismo nombre y distinto código: gana la que ya lleva el código de la ficha, aunque no sea la última', () => {
  const filas: Fila[] = [{ nombre: 'hansel', codigo: 'B' }, { nombre: 'hansel', codigo: 'A' }];

  assert.deepEqual([...filasGanadoras(filas, porNombre)], [0]);
  // Y es estable: con el orden cambiado sigue ganando la misma fila.
  assert.deepEqual([...filasGanadoras([...filas].reverse(), porNombre)], [1]);
});

test('el mismo código con la dirección escrita de dos maneras: gana la última de las que llevan su código', () => {
  const filas: Fila[] = [{ nombre: 'tatiana', codigo: 'X' }, { nombre: 'tatiana', codigo: 'X' }, { nombre: 'tatiana', codigo: 'Y' }];

  assert.deepEqual([...filasGanadoras(filas, porNombre)], [1]);
});

test('una ficha sin código recibe la última fila', () => {
  const filas: Fila[] = [{ nombre: 'nuevo', codigo: 'P' }, { nombre: 'nuevo', codigo: 'Q' }];

  assert.deepEqual([...filasGanadoras(filas, porNombre)], [1]);
});

test('una fila sin ficha no gana nada', () => {
  const filas: Fila[] = [{ nombre: 'nadie', codigo: 'Z' }];

  assert.deepEqual([...filasGanadoras(filas, porNombre)], []);
});
