/* ==========================================================================
   DAYMATE — repeat rules (pure functions: no DOM, no network, easy to test)
   Rules: '' (never) · daily · weekly · monthly · yearly   (dates are 'YYYY-MM-DD')
   Monthly/yearly clamp to the end of short months (31st → 28th/30th) and the
   original day is kept, so a "31st" task returns to the 31st the next month.
   ========================================================================== */
const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const fmt = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
const dim = (y, m) => new Date(y, m, 0).getDate();               // days in month (m is 1-12)
const utcDay = (s) => { const { y, m, d } = parse(s); return Date.UTC(y, m - 1, d) / 86400000; };

export const diffDays = (a, b) => Math.round(utcDay(a) - utcDay(b));
export function addDays(s, n) { const t = new Date((utcDay(s) + n) * 86400000); return fmt({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }); }

/** The date `n` repeats after `start` (n ≥ 0), always computed from the original day. */
export function nth(start, rule, n) {
  if (n <= 0) return start;
  const { y, m, d } = parse(start);
  if (rule === 'daily') return addDays(start, n);
  if (rule === 'weekly') return addDays(start, 7 * n);
  if (rule === 'monthly') {
    const idx = (y * 12 + (m - 1)) + n;
    const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
    return fmt({ y: ny, m: nm, d: Math.min(d, dim(ny, nm)) });
  }
  if (rule === 'yearly') { const ny = y + n; return fmt({ y: ny, m, d: Math.min(d, dim(ny, m)) }); }
  return start;
}

/** First occurrence strictly after `after` (default: strictly after `start`). */
export function nextOccurrence(start, rule, after = start) {
  if (!rule) return '';
  for (let n = 1; n < 5000; n++) { const c = nth(start, rule, n); if (c > after) return c; }
  return '';
}

/** First occurrence on or after `from` (the start date itself counts). */
export function onOrAfter(start, rule, from) {
  if (start >= from || !rule) return start;
  for (let n = 1; n < 5000; n++) { const c = nth(start, rule, n); if (c >= from) return c; }
  return start;
}

/** Does a repeating item that starts on `start` fall on `day`? */
export function occursOn(start, rule, day) {
  if (day < start) return false;
  if (day === start) return true;
  if (!rule) return false;
  if (rule === 'daily') return true;
  if (rule === 'weekly') return diffDays(day, start) % 7 === 0;
  const s = parse(start), t = parse(day);
  if (rule === 'monthly') return t.d === Math.min(s.d, dim(t.y, t.m));
  if (rule === 'yearly') return t.m === s.m && t.d === Math.min(s.d, dim(t.y, t.m));
  return false;
}
