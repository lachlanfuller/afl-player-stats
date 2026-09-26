// Small formatting helpers shared by the pages.

const numberFormat = new Intl.NumberFormat("en-AU");

export const fmt = (n) => numberFormat.format(n);

/** Wins, losses and draws as "192–163–2". */
export const record = (wins, losses, draws) => `${wins}–${losses}–${draws}`;

/** "53.8%", or a dash when there is nothing to divide by. */
export const percent = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "–");

/** "2002–2020", or just "2015" for a single season. */
export const span = (first, last) => (first === last ? `${first}` : `${first}–${last}`);

/** "1 game", "357 games". */
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/** ["A"] -> "A", ["A", "B"] -> "A and B", ["A", "B", "C"] -> "A, B and C". */
export function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "2026-09-19" -> "19 September 2026". */
export const longDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
