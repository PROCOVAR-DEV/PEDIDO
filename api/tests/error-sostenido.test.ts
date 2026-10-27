import { test } from 'node:test';
import assert from 'node:assert/strict';

import { conErrorDesde, soloErroresSostenidos, type UltimaPasada } from '../src/lib/cotejoEstado';

const suc = (sucursal: string, error?: string) => ({ sucursal, database: sucursal, cotejados: 1, igual: 0, cambiado: 0, sinFactura: 0, ...(error ? { error } : {}) });
const pasada = (cuando: string, ...s: ReturnType<typeof suc>[]): UltimaPasada => ({ cuando, segundos: 1, sucursales: s });

test('el primer fallo marca errorDesde = ahora; el siguiente lo conserva', () => {
  const a = conErrorDesde(null, pasada('2026-10-27T20:00:00Z', suc('CAM', 'fetch failed')));
  assert.equal(a.sucursales[0].errorDesde, '2026-10-27T20:00:00Z');
  const b = conErrorDesde(a, pasada('2026-10-27T20:03:00Z', suc('CAM', 'fetch failed')));
  assert.equal(b.sucursales[0].errorDesde, '2026-10-27T20:00:00Z');
});

test('si la sucursal respondió entre medias, el contador empieza de nuevo', () => {
  const a = conErrorDesde(null, pasada('2026-10-27T20:00:00Z', suc('CAM', 'x')));
  const ok = conErrorDesde(a, pasada('2026-10-27T20:01:00Z', suc('CAM')));
  const b = conErrorDesde(ok, pasada('2026-10-27T20:02:00Z', suc('CAM', 'x')));
  assert.equal(b.sucursales[0].errorDesde, '2026-10-27T20:02:00Z');
});

test('un fallo de hace segundos no se enseña; uno de ≥ 5 min sí', () => {
  const p = pasada('2026-10-27T20:06:00Z', { ...suc('CAM', 'x'), errorDesde: '2026-10-27T20:05:30Z' }, { ...suc('HAB', 'y'), errorDesde: '2026-10-27T20:00:00Z' });
  const r = soloErroresSostenidos(p, Date.parse('2026-10-27T20:06:00Z'))!;
  assert.equal(r.sucursales[0].error, undefined);
  assert.equal(r.sucursales[1].error, 'y');
});
