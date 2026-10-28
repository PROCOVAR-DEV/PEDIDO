import { Router, Response, NextFunction } from 'express';
import prisma from '../prismaClient';
import { getRequesterContext, resolveSucursalScope } from '../lib/sucursalContext';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { esCierreNocturno, horaDeMinutos, minutosDeHora, visibleDesde } from '../lib/liberacionPedidos';
import { olvidarReglas } from '../lib/liberacionRegla';
import { puedeReasignar } from '../lib/reasignarCliente';

const router = Router();

/**
 * Fuera de /config a propósito: Configuración es de los administradores, y esto lo tienen que
 * poder tocar también los Supervisores y los Gerentes de su sucursal, sin entrar ahí.
 */
router.use(authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  // El AVISO (qué horario rige en tu sucursal) lo lee cualquier usuario: es lo que se enseña en su panel.
  if (req.method === 'GET' && req.path === '/aviso') return next();

  const ctx = getRequesterContext(req);

  if (!puedeReasignar(ctx.role, ctx.isGlobalAdmin)) {
    return res.status(403).json({ error: 'Solo un Supervisor o un rol superior puede configurar la liberación de pedidos.' });
  }
  next();
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
  // Lo deduce el orden de las dos horas (primera antes que segunda = «dia»; después = «noche»): no se guarda aparte.
  modo: esCierreNocturno({ ayerHasta: s.liberacionAyerHasta, hoyDesde: s.liberacionHoyDesde }) ? 'noche' : 'dia',
});

/**
 * El horario que rige en la sucursal de ESTE usuario, para el aviso del panel. Solo la suya (un Super Admin
 * sin sucursal elegida no recibe nada). Sin la regla activa: `{ activa: false }`.
 */
router.get('/aviso', async (req: AuthRequest, res: Response) => {
  const { sucursalId, error } = resolveSucursalScope(req, { allowAllForAdmin: false, preferUserSucursal: true, defaultAllForAdmin: false });

  if (error || !sucursalId) return res.json({ activa: false });

  const s = await prisma.sucursal.findUnique({ where: { id: sucursalId } });

  if (!s || !s.liberacionActiva || s.liberacionAyerHasta === s.liberacionHoyDesde) return res.json({ activa: false });

  const r = reglaJson(s);

  // ¿Un pedido que entrara AHORA se vería en el acto (entrando) o tendría que esperar (esperando, y hasta cuándo)?
  const ahora = new Date();
  const hasta = visibleDesde(ahora, ahora, { activa: true, ayerHasta: s.liberacionAyerHasta, hoyDesde: s.liberacionHoyDesde });

  return res.json({
    activa: true,
    sucursalNombre: r.sucursalNombre,
    modo: r.modo,
    primera: r.ayerHasta,
    segunda: r.hoyDesde,
    estado: hasta ? 'esperando' : 'entrando',
    hasta: hasta ? hasta.toISOString() : null,
  });
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const { sucursalId, error } = sucursalDeLaRegla(req);

  if (error) return res.status(403).json({ error });
  if (!sucursalId) return res.status(400).json({ error: 'Elige una sucursal concreta para configurar esto.' });

  const s = await prisma.sucursal.findUnique({ where: { id: sucursalId } });

  if (!s) return res.status(404).json({ error: 'La sucursal no existe.' });

  return res.json(reglaJson(s));
});

router.put('/', async (req: AuthRequest, res: Response) => {
  const { sucursalId, error } = sucursalDeLaRegla(req);

  if (error) return res.status(403).json({ error });
  if (!sucursalId) return res.status(400).json({ error: 'Elige una sucursal concreta para configurar esto.' });

  const activa = req.body?.activa;
  const ayerHasta = minutosDeHora(req.body?.ayerHasta);
  const hoyDesde = minutosDeHora(req.body?.hoyDesde);

  if (typeof activa !== 'boolean') return res.status(400).json({ error: 'Falta decir si la regla está activa.' });
  if (ayerHasta == null || hoyDesde == null) return res.status(400).json({ error: 'Las horas van como HH:MM (por ejemplo 08:30).' });
  // Primera antes que segunda = de día (Camagüey); primera después = cierre nocturno (La Habana: cierra a las 15:00, reabre a las 08:00).
  if (ayerHasta === hoyDesde) {
    return res.status(400).json({ error: 'Las dos horas no pueden ser la misma.' });
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
