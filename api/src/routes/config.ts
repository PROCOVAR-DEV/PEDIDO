import { Router } from 'express';
import { NextFunction, Response } from 'express';
import prisma from '../prismaClient';
import { getRequesterContext, resolveSucursalScope } from '../lib/sucursalContext';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { horaDeMinutos, minutosDeHora } from '../lib/liberacionPedidos';
import { olvidarReglas } from '../lib/liberacionRegla';

const router = Router();

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!getRequesterContext(req).canManageUsers) {
    return res.status(403).json({ error: 'Solo los administradores pueden acceder a configuracion.' });
  }
  next();
};

router.use(authenticateToken, requireAdmin);

// Get current configuration
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      mode: 'user-scoped',
      sucursalId: req.user?.sucursalId || null,
      message: 'La sucursal se determina automaticamente por el usuario autenticado.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Global sucursal config removed (kept route for backwards compatibility)
router.post('/', async (_req: AuthRequest, res: Response) => {
  return res.status(410).json({
    error: 'La configuracion global de sucursal fue eliminada. Ahora se usa automaticamente la sucursal del usuario.',
  });
});

// Borra los datos (pedidos, clientes, vendedores) de UNA sucursal. Conserva usuarios,
// roles y sucursales. Es la acción mas destructiva del sistema, asi que:
//   - SOLO el Super Admin.
//   - Hay que elegir una sucursal CONCRETA (no se permite borrar "todas" de golpe).
//   - Hay que CONFIRMAR escribiendo el código de esa sucursal (evita clics accidentales).
//   - Queda REGISTRADO (quien, que sucursal, cuantas filas).
router.delete('/reset-database', async (req: AuthRequest, res: Response) => {
  try {
    const requester = getRequesterContext(req);
    if (!requester.isSuperAdmin) {
      return res.status(403).json({ error: 'Solo el Super Admin puede borrar la base de datos.' });
    }

    // La sucursal objetivo sale del selector (header x-sucursal-id). Si el Super Admin
    // esta en "Todas", no hay ninguna elegida -> se rechaza para no borrarlo todo.
    const { sucursalId, error: scopeError } = resolveSucursalScope(req, {
      allowAllForAdmin: true,
      preferUserSucursal: true,
      defaultAllForAdmin: false,
    });
    if (scopeError) return res.status(403).json({ error: scopeError });
    if (!sucursalId) {
      return res.status(400).json({
        error: 'Elige una sucursal concreta en el selector antes de borrar. No se permite borrar todas a la vez.',
      });
    }

    const sucursal = await prisma.sucursal.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return res.status(404).json({ error: 'La sucursal no existe.' });

    // Confirmación: hay que mandar el código exacto de la sucursal.
    const confirmacion = String((req.body as { confirmacion?: string })?.confirmacion || '').trim().toUpperCase();
    const esperado = String(sucursal.codigo || sucursal.nombre || '').trim().toUpperCase();
    if (!confirmacion || confirmacion !== esperado) {
      return res.status(400).json({
        error: `Para confirmar, escribe el código de la sucursal: "${esperado}".`,
      });
    }

    const orderIds = (
      await prisma.pedido.findMany({ where: { sucursalId }, select: { id: true } })
    ).map((p) => p.id);

    // Orden para respetar las claves foráneas. Conserva usuarios, roles y sucursales.
    if (orderIds.length > 0) {
      await prisma.pedidoItem.deleteMany({ where: { pedidoId: { in: orderIds } } });
    }
    const ped = await prisma.pedido.deleteMany({ where: { sucursalId } });
    const cli = await prisma.cliente.deleteMany({ where: { sucursalId } });
    const ven = await prisma.vendedor.deleteMany({ where: { sucursalId } });

    console.log(
      `[BORRADO] ${new Date().toISOString()} · ${requester.username} · sucursal=${esperado} · ` +
        `pedidos=${ped.count} clientes=${cli.count} vendedores=${ven.count}`,
    );

    res.json({
      success: true,
      message: `Datos de la sucursal ${esperado} borrados.`,
      borrados: { pedidos: ped.count, clientes: cli.count, vendedores: ven.count },
    });
  } catch (err) {
    console.error('Error resetting database:', err);
    res.status(500).json({ error: 'Error al borrar la base de datos' });
  }
});

/**
 * Liberación de pedidos por hora de UNA sucursal (ver lib/liberacionPedidos.ts).
 * La sucursal sale del selector; en «Todas» no hay a cuál configurar.
 */
const sucursalDeLaRegla = (req: AuthRequest) =>
  resolveSucursalScope(req, { allowAllForAdmin: true, preferUserSucursal: true, defaultAllForAdmin: false });

const reglaJson = (s: { id: string; nombre: string; liberacionActiva: boolean; liberacionAyerHasta: number; liberacionHoyDesde: number }) => ({
  sucursalId: s.id,
  sucursalNombre: s.nombre,
  activa: s.liberacionActiva,
  ayerHasta: horaDeMinutos(s.liberacionAyerHasta),
  hoyDesde: horaDeMinutos(s.liberacionHoyDesde),
});

router.get('/liberacion', async (req: AuthRequest, res: Response) => {
  const { sucursalId, error } = sucursalDeLaRegla(req);

  if (error) return res.status(403).json({ error });
  if (!sucursalId) return res.status(400).json({ error: 'Elige una sucursal concreta para configurar esto.' });

  const s = await prisma.sucursal.findUnique({ where: { id: sucursalId } });

  if (!s) return res.status(404).json({ error: 'La sucursal no existe.' });

  return res.json(reglaJson(s));
});

router.put('/liberacion', async (req: AuthRequest, res: Response) => {
  const { sucursalId, error } = sucursalDeLaRegla(req);

  if (error) return res.status(403).json({ error });
  if (!sucursalId) return res.status(400).json({ error: 'Elige una sucursal concreta para configurar esto.' });

  const activa = req.body?.activa;
  const ayerHasta = minutosDeHora(req.body?.ayerHasta);
  const hoyDesde = minutosDeHora(req.body?.hoyDesde);

  if (typeof activa !== 'boolean') return res.status(400).json({ error: 'Falta decir si la regla está activa.' });
  if (ayerHasta == null || hoyDesde == null) return res.status(400).json({ error: 'Las horas van como HH:MM (por ejemplo 08:30).' });
  if (ayerHasta >= hoyDesde) {
    return res.status(400).json({ error: 'La hora hasta la que se aceptan los de ayer tiene que ser anterior a la de liberar los de hoy.' });
  }

  const s = await prisma.sucursal.update({
    where: { id: sucursalId },
    data: { liberacionActiva: activa, liberacionAyerHasta: ayerHasta, liberacionHoyDesde: hoyDesde },
  });

  olvidarReglas();

  // Apagar la regla libera de golpe lo que estaba retenido: sin regla no hay motivo para esperar.
  if (!activa) {
    await prisma.pedido.updateMany({
      where: { sucursalId, visibleDesde: { gt: new Date() } },
      data: { visibleDesde: new Date() },
    });
  }

  return res.json(reglaJson(s));
});

export default router;
