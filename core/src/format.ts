/**
 * Number and date formatting shared by the web app and the SVG card, so both
 * always print the same thing. Built on Intl only (no DOM). Always en-US so a
 * server and a browser produce identical output.
 */

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** "142.3" for hero numbers. */
export function fmtHours(seconds: number): string {
  return (seconds / 3600).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "1h 23m", "12m", "45s". */
export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** "Mar 4, 2026" in the given zone, or "Never". */
export function fmtDate(ms: number | null, timeZone: string): string {
  if (ms === null) return "Never";
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone });
}

/** "Mar 4, 2026" from a "YYYY-MM-DD" key (no time zone shift). */
export function fmtDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}

/** "March 2026" from "YYYY-MM". */
export function fmtMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}
