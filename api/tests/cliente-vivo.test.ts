import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fichaViva, type FichaConSucesora } from '../src/lib/clienteVivo';

const f = (id: string, activo: boolean, sucesorId: string | null = null): FichaConSucesora => ({ id, activo, sucesorId });
const buscadorDe = (fichas: FichaConSucesora[]) => async (id: string) => fichas.find((x) => x.id === id) ?? null;

test('una ficha activa se queda donde está', async () => {
  const a = f('a', true);
  const r = await fichaViva(a, buscadorDe([a]));

  assert.equal(r.ficha.id, 'a');
  assert.deepEqual(r.anteriores, []);
});

test('el nombre viejo de una ficha inactiva lleva el pedido a la sucesora viva', async () => {
  const vieja = f('vieja', false, 'viva');
  const viva = f('viva', true);
  const r = await fichaViva(vieja, buscadorDe([vieja, viva]));

  assert.equal(r.ficha.id, 'viva');
  assert.deepEqual(r.anteriores, ['vieja']);
});

test('sigue una cadena de dos saltos', async () => {
  const a = f('a', false, 'b');
  const b = f('b', false, 'c');
  const c = f('c', true);
  const r = await fichaViva(a, buscadorDe([a, b, c]));

  assert.equal(r.ficha.id, 'c');
  assert.deepEqual(r.anteriores, ['a', 'b']);
});

test('inactiva sin sucesora: se queda en ella, como antes', async () => {
  const a = f('a', false);
  const r = await fichaViva(a, buscadorDe([a]));

  assert.equal(r.ficha.id, 'a');
});

test('una sucesora que ya no existe no rompe la ingesta: se queda en la ficha del nombre', async () => {
  const a = f('a', false, 'borrada');
  const r = await fichaViva(a, buscadorDe([a]));

  assert.equal(r.ficha.id, 'a');
  assert.deepEqual(r.anteriores, []);
});

test('un ciclo no se queda dando vueltas', async () => {
  const a = f('a', false, 'b');
  const b = f('b', false, 'a');
  const r = await fichaViva(a, buscadorDe([a, b]));

  assert.ok(['a', 'b'].includes(r.ficha.id));
  assert.ok(r.anteriores.length <= 1);
});
