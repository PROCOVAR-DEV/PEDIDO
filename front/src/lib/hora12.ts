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

/** «15:00» → «3:00 PM», como la dice el usuario. */
export const hora12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);

  if (Number.isNaN(h)) return hhmm;

  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
