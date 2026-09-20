/**
 * Heatmap intensity. Levels are quartiles of the ACTIVE days in view, so a
 * heavy year does not flatten a light one. Shared by the dashboard heatmap and
 * the SVG card so both shade identically.
 *
 * Level 0 = no activity, 1 (lightest) to 4 (strongest). The top level starts AT
 * the third quartile (not above it), so it stays reachable when there are only
 * a few active days.
 */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function makeIntensity(activeMinutes: number[]): (minutes: number) => HeatLevel {
  const values = activeMinutes.filter((m) => m > 0).sort((a, b) => a - b);
  const cut = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
  const [q1, q2, q3] = values.length ? [cut(0.25), cut(0.5), cut(0.75)] : [0, 0, 0];
  return (m) => (m <= 0 ? 0 : m <= q1 ? 1 : m <= q2 ? 2 : m < q3 ? 3 : 4);
}
