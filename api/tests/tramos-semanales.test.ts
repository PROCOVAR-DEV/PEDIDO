import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tramosSemanales } from '../src/lib/tramosSemanales';

const dia = (d: string) => new Date(`${d}T00:00:00Z`);

test('un mes se parte en semanas seguidas, sin huecos ni solapes', () => {
  const t = [...tramosSemanales(dia('2026-10-01'), new Date('2026-10-26T13:00:00Z'))];

  assert.equal(t.length, 4);
  assert.equal(t[0][0].toISOString(), '2026-10-01T00:00:00.000Z');
  for (let i = 1; i < t.length; i++) assert.equal(t[i][0].getTime(), t[i - 1][1].getTime() + 1);
  assert.equal(t[3][1].toISOString(), '2026-10-26T13:00:00.000Z');
});

test('el último tramo acaba en `hasta`, no después', () => {
  const t = [...tramosSemanales(dia('2026-10-01'), dia('2026-10-03'))];

  assert.equal(t.length, 1);
  assert.equal(t[0][1].toISOString(), '2026-10-03T00:00:00.000Z');
});

test('si desde es posterior a hasta no sale nada', () => {
  assert.equal([...tramosSemanales(dia('2026-10-05'), dia('2026-10-01'))].length, 0);
});
