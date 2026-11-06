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

describe('calles citadas, ordinales y plurales (afinado del 06/11/2026)', () => {
  test('el punto cae en la calle de una «esquina» o de un «entre»: coincide', () => {
    assert.equal(comprobar(cl('5 oeste esquina Narciso Lopez'), punto('Narciso López')).estado, 'coincide');
    assert.equal(comprobar(cl('Fernando Suarez #42 entre Coronel Reyes y Cucalambé'), punto('Coronel Reyes')).estado, 'coincide');
  });

  test('«5ta» y «5», «Acacia» y «Acacias» son lo mismo', () => {
    assert.equal(comprobar(cl('calle 4ta % Alfredo Zallas y Bravo Correoso'), punto('4')).estado, 'coincide');
    assert.equal(comprobar(cl('Calle acacia #67 alto entre Pérez Andrade y Cervantes'), punto('Avenida de Acacias')).estado, 'coincide');
  });

  test('el número de portal no es una calle: «Maceo #14» no coincide con la calle 14', () => {
    assert.equal(comprobar(cl('Calle Maceo #14'), punto('14')).estado, 'revisar');
  });

  test('una palabra suelta que está en media Cuba no basta: «Santa Rosa» no es «Santa Rita»', () => {
    assert.equal(comprobar(cl('Mejorana esquina Santa Rosa'), punto('Santa Rita')).estado, 'revisar');
    assert.equal(comprobar(cl('Cespedes e/ 1ro de Mayo y Dolores'), punto('20 de Mayo')).estado, 'revisar');
  });

  test('si el mapa no conoce ninguna calle en el punto y no ubica la dirección, no se puede juzgar', () => {
    const buscada = { consultado: true, latitud: null, longitud: null };

    assert.equal(comprobar(cl('Calle Maceo 10'), punto(null), buscada).estado, 'sin_referencia');
    // Antes de preguntar por la dirección sigue pendiente de ubicarla.
    assert.equal(hayQueUbicarLaDireccion(cl('Calle Maceo 10'), punto(null)), true);
  });
});

describe('una letra de diferencia en nombres largos', () => {
  test('«Antunes» y «Antúnez», «Villuenda» y «Villuendas»: la misma calle', () => {
    assert.equal(comprobar(cl('Antunes e/ Alba y Quiala'), punto('Antúnez')).estado, 'coincide');
    assert.equal(comprobar(cl('Villuenda No. 25 E/ Floro Vistel'), punto('Calle Villuendas')).estado, 'coincide');
  });

  test('en palabras cortas una letra ya es otra calle: «Mella» no es «Melia»', () => {
    assert.equal(comprobar(cl('Calle Mella 10'), punto('Melia')).estado, 'revisar');
  });

  test('dos letras distintas tampoco', () => {
    assert.equal(comprobar(cl('Calle Cespedes 10'), punto('Calle Cisneros')).estado, 'revisar');
  });
});
