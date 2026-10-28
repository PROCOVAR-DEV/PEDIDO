import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esCierreNocturno, horaDeMinutos, minutosDeHora, soloVisibles, visibleDesde } from '../src/lib/liberacionPedidos';

const REGLA = { activa: true, ayerHasta: 510, hoyDesde: 900 };
// Cuba va a UTC-4 en octubre: 08:00 en Cuba = 12:00Z.
const cuba = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-04:00`);
// Como llegan las fechas del CSV: el día a mediodía UTC.
const dia = (d: string) => new Date(`${d}T12:00:00Z`);
const hoy = '2026-10-27';
const ayer = '2026-10-26';
const iso = (d: Date | null) => d && d.toISOString();
const A_LAS_15 = cuba(hoy, '15:00').toISOString();

test('apagada: todo visible', () => {
  assert.equal(visibleDesde(dia(hoy), cuba(hoy, '10:00'), { ...REGLA, activa: false }), null);
});

test('de ayer, antes de las 8:30: visible ya', () => {
  assert.equal(visibleDesde(dia(ayer), cuba(hoy, '08:00'), REGLA), null);
});

test('de hoy, a las 8:10: retenido hasta las 15:00 (el caso del vendedor)', () => {
  assert.equal(iso(visibleDesde(dia(hoy), cuba(hoy, '08:10'), REGLA)), A_LAS_15);
});

test('de hoy, a cualquier hora antes de las 15:00: hasta las 15:00', () => {
  for (const h of ['00:05', '07:00', '08:30', '12:00', '14:59'])
    assert.equal(iso(visibleDesde(dia(hoy), cuba(hoy, h), REGLA)), A_LAS_15, h);
});

test('de ayer entre las 8:30 y las 15:00: se trata como de hoy', () => {
  assert.equal(iso(visibleDesde(dia(ayer), cuba(hoy, '08:30'), REGLA)), A_LAS_15);
  assert.equal(iso(visibleDesde(dia(ayer), cuba(hoy, '11:00'), REGLA)), A_LAS_15);
});

test('pasadas las 15:00: visible ya, sea de hoy o de ayer', () => {
  assert.equal(visibleDesde(dia(hoy), cuba(hoy, '15:00'), REGLA), null);
  assert.equal(visibleDesde(dia(hoy), cuba(hoy, '23:50'), REGLA), null);
  assert.equal(visibleDesde(dia(ayer), cuba(hoy, '16:00'), REGLA), null);
});

test('fecha futura: se trata como de hoy', () => {
  assert.equal(iso(visibleDesde(dia('2026-10-28'), cuba(hoy, '09:00'), REGLA)), A_LAS_15);
});

test('el día se mide en Cuba: 23:30 del 26 en Cuba ya es 03:30Z del 27', () => {
  // Para Cuba sigue siendo el 26: pasadas las 15:00 -> visible ya.
  assert.equal(visibleDesde(dia(ayer), new Date('2026-10-27T03:30:00Z'), REGLA), null);
});

test('horas configurables', () => {
  const r = { activa: true, ayerHasta: 540, hoyDesde: 840 };
  assert.equal(visibleDesde(dia(ayer), cuba(hoy, '08:45'), r), null);
  assert.equal(iso(visibleDesde(dia(hoy), cuba(hoy, '09:00'), r)), cuba(hoy, '14:00').toISOString());
});

test('horas HH:MM', () => {
  assert.equal(minutosDeHora('08:30'), 510);
  assert.equal(minutosDeHora('8:30'), 510);
  assert.equal(minutosDeHora('24:00'), null);
  assert.equal(minutosDeHora('abc'), null);
  assert.equal(horaDeMinutos(900), '15:00');
});

test('soloVisibles deja pasar lo nulo y lo ya liberado', () => {
  const ahora = new Date('2026-10-27T19:00:00Z');
  assert.deepEqual(soloVisibles(ahora), { OR: [{ visibleDesde: null }, { visibleDesde: { lte: ahora } }] });
});

// ---- cierre nocturno (La Habana): la primera hora es MAYOR que la segunda: cierra 15:00, reabre 08:00 ----
const NOCHE = { activa: true, ayerHasta: 900, hoyDesde: 480 };
const m27 = '2026-10-27';
const m28 = '2026-10-28';

test('el modo sale del orden de las horas', () => {
  assert.equal(esCierreNocturno({ ayerHasta: 510, hoyDesde: 900 }), false);
  assert.equal(esCierreNocturno({ ayerHasta: 900, hoyDesde: 480 }), true);
});

test('noche: de 8 a 15 se ve en el acto', () => {
  for (const h of ['08:00', '10:30', '14:59']) assert.equal(visibleDesde(dia(m27), cuba(m27, h), NOCHE), null, h);
});

test('noche: lo que entra a las 15:00 o de tarde-noche sale a las 8 del día siguiente', () => {
  for (const h of ['15:00', '18:30', '23:59'])
    assert.equal(iso(visibleDesde(dia(m27), cuba(m27, h), NOCHE)), cuba(m28, '08:00').toISOString(), h);
});

test('noche: lo que entra de madrugada sale a las 8 de ese mismo día', () => {
  for (const h of ['00:00', '02:15', '07:59'])
    assert.equal(iso(visibleDesde(dia(m27), cuba(m28, h), NOCHE)), cuba(m28, '08:00').toISOString(), h);
});

test('noche: la fecha del pedido no cuenta, manda la hora de entrada', () => {
  assert.equal(iso(visibleDesde(dia('2026-10-20'), cuba(m27, '16:00'), NOCHE)), cuba(m28, '08:00').toISOString());
});

test('apagada o con las dos horas iguales no retiene nada', () => {
  assert.equal(visibleDesde(dia(m27), cuba(m27, '20:00'), { ...NOCHE, activa: false }), null);
  assert.equal(visibleDesde(dia(m27), cuba(m27, '20:00'), { activa: true, ayerHasta: 480, hoyDesde: 480 }), null);
});
