import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cambioDeLinea, cambiosDeCabecera, textoDeLinea } from '../src/lib/cambiosDePedido';

const lineas = [
  { producto: 'PARRANDA 0.5L', unidades: 90, packs: 15 },
  { producto: 'PARRANDA 0.33L', unidades: 60, packs: null },
];

test('la línea se lee con sus formatos, y sin ellos si no los tiene', () => {
  assert.equal(textoDeLinea(90, 15), '90 u · 15 formatos');
  assert.equal(textoDeLinea(6, 1), '6 u · 1 formato');
  assert.equal(textoDeLinea(60, null), '60 u');
  assert.equal(textoDeLinea(60, 0), '60 u');
});

test('el caso de Claudia: 10 a 15 de una cerveza se apunta con el antes y el después', () => {
  const c = cambioDeLinea(lineas, { producto: 'parranda 0.5l', unidades: 135, packs: 15 });

  assert.deepEqual(c, { campo: 'PARRANDA 0.5L', antes: '90 u · 15 formatos', despues: '135 u · 15 formatos' });
});

test('la misma línea no es un cambio, aunque packs venga vacío o a cero', () => {
  assert.equal(cambioDeLinea(lineas, { producto: 'PARRANDA 0.5L', unidades: 90, packs: 15 }), null);
  assert.equal(cambioDeLinea(lineas, { producto: 'PARRANDA 0.33L', unidades: 60, packs: 0 }), null);
});

test('un producto que el pedido no tenía entra como línea nueva, sin «antes»', () => {
  const c = cambioDeLinea(lineas, { producto: 'MALTA', unidades: 24, packs: 2 });

  assert.deepEqual(c, { campo: 'MALTA', antes: null, despues: '24 u · 2 formatos' });
});

const antes = {
  fecha_comprometida: new Date('2026-10-15T00:00:00Z'),
  pedido_cobrado: null,
  requiere_domicilio: false,
};

test('la cabecera: fecha más tarde, cobro y domicilio cambian; lo igual no se apunta', () => {
  const c = cambiosDeCabecera(antes, {
    fecha_comprometida: new Date('2026-10-20T00:00:00Z'),
    pedido_cobrado: 'si',
    requiere_domicilio: true,
  });

  assert.deepEqual(c, [
    { campo: 'Fecha comprometida', antes: '2026-10-15', despues: '2026-10-20' },
    { campo: 'Cobro', antes: null, despues: 'si' },
    { campo: 'Domicilio', antes: 'no', despues: 'sí' },
  ]);
  assert.deepEqual(cambiosDeCabecera(antes, { ...antes }), []);
});

test('una fecha comprometida anterior no se mueve (la ingesta sólo la adelanta)', () => {
  assert.deepEqual(cambiosDeCabecera(antes, { fecha_comprometida: new Date('2026-10-10T00:00:00Z') }), []);
});

test('lo que el archivo no trae no cambia nada', () => {
  assert.deepEqual(cambiosDeCabecera(antes, {}), []);
});
