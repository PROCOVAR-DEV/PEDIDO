import { test } from "node:test";
import assert from "node:assert/strict";

import { contadorDeFacturas, cuandoEnCuba, lineasDeEntrega } from "../src/lib/entregas-de-factura.ts";

/**
 * El tooltip del chip de reparto desglosa el estado POR FACTURA. No hay pruebas de
 * componentes en este front: se prueba lo que decide el texto (el chip solo lo pinta).
 */

const e = (factura: string, estado: string, at: string, nota: string | null = null) => ({
  factura, puntoDeVenta: "1", estado, at, nota,
});

test("una línea por factura, con el estado en español y la hora de Cuba", () => {
  // 18:12 UTC = 14:12 en La Habana (UTC-4 en octubre)
  const l = lineasDeEntrega([e("47541", "entregado", "2026-10-23T18:12:00Z")]);

  assert.deepEqual(l, [{ clave: "47541|1", texto: "Factura 47541 · Entregada · 23/10 14:12", nota: null }]);
});

test("los cinco estados tienen etiqueta; uno desconocido se enseña tal cual", () => {
  const t = ["despachado", "en_transito", "entregado", "devuelto", "cancelado", "raro"].map(
    (s) => lineasDeEntrega([e("1", s, "2026-10-23T18:12:00Z")])[0].texto.split(" · ")[1],
  );

  assert.deepEqual(t, ["En despacho", "En ruta", "Entregada", "Devuelta", "Cancelada", "raro"]);
});

test("dos facturas: dos líneas en el orden recibido, la nota solo si la hay", () => {
  const l = lineasDeEntrega([
    e("300", "cancelado", "2026-10-23T18:12:00Z", "cliente no estaba"),
    e("200", "entregado", "2026-10-23T14:00:00Z", "  "),
  ]);

  assert.deepEqual(l.map((x) => x.texto), [
    "Factura 300 · Cancelada · 23/10 14:12",
    "Factura 200 · Entregada · 23/10 10:00",
  ]);
  assert.deepEqual(l.map((x) => x.nota), ["cliente no estaba", null]);
});

test("sin filas: ninguna línea y ningún contador (el chip queda como antes)", () => {
  assert.deepEqual(lineasDeEntrega([]), []);
  assert.equal(contadorDeFacturas([]), null);
  assert.equal(contadorDeFacturas(undefined), null);
});

test("el contador sale con más de una factura y no con una", () => {
  assert.equal(contadorDeFacturas([e("1", "entregado", "2026-10-23T18:12:00Z")]), null);
  assert.equal(
    contadorDeFacturas([e("1", "entregado", "2026-10-23T18:12:00Z"), e("2", "devuelto", "2026-10-23T18:12:00Z")]),
    "2 facturas",
  );
});

test("la hora es la de Cuba aunque el proceso corra en otra zona; medianoche es 00:xx", () => {
  assert.equal(cuandoEnCuba("2026-10-24T04:05:00Z"), "24/10 00:05");
  assert.equal(cuandoEnCuba("2026-01-15T05:00:00Z"), "15/01 00:00"); // invierno: UTC-5
  assert.equal(cuandoEnCuba("2026-02-05T12:00:00Z"), "05/02 07:00"); // día y mes de una cifra
});
