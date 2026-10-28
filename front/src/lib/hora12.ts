/** Minutos desde medianoche de una hora «HH:MM». */
export const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);

  return h * 60 + (m || 0);
};

/** «HH:MM» de unos minutos desde medianoche (acotados al mismo día). */
export const deMinutos = (min: number) => {
  const t = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));

  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * Cuándo es un instante, como lo diría una persona (hora de Cuba): «a las 8:00 AM» si es
 * hoy, «mañana a las 8:00 AM» si es mañana, «el jueves a las 8:00 AM» si es más tarde.
 */
export const cuandoEnCuba = (iso: string) => {
  const dia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Havana",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const t = new Date(iso);
  const dias = Math.round(
    (new Date(`${dia(t)}T12:00:00Z`).getTime() -
      new Date(`${dia(new Date())}T12:00:00Z`).getTime()) /
      86_400_000,
  );
  const hhmm = new Intl.DateTimeFormat("es-ES", {
    timeZone: "America/Havana",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(t);
  const hora = `a las ${hora12(hhmm)}`;

  if (dias <= 0) return hora;
  if (dias === 1) return `mañana ${hora}`;

  const semana = new Intl.DateTimeFormat("es-ES", {
    timeZone: "America/Havana",
    weekday: "long",
  }).format(t);

  return `el ${semana} ${hora}`;
};

/** «15:00» → «3:00 PM», como la dice el usuario. */
export const hora12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);

  if (Number.isNaN(h)) return hhmm;

  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
