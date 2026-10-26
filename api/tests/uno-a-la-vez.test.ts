import { test } from 'node:test';
import assert from 'node:assert/strict';

import { unoALaVez } from '../src/lib/unoALaVez';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('si el anterior no ha terminado, el siguiente disparo se salta y no se encola', async () => {
  let corridas = 0;
  const lanzar = unoALaVez(async () => {
    corridas++;
    await espera(30);

    return 'hecho';
  });

  const [a, b, c] = await Promise.all([lanzar(), lanzar(), lanzar()]);

  assert.equal(a, 'hecho');
  assert.equal(b, null);
  assert.equal(c, null);
  assert.equal(corridas, 1);
});

test('cuando termina, el siguiente disparo sí corre', async () => {
  const lanzar = unoALaVez(async () => 'ok');

  assert.equal(await lanzar(), 'ok');
  assert.equal(await lanzar(), 'ok');
});

test('si el trabajo falla, no se queda bloqueado para siempre', async () => {
  let n = 0;
  const lanzar = unoALaVez(async () => {
    if (n++ === 0) throw new Error('boom');

    return 'ok';
  });

  await assert.rejects(lanzar(), /boom/);
  assert.equal(await lanzar(), 'ok');
});
