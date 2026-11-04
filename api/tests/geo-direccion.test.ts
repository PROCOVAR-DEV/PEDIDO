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

describe('un vecino que está lejísimos del municipio no hace dudoso a quien sí está dentro', () => {
  // Doce clientes de Trinidad, juntos, para que el municipio tenga centro.
  const trinidad = Array.from({ length: 12 }, (_, i) => c(`t${i}`, `Calle Otra${i} 1`, 21.8088 + i * 0.0005, -79.9908, 'Trinidad', 'SS'));
  // «Desengaño»: una en Trinidad (la que tiene el punto bueno) y dos más con ese nombre en Sancti Spíritus ciudad.
  const desengano = (id: string, lat: number, lon: number) => c(id, 'Desengaño 5', lat, lon, 'Trinidad', 'SS');

  test('el cliente de Trinidad no se marca por culpa de dos «Desengaño» puestos en otra ciudad', () => {
    const r = evaluarClientes([...trinidad, desengano('buena', 21.8019, -79.9883), desengano('ss1', 21.9289, -79.4456), desengano('ss2', 21.9294, -79.4434)]).get('buena')!;

    assert.notEqual(r.estado, 'no_coincide');
    assert.notEqual(r.estado, 'revisar');
  });

  test('y los que sí están fuera de su municipio siguen marcándose', () => {
    const rs = evaluarClientes([...trinidad, desengano('buena', 21.8019, -79.9883), desengano('buena2', 21.8030, -79.9890), desengano('ss1', 21.9289, -79.4456)]);

    assert.equal(rs.get('ss1')!.estado === 'no_coincide' || rs.get('ss1')!.estado === 'revisar', true);
  });
});

describe('una calle que se repite en otro barrio no marca a quien tiene su localidad cerca', () => {
  // «Martí» en el centro de Guanabacoa (tres clientes juntos) y, a 11 km, un cliente de «Las Minas»
  // con otros dos clientes que nombran «Las Minas» a su lado.
  const centro = [0, 1, 2].map((i) => c(`m${i}`, `Martí e/ División y Versalles ${i}`, 23.1 + i * 0.0004, -82.30, 'Guanabacoa', 'HAB'));
  const minas = (id: string, lat: number) => c(id, 'Calle Real, Las Minas', lat, -82.20, 'Guanabacoa', 'HAB');

  test('«Martí» en Las Minas, con clientes de Las Minas cerca: coincide por la localidad', () => {
    const r = evaluarClientes([
      ...centro,
      c('ana', 'Calle Martí No.201 e/ Maceo y Máximo Gómez. Las Minas.', 23.1, -82.20, 'Guanabacoa', 'HAB'),
      minas('v1', 23.1005), minas('v2', 23.1010),
    ]).get('ana')!;

    assert.equal(r.estado, 'coincide');
    assert.equal(r.motivo, 'localidad');
  });

  test('sin clientes de su localidad cerca, sigue marcándose', () => {
    const r = evaluarClientes([
      ...centro,
      c('ana', 'Calle Martí No.201 e/ Maceo y Máximo Gómez. Las Minas.', 23.1, -82.20, 'Guanabacoa', 'HAB'),
    ]).get('ana')!;

    assert.notEqual(r.estado, 'coincide');
  });
});
