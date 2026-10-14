import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

import { getRequesterContext } from '../src/lib/sucursalContext.ts';

const SECRETO = process.env.JWT_SECRET || 'fallback-secret-key';

function peticion(rol: string): Request {
  const token = jwt.sign({ userId: 'u', username: 'quien', role: rol, sucursalId: 'TUN' }, SECRETO);

  return { headers: { authorization: `Bearer ${token}` }, query: {}, body: {}, params: {} } as unknown as Request;
}

test('el Operador puede dar de alta vendedores, pero no gestionarlos', () => {
  const c = getRequesterContext(peticion('Operador'));

  assert.equal(c.puedeCrearVendedores, true);
  assert.equal(c.puedeGestionarVendedores, false);
});

test('quien ya gestionaba sigue pudiendo crear, y el Gestor no', () => {
  assert.equal(getRequesterContext(peticion('Supervisor')).puedeCrearVendedores, true);
  assert.equal(getRequesterContext(peticion('Administrador')).puedeCrearVendedores, true);
  assert.equal(getRequesterContext(peticion('Gestor')).puedeCrearVendedores, false);
});
