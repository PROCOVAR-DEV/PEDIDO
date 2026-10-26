/**
 * Un carril de trabajo sobre una cola de Redis, con UN solo trabajo en la cola a la vez.
 *
 * # Cómo funciona
 *
 * El trabajo, al terminar —salga bien o mal—, deja puesto el siguiente con su espera (`delay`).
 * Mientras el actual no acabe, no hay otro en la cola, así que un carril lento no se amontona detrás
 * de sí mismo, que es lo que pasa con un reloj (`setInterval`) o con un repetible de Bull cuando el
 * trabajo tarda más que su periodo.
 *
 * # Si se rompe la cadena
 *
 * Un reinicio a mitad de trabajo o un Redis caído justo al encolar el siguiente la cortarían. Por
 * eso hay una vigilancia: cada pocos minutos mira si en la cola queda algo (activo, esperando o con
 * espera) y, si no queda nada, pone un trabajo. Con la cadena sana, la vigilancia no hace nada.
 *
 * Cada carril tiene SU cola: unos no esperan a otros.
 *
 * La cola entra por una interfaz mínima para poder probarlo sin Redis.
 */
export interface ColaMinima {
  process(concurrencia: number, fn: () => Promise<unknown>): void;
  add(datos: object, opciones: { delay: number; removeOnComplete: boolean; removeOnFail: boolean }): Promise<unknown>;
  getJobCounts(): Promise<{ active: number; waiting: number; delayed: number }>;
}

export async function arrancarCarril(
  cola: ColaMinima,
  {
    nombre,
    cadaMs,
    primeraEnMs,
    trabajo,
    vigilaMs = 5 * 60 * 1000,
  }: { nombre: string; cadaMs: number; primeraEnMs: number; trabajo: () => Promise<unknown>; vigilaMs?: number },
): Promise<{ parar: () => void }> {
  const poner = (delay: number) => cola.add({}, { delay, removeOnComplete: true, removeOnFail: true });

  cola.process(1, async () => {
    try {
      await trabajo();
    } catch (e) {
      console.error(`[${nombre}] falló:`, (e as Error).message);
    } finally {
      // El siguiente se pone DESPUÉS de acabar éste. Si falla, la vigilancia lo repone.
      await poner(cadaMs).catch((e) => console.error(`[${nombre}] no se pudo encolar el siguiente:`, (e as Error).message));
    }
  });

  const asegurar = async () => {
    const c = await cola.getJobCounts();

    if (c.active + c.waiting + c.delayed === 0) {
      await poner(primeraEnMs);
      console.log(`[${nombre}] la cola estaba vacía: se pone el primer trabajo`);
    }
  };

  await asegurar().catch((e) => console.error(`[${nombre}] no se pudo arrancar el carril:`, (e as Error).message));

  const reloj = setInterval(() => void asegurar().catch(() => undefined), vigilaMs);

  reloj.unref?.();

  return { parar: () => clearInterval(reloj) };
}
