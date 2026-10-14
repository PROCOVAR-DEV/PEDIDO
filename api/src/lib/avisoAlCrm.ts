/**
 * El aviso de vuelta al CRM: cuando un pedido que vino del CRM cambia de factura, de
 * entrega o se borra, se le avisa por webhook. Decidido por Jose (14/10/2026): «que PEDIDO
 * notifique de vuelta al CRM por webhook, más rápido, menos notificaciones y menos
 * consultas, solo cuando se hace algo». Antes el CRM preguntaba cada 5 minutos.
 *
 * Es un camino AÑADIDO y apagado por defecto: sin `CRM_WEBHOOK_URL` y `CRM_WEBHOOK_SECRET`
 * en el entorno no hace nada. Va por la cola de webhooks que ya existe (la del reparto),
 * con su worker, sus reintentos y su firma `X-Webhook-Signature` (`firmar` en webhook.ts).
 *
 * Se engancha a `emitEvent('pedido', …)`, que ya se llama en cada cambio de un pedido, y
 * sólo avisa si lo que le importa al CRM cambió de verdad: guarda en Redis la última
 * huella mandada de cada pedido. Editar la dirección de un pedido no le manda nada al CRM.
 *
 * Contrato (lo recibe el sincronizador del CRM en `POST /api/v1/sync/pedido/estado`):
 *   { evento: 'pedido.estado', folio, existe, pedidoId?, estado?, facturaEstado?,
 *     facturaNumero?, facturaAt?, estadoEntrega?, estadoEntregaAt?, completedAt?,
 *     updatedAt?, ts }
 * `ts` (ms) ordena los avisos: el CRM no aplica uno más viejo que el último que aplicó.
 * Si un aviso se pierde, el CRM lo recoge en su reconciliación (cada 6 h).
 */
import { estadoDePedidosCrm, FORMA_FOLIO_CRM, type EstadoPedidoCrm } from './pedidoDesdeCrm';
import { webhooksQueue } from './queues';
import { getConnection, PREFIX } from './redis';
import type { ConfigWebhook } from './webhook';

/** El destino en la cola de webhooks. No está en la tabla WebhookConfig: va por entorno. */
export const DESTINO_CRM = 'crm';

/** Lo que se recuerda de cada pedido, para no avisar dos veces de lo mismo. */
const VIGENCIA_HUELLA_S = 90 * 24 * 3600;

/** La config del destino del CRM, del entorno. null si no es el CRM o no está configurado. */
export function configDelCrm(destino: string, env: NodeJS.ProcessEnv = process.env): ConfigWebhook | null {
  if (destino !== DESTINO_CRM) return null;
  const url = (env.CRM_WEBHOOK_URL || '').trim();
  const secret = (env.CRM_WEBHOOK_SECRET || '').trim();

  // Sin secreto no se manda: el CRM rechaza lo que no viene firmado.
  return { url: url && secret ? url : '', key: '', secret, activo: Boolean(url && secret) };
}

/** Lo que le importa al CRM de un pedido. Si no cambia, no hay aviso. */
export function huellaDe(e: EstadoPedidoCrm): string {
  return JSON.stringify([e.existe, e.facturaEstado ?? null, e.facturaNumero ?? null, e.estadoEntrega ?? null]);
}

/**
 * ¿Hay que avisar? Sí si la huella cambió. Sin huella anterior, sí, salvo al CREARSE: el
 * pedido lo acaba de mandar el CRM y no hay nada que contarle.
 */
export function debeAvisar(anterior: string | null, huella: string, accion: string): boolean {
  if (!anterior) return accion !== 'create';
  try {
    return (JSON.parse(anterior) as { huella?: string }).huella !== huella;
  } catch {
    return true;
  }
}

/**
 * Lo llama `emitEvent`. Nunca lanza ni espera: es un aviso, no puede romper el cambio
 * que lo dispara.
 */
export function avisarAlCrm(tipo: string, opts: { id?: string | null; accion?: string }): void {
  if (tipo !== 'pedido' || !opts.id || !configDelCrm(DESTINO_CRM)?.activo) return;
  void revisar(opts.id, opts.accion || 'change').catch((e) =>
    console.error(`[crm] aviso de ${opts.id} falló:`, (e as Error).message),
  );
}

async function revisar(pedidoId: string, accion: string): Promise<void> {
  const conn = getConnection();
  const q = webhooksQueue();
  if (!conn || !q) return;
  const clave = `${PREFIX}:crm:estado:${pedidoId}`;

  let estado: EstadoPedidoCrm;
  if (accion === 'delete') {
    // Ya no está en la base: el folio sale de la huella. Sin huella, lo recoge la
    // reconciliación del CRM.
    const anterior = await conn.get(clave);
    if (!anterior) return;
    estado = { folio: (JSON.parse(anterior) as { folio: string }).folio, existe: false, pedidoId };
  } else {
    const prisma = (await import('../prismaClient')).default;
    const p = await prisma.pedido.findUnique({ where: { id: pedidoId }, select: { folio: true } });
    if (!p || !FORMA_FOLIO_CRM.test(p.folio)) return;
    [estado] = await estadoDePedidosCrm([p.folio]);
  }

  const huella = huellaDe(estado);
  const anterior = await conn.getset(clave, JSON.stringify({ folio: estado.folio, huella }));
  await conn.expire(clave, VIGENCIA_HUELLA_S);
  if (!debeAvisar(anterior, huella, accion)) return;

  const ts = Date.now();
  // jobId con el ts: dos cambios seguidos son dos noticias; el CRM se queda con la última.
  await q.add(
    { destino: DESTINO_CRM, payload: { evento: 'pedido.estado', ...estado, ts } },
    { jobId: `${DESTINO_CRM}:${pedidoId}:${ts}`, removeOnComplete: true },
  );
}
