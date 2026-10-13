/**
 * `POST /integration/crm/pedidos` contra una base de verdad, por HTTP y con la clave.
 *
 * `tests/pedido-desde-crm.test.ts` prueba la validación y el folio sin base. Esto prueba lo
 * que sólo se ve con base: que reenviar no duplica (tampoco cinco envíos a la vez), que el
 * folio del CRM es único, que el número del día no se repite y que el estado vuelve.
 *
 * Usa lo COMPILADO (`dist/`): el router carga módulos que leen `__dirname`.
 *
 * Uso, contra una base Postgres VACÍA y desechable (borra pedidos, clientes y vendedores):
 *   npm run build && DATABASE_PROVIDER=postgres DATABASE_URL=postgresql://... npx prisma db push
 *   DATABASE_PROVIDER=postgres DATABASE_URL=postgresql://... npm run test:crm
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

const app = express()
app.use(express.json())
app.use('/integration', router)
const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
const BASE = `http://127.0.0.1:${servidor.address().port}/integration/crm/pedidos`

const enviar = (cuerpo, clave = process.env.SERVICE_API_KEY) =>
  fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(clave ? { 'x-api-key': clave } : {}) },
    body: JSON.stringify(cuerpo),
  }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }))

const estado = (ids) =>
  fetch(`${BASE}/estado`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.SERVICE_API_KEY },
    body: JSON.stringify({ ids }),
  }).then((r) => r.json())

let n = 0
const uuid = () => `0192f1e2-3b4c-7d5e-8f60-${String(++n).padStart(12, '0')}`
const pedido = (extra = {}) => ({
  crmPedidoId: uuid(),
  folioCrm: `A001-20261013-${String(n).padStart(6, '0')}`,
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
  await prisma.contadorFolioCrm.deleteMany()
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

test('entra con NUESTRO folio y el del CRM al lado; crea vendedor y cliente', async () => {
  const p = pedido()
  const r = await enviar(p)
  assert.equal(r.status, 201)
  assert.equal(r.cuerpo.folio, 'CRM26-261013-1')
  assert.equal(r.cuerpo.duplicado, false)

  const g = await prisma.pedido.findUnique({ where: { id: r.cuerpo.pedidoId }, include: { items: true, vendedor: true, cliente: true } })
  assert.equal(g.folioCrm, p.folioCrm)
  assert.equal(g.crmPedidoId, p.crmPedidoId)
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
  assert.equal(await prisma.pedido.count({ where: { crmPedidoId: p.crmPedidoId } }), 1)
})

test('cinco envíos A LA VEZ del mismo pedido dejan uno', async () => {
  const p = pedido()
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => enviar(p)))
  assert.deepEqual(rs.map((r) => r.status).filter((s) => s === 201).length, 1)
  assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.cuerpo)))
  assert.equal(new Set(rs.map((r) => r.cuerpo.pedidoId)).size, 1)
  assert.equal(await prisma.pedido.count({ where: { crmPedidoId: p.crmPedidoId } }), 1)
})

test('el número del día no se repite y el cliente se reutiliza', async () => {
  const folios = (await prisma.pedido.findMany({ select: { folio: true } })).map((x) => x.folio)
  assert.equal(new Set(folios).size, folios.length)
  assert.equal(await prisma.cliente.count(), 1)
  assert.equal(await prisma.vendedor.count(), 1)
})

test('el mismo folio del CRM con OTRO uuid es un 409, y no se crea nada', async () => {
  const antes = await prisma.pedido.count()
  const p = pedido()
  await enviar(p)
  const r = await enviar({ ...p, crmPedidoId: uuid() })
  assert.equal(r.status, 409)
  assert.equal(await prisma.pedido.count(), antes + 1)
})

test('lo que falta de este lado es un 422 con el motivo', async () => {
  const r = await enviar(pedido({ sucursal: 'XXX' }))
  assert.equal(r.status, 422)
  assert.match(r.cuerpo.error, /XXX/)

  await prisma.vendedor.create({ data: { codigo: 'B002', nombre: 'BETO DE BAJA', activo: false } })
  const b = await enviar(pedido({ vendedor: { codigo: 'B002' } }))
  assert.equal(b.status, 422)
  assert.match(b.cuerpo.error, /de baja/)
})

test('un cuerpo inválido es un 400 con los campos', async () => {
  const r = await enviar(pedido({ lineas: [], folioCrm: 'PDG26-260906-2992' }))
  assert.equal(r.status, 400)
  assert.deepEqual(r.cuerpo.campos.map((c) => c.campo), ['folioCrm', 'lineas'])
})

test('el estado vuelve: factura, entrega, y `existe: false` si lo borraron aquí', async () => {
  const p = pedido()
  const { cuerpo } = await enviar(p)
  await prisma.pedido.update({
    where: { id: cuerpo.pedidoId },
    data: { facturaEstado: 'igual', facturaNumero: '44830', facturaAt: new Date(), estado: 'completada', estadoEntrega: 'entregado', estadoEntregaAt: new Date() },
  })
  const ninguno = uuid()
  let r = await estado([p.crmPedidoId, ninguno])
  assert.equal(r.pedidos.length, 2)
  assert.equal(r.pedidos[0].existe, true)
  assert.equal(r.pedidos[0].facturaNumero, '44830')
  assert.equal(r.pedidos[0].estadoEntrega, 'entregado')
  assert.equal(r.pedidos[0].folio, cuerpo.folio)
  assert.equal(r.pedidos[1].existe, false)

  await prisma.pedidoItem.deleteMany({ where: { pedidoId: cuerpo.pedidoId } })
  await prisma.pedido.delete({ where: { id: cuerpo.pedidoId } })
  r = await estado([p.crmPedidoId])
  assert.equal(r.pedidos[0].existe, false)
})
