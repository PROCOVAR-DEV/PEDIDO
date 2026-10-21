/**
 * Clientes del CRM y vendedores de Accesos (21/10/2026): lo que decide qué se escribe en la
 * ficha local, el paginado contra el CRM y la firma de Accesos. Sin base.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  cabecerasAccesos,
  clientesDesdeCrm,
  datosDeClienteCrm,
  idLocalDeCodigoCrm,
  traerClientesDelCrm,
  vendedoresDeMiembros,
  vendedoresDesdeAccesos,
  type ClienteCrm,
} from '../src/lib/espejoDeFuera';

const cliente = (extra: Partial<ClienteCrm> = {}): ClienteCrm => ({
  id: 'crm-1', codigo: 'PED-abc', codigo_ccsa: 'CM01TCP0397', nombre: 'Kiosco  Álien', sucursal: 'CAM',
  direccion: null, latitud: null, longitud: null, telefono: '5355', codigo_vendedor: 'A001',
  activo: true, borrado: false, row_version: 10,
  puntos_venta: [{ id: 'pv', codigo: 'PV1', nombre: 'K', direccion: 'Calle 1', latitud: 21.3, longitud: -77.9, activo: true, borrado: false }],
  ...extra,
});
const local = { activo: true, bajaManual: false, geoFuente: 'parranda', latitud: 1, longitud: 2 };

test('apagado por defecto: sin las variables nada cambia', () => {
  assert.equal(clientesDesdeCrm({}), false);
  assert.equal(vendedoresDesdeAccesos({}), false);
  assert.equal(clientesDesdeCrm({ CLIENTES_DESDE_CRM: '1' }), true);
});

test('el código PED-<id> lleva a la ficha de aquí', () => {
  assert.equal(idLocalDeCodigoCrm('PED-ckx1'), 'ckx1');
  assert.equal(idLocalDeCodigoCrm('PED-'), null);
  assert.equal(idLocalDeCodigoCrm('CLI-1'), null);
});

test('la ficha toma del CRM nombre, código CCSA, teléfono y la ubicación de su PV', () => {
  const d = datosDeClienteCrm(cliente(), local);
  assert.equal(d.crmId, 'crm-1');
  assert.equal(d.nombre, 'KIOSCO ALIEN');
  assert.equal(d.codigo, 'CM01TCP0397');
  assert.equal(d.direccion, 'Calle 1');
  assert.equal(d.latitud, 21.3);
  assert.equal(d.geoFuente, 'crm');
  assert.equal(d.distanciaKm, null, 'otra ubicación, la distancia vieja no vale');
  assert.equal(d.activo, true);
});

test('no pisa con vacío ni la ubicación de la APK ni la baja manual', () => {
  const d = datosDeClienteCrm(cliente({ codigo_ccsa: null, telefono: null, puntos_venta: [] }), local);
  assert.ok(!('codigo' in d) && !('telefono' in d) && !('direccion' in d) && !('latitud' in d));
  assert.ok(!('latitud' in datosDeClienteCrm(cliente(), { ...local, geoFuente: 'apk' })));
  assert.ok(!('latitud' in datosDeClienteCrm(cliente(), { ...local, latitud: 21.3, longitud: -77.9 })), 'misma ubicación: no se toca');
  assert.equal(datosDeClienteCrm(cliente(), { ...local, bajaManual: true }).activo, false);
});

test('la baja del CRM desactiva y marca cuándo', () => {
  const d = datosDeClienteCrm(cliente({ borrado: true }), local);
  assert.equal(d.activo, false);
  assert.ok(d.desactivadoAt instanceof Date);
  assert.equal(datosDeClienteCrm(cliente(), { ...local, activo: false }).desactivadoAt, null);
});

test('pide todas las páginas al CRM con su token y devuelve el cursor', async () => {
  const urls: string[] = [];
  const paginas = [
    { clientes: [cliente({ row_version: 5 })], siguiente_row_version: 5, hay_mas: true },
    { clientes: [cliente({ id: 'crm-2', row_version: 9 })], siguiente_row_version: 9, hay_mas: false },
  ];
  const pedir = async (url: string, init?: RequestInit) => {
    urls.push(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer tok');
    return new Response(JSON.stringify(paginas.shift()), { status: 200 });
  };
  const r = await traerClientesDelCrm(3, { CRM_URL: 'http://crm:8080/', CRM_TOKEN: 'tok' }, pedir as typeof fetch);
  assert.equal(r.cursor, 9);
  assert.deepEqual(r.clientes.map((c) => c.id), ['crm-1', 'crm-2']);
  assert.match(urls[0], /^http:\/\/crm:8080\/api\/v1\/integracion\/clientes\?.*desde_row_version=3/);
  assert.match(urls[1], /desde_row_version=5/);
  await assert.rejects(traerClientesDelCrm(0, { CRM_URL: 'http://crm' }), /CRM_TOKEN/);
  await assert.rejects(traerClientesDelCrm(0, { CRM_URL: 'http://crm', CRM_TOKEN: 't' }, (async () => new Response('', { status: 503 })) as typeof fetch), /503/);
});

test('vendedores de Accesos: activos con código, una vez por persona, sucursal sólo si es una', () => {
  const v = vendedoresDeMiembros([
    { id: 'u1', name: 'Ana', codigoVendedor: ' A001 ', activo: true, organizationSlug: 'cam' },
    { id: 'u2', name: 'Beto', codigoVendedor: 'B002', activo: true, organizationSlug: 'CAM' },
    { id: 'u2', name: 'Beto', codigoVendedor: 'B002', activo: true, organizationSlug: 'HOL' },
    { id: 'u3', name: 'Sin código', codigoVendedor: null, activo: true, organizationSlug: 'CAM' },
    { id: 'u4', name: 'De baja', codigoVendedor: 'C003', activo: false, organizationSlug: 'CAM' },
    { id: 'u5', name: 'Local', codigoVendedor: 'loc0', activo: true, organizationSlug: 'CAM' },
  ]);
  assert.deepEqual(v, [
    { accesosId: 'u1', codigo: 'A001', nombre: 'Ana', sucursal: 'CAM' },
    { accesosId: 'u2', codigo: 'B002', nombre: 'Beto', sucursal: null },
  ]);
});

test('la firma de Accesos es la del CRM: HMAC de método, ruta, hora, nonce y hash del cuerpo', () => {
  const clave = '11'.repeat(32);
  const c = cabecerasAccesos('/api/service/members', '{}', { QB_AUTH_CLIENT_ID: 'pedido', QB_AUTH_SIGNING_KEY: clave, QB_AUTH_KEY_VERSION: '2' }, 1_700_000_000_000);
  assert.equal(c['X-Timestamp'], '1700000000');
  assert.equal(c['X-Key-Version'], '2');
  const hash = crypto.createHash('sha256').update('{}').digest('hex');
  const esperada = crypto.createHmac('sha256', Buffer.from(clave, 'hex'))
    .update(['POST', '/api/service/members', '1700000000', c['X-Nonce'], hash].join('\n')).digest('hex');
  assert.equal(c['X-Signature'], esperada);
  assert.throws(() => cabecerasAccesos('/x', '{}', { QB_AUTH_CLIENT_ID: 'p', QB_AUTH_SIGNING_KEY: 'corta' }), /SIGNING_KEY/);
});
