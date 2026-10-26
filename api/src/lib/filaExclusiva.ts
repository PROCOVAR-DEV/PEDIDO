/**
 * Una fila de trabajos que corren DE UNO EN UNO, en el orden en que llegan.
 *
 * Para la facturación: la pasada completa (cada 3 horas) y el repaso del mes (dos veces al día) son
 * trabajos pesados contra Ventra y no deben correr a la vez. El carril rápido NO entra en esta fila:
 * tiene que seguir cada 30 segundos aunque uno de los pesados esté en marcha.
 *
 * Si un trabajo falla, el siguiente corre igual; el fallo se lo lleva quien lo pidió.
 */
export function crearFilaExclusiva() {
  let cola: Promise<unknown> = Promise.resolve();

  return function enFila<T>(trabajo: () => Promise<T>): Promise<T> {
    const resultado = cola.then(trabajo, trabajo);

    // La cola sigue aunque este trabajo falle, para no bloquear a los de detrás.
    cola = resultado.catch(() => undefined);

    return resultado;
  };
}
