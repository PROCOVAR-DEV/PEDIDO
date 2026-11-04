import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { comprobar, viaEscrita, hayQueUbicarLaDireccion } from '../src/lib/geoComprobacion.ts';

const cl = (direccion: string | null, municipio: string | null = 'Guanabacoa', latitud = 23.1, longitud = -82.3) => ({ direccion, municipio, latitud, longitud });
const punto = (calle: string | null, municipios: string[] = ['Guanabacoa'], barrio: string | null = null) => ({ calle, barrio, municipios });

describe('la vía que escribió quien tomó la dirección', () => {
  test('lo que va antes del número, del «entre» o de la coma', () => {
    assert.deepEqual(viaEscrita('Calle Martí  No.201 e/ Maceo y Máximo Gómez. Las Minas.'), ['marti']);
    assert.deepEqual(viaEscrita('9 norte / 4 y 5 oeste'), ['9', 'norte']);
    assert.deepEqual(viaEscrita('camino de la Habana # 17'), ['habana']);
    assert.deepEqual(viaEscrita('Calle 17 #51 / 10y12 el llano'), ['17']);
    assert.deepEqual(viaEscrita('frente al cuerpo de guardia'), []);
  });
});

describe('punto → dirección', () => {
  test('la calle que hay en el punto es la escrita: coincide (ANA & EMA)', () => {
    assert.equal(comprobar(cl('Calle Martí No.201 e/ Maceo y Máximo Gómez. Las Minas.'), punto('Martí')).estado, 'coincide');
    assert.equal(comprobar(cl('9 norte / 4 y 5 oeste'), punto('9 Norte')).estado, 'coincide');
    assert.equal(comprobar(cl('camino de la Habana # 17'), punto('Camino de la Habana')).estado, 'coincide');
  });

  test('el punto cae en OTRO municipio que el de la dirección: no coincide', () => {
    const r = comprobar(cl('SIMÓN BOLIVAR 32', 'Trinidad'), punto('Bayamo', ['Sancti Spíritus']));

    assert.equal(r.estado, 'no_coincide');
    assert.equal(r.motivo, 'municipio');
  });

  test('otra calle en el mismo municipio y sin saber ubicar la dirección: a revisar', () => {
    const r = comprobar(cl('Calle Maceo 10'), punto('Gómez'));

    assert.equal(r.estado, 'revisar');
    assert.equal(r.motivo, 'calle');
    assert.equal(hayQueUbicarLaDireccion(cl('Calle Maceo 10'), punto('Gómez')), true);
  });

  test('sin vía reconocible en el texto no se puede comparar', () => {
    assert.equal(comprobar(cl('frente al cuerpo de guardia'), punto('Gómez')).estado, 'sin_referencia');
  });

  test('el buscador no tiene nada del punto: sin datos', () => {
    assert.equal(comprobar(cl('Calle Maceo 10'), null).estado, 'sin_referencia');
  });

  test('el barrio del punto es el que nombra la dirección: coincide aunque la calle se llame distinto', () => {
    assert.equal(comprobar(cl('Calle Real, Las Minas'), punto('Calle 5ta', ['Guanabacoa'], 'Las Minas')).estado, 'coincide');
  });
});

describe('dirección → punto', () => {
  const d = (lat: number) => ({ consultado: true, latitud: lat, longitud: -82.3 });

  test('el buscador ubica la dirección junto al punto: coincide; lejos: no coincide', () => {
    assert.equal(comprobar(cl('Calle Maceo 10'), punto('Gómez'), d(23.1001)).estado, 'coincide');
    assert.equal(comprobar(cl('Calle Maceo 10'), punto('Gómez'), d(23.108)).estado, 'revisar');
    const lejos = comprobar(cl('Calle Maceo 10'), punto('Gómez'), d(23.3));

    assert.equal(lejos.estado, 'no_coincide');
    assert.ok(lejos.distanciaKm! > 2);
  });

  test('si el buscador no supo ubicar la dirección, queda a revisar', () => {
    assert.equal(comprobar(cl('Calle Maceo 10'), punto('Gómez'), { consultado: true, latitud: null, longitud: null }).estado, 'revisar');
  });
});
