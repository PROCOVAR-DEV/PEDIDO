/**
 * `POST /integration/crm/pedidos` contra una base de verdad, por HTTP y con la clave.
 *
 * `tests/pedido-desde-crm.test.ts` prueba la validación y el folio sin base. Esto prueba lo
 * que sólo se ve con base: que reenviar no duplica (tampoco cinco envíos a la vez), que el
 * folio del CRM entra tal cual y es único, y que el estado vuelve.
 *
 * Usa lo COMPILADO (`dist/`): el router carga módulos que leen `__dirname`.
 *
 * Uso, contra una base Postgres VACÍA y desechable (borra pedidos, clientes y vendedores):
 *   npm run build && DATABASE_PROVIDER=postgres DATABASE_URL=postgresql://... npx prisma db push
 *   DATABASE_PROVIDER=postgres DATABASE_URL=postgresql://... node --test scripts/pruebas-crm.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

if (!process.env.DATABASE_URL?.startsWith('postgres')) throw new Error('Falta DATABASE_URL de Postgres (desechable).')
process.env.SERVICE_API_KEY = 'clave-de-prueba-crm'

const require = createRequire(import.meta.url)
const express = require('express')
const prisma = require('../dist/prismaClient.js').default
const router = require('../dist/routes/integration.js').default
const ordersRouter = require('../dist/routes/orders.js').default
const { facturasPorFolio } = require('../dist/lib/emparejarFactura.js')

const app = express()
app.use(express.json())
app.use('/integration', router)
// El camino de Retool: n8n sube el CSV a /orders/bulk desde la red interna.
app.use('/orders', ordersRouter)
const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
const RAIZ = `http://127.0.0.1:${servidor.address().port}`
const BASE = `${RAIZ}/integration/crm/pedidos`
const post = (ruta, cuerpo) =>
  fetch(`${RAIZ}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.SERVICE_API_KEY },
    body: JSON.stringify(cuerpo),
  }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }))

const enviar = (cuerpo, clave = process.env.SERVICE_API_KEY) =>
  fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(clave ? { 'x-api-key': clave } : {}) },
    body: JSON.stringify(cuerpo),
  }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }))

const estado = (folios) =>
  fetch(`${BASE}/estado`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.SERVICE_API_KEY },
    body: JSON.stringify({ folios }),
  }).then((r) => r.json())

let n = 0
const pedido = (extra = {}) => ({
  folio: `A001-20261013-${String(++n).padStart(6, '0')}`,
  sucursal: 'CAM',
  fecha: '2026-10-13',
  vendedor: { codigo: 'A001', accesosId: 'u-1', nombre: 'Ana Pérez' },
  cliente: { codigo: 'CLI-1', codigoCcsa: 'LH15', nombre: 'Kiosco Alien', telefono: '5355' },
  puntoDeVenta: { codigo: 'PV-1', nombre: 'Kiosco Alien', direccion: 'Calle 1' },
  domicilio: { requiere: true, costoUsd: 3.5, distanciaKm: 4.2, tasa: 410 },
  lineas: [{ sku: 'PAR-355', producto: 'Parranda 355ml', cantidad: 24, precioUnitario: 120, moneda: 'CUP', hl: 0.0852 }],
  ...extra,
})

test.before(async () => {
  await prisma.pedidoItem.deleteMany()
  await prisma.pedido.deleteMany()
  await prisma.cliente.deleteMany()
  await prisma.vendedor.deleteMany()
  await prisma.sucursal.deleteMany()
  await prisma.sucursal.create({ data: { codigo: 'CAM', nombre: 'Camagüey' } })
})

test.after(async () => {
  servidor.close()
  await prisma.$disconnect()
})

test('sin la clave de servicio no entra nada', async () => {
  const r = await enviar(pedido(), null)
  assert.equal(r.status, 401)
  assert.equal(await prisma.pedido.count(), 0)
})

test('entra con el folio del CRM tal cual; crea vendedor y cliente', async () => {
  const p = pedido()
  const r = await enviar(p)
  assert.equal(r.status, 201)
  assert.equal(r.cuerpo.folio, p.folio)
  assert.equal(r.cuerpo.duplicado, false)

  const g = await prisma.pedido.findUnique({ where: { id: r.cuerpo.pedidoId }, include: { items: true, vendedor: true, cliente: true } })
  assert.equal(g.folio, p.folio)
  assert.equal(g.costoDomicilio, 3.5)
  assert.equal(g.tasaDomicilio, 410)
  assert.equal(g.requiere_domicilio, true)
  assert.equal(g.items.length, 1)
  assert.equal(g.items[0].producto, 'PARRANDA 355ML')
  assert.equal(Number(g.items[0].precio_linea), 2880)
  assert.equal(g.vendedor.codigo, 'A001')
  assert.equal(g.vendedor.creadoPor, 'crm')
  assert.equal(g.vendedor.gestorId, null)
  assert.equal(g.cliente.codigo, 'LH15')
  assert.equal(g.fecha.toISOString().slice(0, 10), '2026-10-13')
})

test('reenviar el mismo pedido devuelve el mismo, no otro', async () => {
  const p = pedido()
  const a = await enviar(p)
  const b = await enviar(p)
  assert.equal(a.status, 201)
  assert.equal(b.status, 200)
  assert.equal(b.cuerpo.duplicado, true)
  assert.equal(b.cuerpo.pedidoId, a.cuerpo.pedidoId)
  assert.equal(b.cuerpo.folio, a.cuerpo.folio)
  assert.equal(await prisma.pedido.count({ where: { folio: p.folio } }), 1)
})

test('cinco envíos A LA VEZ del mismo pedido dejan uno', async () => {
  const p = pedido()
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => enviar(p)))
  assert.deepEqual(rs.map((r) => r.status).filter((s) => s === 201).length, 1)
  assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.cuerpo)))
  assert.equal(new Set(rs.map((r) => r.cuerpo.pedidoId)).size, 1)
  assert.equal(await prisma.pedido.count({ where: { folio: p.folio } }), 1)
})

test('ningún folio repetido y el cliente se reutiliza', async () => {
  const folios = (await prisma.pedido.findMany({ select: { folio: true } })).map((x) => x.folio)
  assert.equal(new Set(folios).size, folios.length)
  assert.equal(await prisma.cliente.count(), 1)
  assert.equal(await prisma.vendedor.count(), 1)
})

test('el mismo folio del CRM en OTRA sucursal es un 409, y no se crea nada', async () => {
  const antes = await prisma.pedido.count()
  const p = pedido()
  await enviar(p)
  await prisma.sucursal.upsert({ where: { codigo: 'HAB' }, create: { codigo: 'HAB', nombre: 'La Habana' }, update: {} })
  const r = await enviar({ ...p, sucursal: 'HAB' })
  assert.equal(r.status, 409)
  assert.equal(await prisma.pedido.count(), antes + 1)
})

test('lo que falta de este lado es un 422 con el motivo', async () => {
  const r = await enviar(pedido({ sucursal: 'XXX' }))
  assert.equal(r.status, 422)
  assert.match(r.cuerpo.error, /XXX/)

  await prisma.vendedor.create({ data: { codigo: 'B002', nombre: 'BETO DE BAJA', activo: false } })
  const deBaja = pedido({ vendedor: { codigo: 'B002' } })
  deBaja.folio = deBaja.folio.replace('A001', 'B002')
  const b = await enviar(deBaja)
  assert.equal(b.status, 422)
  assert.match(b.cuerpo.error, /de baja/)
})

test('un cuerpo inválido es un 400 con los campos', async () => {
  const r = await enviar(pedido({ lineas: [], folio: 'PDG26-260906-2992' }))
  assert.equal(r.status, 400)
  assert.deepEqual(r.cuerpo.campos.map((c) => c.campo), ['folio', 'lineas'])
})

test('el estado vuelve: factura, entrega, y `existe: false` si lo borraron aquí', async () => {
  const p = pedido()
  const { cuerpo } = await enviar(p)
  await prisma.pedido.update({
    where: { id: cuerpo.pedidoId },
    data: { facturaEstado: 'igual', facturaNumero: '44830', facturaAt: new Date(), estado: 'completada', estadoEntrega: 'entregado', estadoEntregaAt: new Date() },
  })
  const ninguno = 'A001-20261013-999999'
  let r = await estado([p.folio, ninguno, 'PDG26-261020-2992'])
  assert.equal(r.pedidos.length, 3)
  assert.equal(r.pedidos[0].existe, true)
  assert.equal(r.pedidos[0].facturaNumero, '44830')
  assert.equal(r.pedidos[0].estadoEntrega, 'entregado')
  assert.equal(r.pedidos[0].folio, cuerpo.folio)
  assert.equal(r.pedidos[1].existe, false)
  // Un folio de Retool no se contesta por aquí.
  assert.equal(r.pedidos[2].existe, false)

  await prisma.pedidoItem.deleteMany({ where: { pedidoId: cuerpo.pedidoId } })
  await prisma.pedido.delete({ where: { id: cuerpo.pedidoId } })
  r = await estado([p.folio])
  assert.equal(r.pedidos[0].existe, false)
})

test('RETOOL Y EL CRM CONVIVEN: los dos entran y los dos casan con su factura de Ventra', async () => {
  const cam = await prisma.sucursal.findUnique({ where: { codigo: 'CAM' } })
  // El vendedor de Retool ya existe con su sucursal (sin ella, la ingesta lo deja «Sin asignar»).
  await prisma.vendedor.create({ data: { codigo: 'diango.gola', nombre: 'DIANGO GOLA', sucursalId: cam.id } })

  // Retool → n8n → /orders/bulk, como hoy: un folio con dos clientes = dos pedidos, el
  // segundo con NUESTRO sufijo.
  const fila = (cliente, producto, unidades) => ({
    vendedor: 'DIANGO GOLA', cliente, folio: 'PDG26-261020-2992', producto, unidades, fecha: '2026-10-20',
  })
  const csv = await post('/orders/bulk?sync=1', {
    records: [fila('Cafeteria Polo', 'PARRANDA 355ML', 24), fila('Kiosco Sol', 'PARRANDA 355ML', 12)],
  })
  assert.equal(csv.status, 200, JSON.stringify(csv.cuerpo))
  const deRetool = await prisma.pedido.findMany({
    where: { folio: { startsWith: 'PDG26-261020-2992' } }, orderBy: { folio: 'asc' },
  })
  assert.deepEqual(deRetool.map((x) => x.folio), ['PDG26-261020-2992', 'PDG26-261020-2992-1'])

  // El CRM, por su lado, con su folio.
  const p = pedido({ fecha: '2026-10-20', cliente: { codigo: 'CLI-9', nombre: 'Panaderia Luz' } })
  p.folio = 'A001-20261020-000001'
  const crm = await enviar(p)
  assert.equal(crm.status, 201, JSON.stringify(crm.cuerpo))

  // Las tres facturas, cada una con el folio que se copió en su nota, casan con SU pedido.
  const porFolio = facturasPorFolio([
    { operNumber: '9001', nota: `P-${deRetool[0].folio}; V-DIANGO GOLA;` },
    { operNumber: '9002', nota: `P-${deRetool[1].folio}; V-DIANGO GOLA;` },
    { operNumber: '9003', nota: `P-${crm.cuerpo.folio}; V-ANA PEREZ;` },
  ])
  const guardados = await prisma.pedido.findMany({ where: { folio: { in: [...porFolio.keys()] } } })
  assert.equal(guardados.length, 3)

  // Y la puerta de las facturas los marca a los dos (Retool por folio + vendedor, CRM igual).
  const r = await post('/integration/orders/invoicing', {
    facturas: [
      { folio: deRetool[1].folio, vendedorCodigo: 'diango.gola', estado: 'igual', numero: '9002' },
      { folio: crm.cuerpo.folio, vendedorCodigo: 'A001', estado: 'igual', numero: '9003' },
    ],
  })
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo))
  assert.equal(r.cuerpo.rechazadas.length, 0, JSON.stringify(r.cuerpo.rechazadas))
  const [a, b] = await Promise.all([
    prisma.pedido.findUnique({ where: { id: deRetool[1].id } }),
    prisma.pedido.findUnique({ where: { id: crm.cuerpo.pedidoId } }),
  ])
  assert.equal(a.facturaNumero, '9002')
  assert.equal(b.facturaNumero, '9003')
  // El hermano sin sufijo NO se llevó la factura del otro.
  assert.equal((await prisma.pedido.findUnique({ where: { id: deRetool[0].id } })).facturaNumero, null)
})

test('el mismo pedido por Retool y por el CRM: entran los dos y el INFORME lo señala', async () => {
  const p = pedido({ fecha: '2026-10-20', cliente: { codigo: 'CLI-1', nombre: 'Cafeteria Polo' } })
  p.folio = 'A001-20261020-000002'
  const r = await enviar(p)
  assert.equal(r.status, 201)
  const retool = await prisma.pedido.findFirst({ where: { folio: 'PDG26-261020-2992' } })
  const informe = await fetch(`${RAIZ}/integration/crm/pedidos/duplicados?desde=2026-10-19&hasta=2026-10-21`, {
    headers: { 'x-api-key': process.env.SERVICE_API_KEY },
  }).then((x) => x.json())
  assert.deepEqual(
    informe.posiblesDuplicados.map((d) => [d.crm.folio, d.retool.folio]),
    [[p.folio, retool.folio]],
  )
  // Nada se borró: siguen los dos.
  assert.ok(await prisma.pedido.findUnique({ where: { id: retool.id } }))
  assert.ok(await prisma.pedido.findUnique({ where: { id: r.cuerpo.pedidoId } }))
})
