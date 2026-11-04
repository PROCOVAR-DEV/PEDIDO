import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { palabrasDeCalle, mismaCalle, distanciaKm, evaluarClientes, type ClienteGeo } from '../src/lib/geoDireccion.ts';

const c = (id: string, direccion: string, latitud: number, longitud: number, municipio = 'Camagüey', sucursalId = 'CAM'): ClienteGeo => ({
  id, sucursalId, municipio, direccion, latitud, longitud,
});

describe('la calle de una dirección escrita a mano', () => {
  test('se queda con la calle y tira el número, el «entre» y las palabras de relleno', () => {
    assert.deepEqual(palabrasDeCalle('Comandante Chapliau #131/Milla y Lastre'), ['comandante', 'chapliau']);
    assert.deepEqual(palabrasDeCalle('Calle Maceo #131 entre Milla y Lastre'), ['maceo']);
    assert.deepEqual(palabrasDeCalle('Antonio Maceo 45, Camagüey'), ['antonio', 'maceo']);
    assert.deepEqual(palabrasDeCalle('Ave. de Céspedes e/ 1ra y 2da'), ['cespedes']);
  });

  test('sin calle reconocible da null', () => {
    assert.equal(palabrasDeCalle(''), null);
    assert.equal(palabrasDeCalle(null), null);
    assert.equal(palabrasDeCalle('# 12'), null);
  });
});

describe('¿son la misma calle?', () => {
  test('«Maceo», «Calle Maceo» y «Antonio Maceo» sí', () => {
    assert.equal(mismaCalle(['maceo'], ['antonio', 'maceo']), true);
    assert.equal(mismaCalle(palabrasDeCalle('Calle Maceo 1')!, palabrasDeCalle('Antonio Maceo 9')!), true);
  });

  test('otra calle no, y una palabra corta suelta tampoco', () => {
    assert.equal(mismaCalle(['maceo'], ['gomez']), false);
    assert.equal(mismaCalle(['sol'], ['sol', 'naciente']), false);
  });
});

describe('evaluar el punto contra la calle', () => {
  // Cuatro clientes de la misma calle, juntos (a ~100 m unos de otros).
  const calle = [
    c('a', 'Calle Maceo 10', 21.3800, -77.9100),
    c('b', 'Maceo 22', 21.3805, -77.9105),
    c('d', 'Antonio Maceo 40', 21.3810, -77.9110),
  ];

  test('cerca de otro cliente de su calle: coincide, y dice con quién se comparó', () => {
    const r = evaluarClientes([...calle, c('x', 'Calle Maceo 31', 21.3802, -77.9102)]).get('x')!;

    assert.equal(r.estado, 'coincide');
    assert.equal(r.motivo, 'calle');
    assert.ok(r.vecinoId && ['a', 'b', 'd'].includes(r.vecinoId));
    assert.ok(r.distanciaKm! < 0.5);
  });

  test('a unos kilómetros de su calle: no coincide', () => {
    const r = evaluarClientes([...calle, c('x', 'Calle Maceo 31', 21.4300, -77.9100)]).get('x')!;

    assert.equal(r.estado, 'no_coincide');
    assert.ok(r.distanciaKm! >= 2);
  });

  test('entre 500 m y 2 km: revisar', () => {
    const r = evaluarClientes([...calle, c('x', 'Calle Maceo 31', 21.3900, -77.9100)]).get('x')!;

    assert.equal(r.estado, 'revisar');
  });

  test('una calle con menos de 3 clientes no se juzga', () => {
    const r = evaluarClientes([calle[0], c('x', 'Calle Maceo 31', 21.5, -77.9)]).get('x')!;

    assert.equal(r.estado, 'sin_referencia');
    assert.equal(r.distanciaKm, null);
  });

  test('no se compara con clientes de otro municipio ni de otra sucursal', () => {
    const otros = calle.map((x) => ({ ...x, municipio: 'Nuevitas' }));
    const r = evaluarClientes([...otros, c('x', 'Calle Maceo 31', 21.5, -77.9)]).get('x')!;

    assert.equal(r.estado, 'sin_referencia');
  });

  test('una calle sin referencia pero muy lejos del centro de su municipio se marca para revisar', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => c(`m${i}`, `Calle Otra${i} 1`, 21.38 + i * 0.0005, -77.91));
    const r = evaluarClientes([...muchos, c('lejos', 'Calle Única 5', 22.5, -77.9)]).get('lejos')!;

    assert.equal(r.estado, 'revisar');
    assert.equal(r.motivo, 'lejos_del_municipio');
  });
});

test('distancia: 1 km de latitud son ~1 km', () => {
  const d = distanciaKm({ latitud: 21, longitud: -77 }, { latitud: 21.009, longitud: -77 });

  assert.ok(d > 0.99 && d < 1.01);
});
