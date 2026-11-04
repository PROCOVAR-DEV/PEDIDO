/**
 * La zona horaria de Cuba, sin fiarse de los datos de zonas horarias del navegador.
 *
 * Cuba NO atrasó el reloj el 01/11/2026: sigue en UTC-4 hasta el 07/11/2027 (tzdata 2026f, del 27/10/2026).
 * Un navegador con datos anteriores contesta «America/Havana» = UTC-5 y enseña TODAS las horas una hora
 * antes —lo vimos el 04/11/2026 en el historial de los pedidos—, y el «hoy» y el corte de las 18:30
 * cambian una hora tarde. Dentro de esa ventana se usa la zona fija de UTC-4; fuera, la de siempre.
 *
 * ponytail: caduca el 07/11/2027. Para entonces los navegadores ya traen la tzdata nueva y esto se puede
 * borrar dejando «America/Havana».
 */
const DESDE = Date.UTC(2026, 2, 8, 5); // 08/03/2026 05:00 UTC: empieza el horario de verano de 2026
const HASTA = Date.UTC(2027, 10, 7, 5); // 07/11/2027 05:00 UTC: vuelve a UTC-5

export function zonaCuba(cuando: Date | number | string = Date.now()): string {
  const t = new Date(cuando).getTime();

  return t >= DESDE && t < HASTA ? "Etc/GMT+4" : "America/Havana";
}
