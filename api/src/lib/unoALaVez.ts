/**
 * Un trabajo que no se vuelve a encolar mientras el anterior no haya terminado.
 *
 * Cada carril de facturación (el rápido, la pasada completa, el repaso del mes) tiene el suyo, y cada
 * uno va por su cuenta: no se esperan entre sí. Lo que NO puede pasar es que un carril lento se vaya
 * acumulando trabajos detrás de sí mismo. Si el reloj dispara y el anterior sigue en marcha, ese
 * disparo se SALTA (devuelve `null`) en vez de ponerse en cola.
 */
export function unoALaVez<T>(trabajo: () => Promise<T>): () => Promise<T | null> {
  let enCurso = false;

  return async () => {
    if (enCurso) return null;
    enCurso = true;

    try {
      return await trabajo();
    } finally {
      enCurso = false;
    }
  };
}
