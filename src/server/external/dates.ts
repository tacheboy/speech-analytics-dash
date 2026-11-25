const IST_OFFSET_MIN = 330;

/** Wall-clock time in IST → Date, or null when the components don't form a real date. */
function istDate(y: number, mo: number, d: number, h = 9, mi = 0, s = 0): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null; // e.g. 31-02-2026
  return new Date(utc - IST_OFFSET_MIN * 60_000);
}

const TIME = String.raw`(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?`;
const YMD = new RegExp(String.raw`^(\d{4})[-/](\d{1,2})[-/](\d{1,2})${TIME}$`);
const DMY = new RegExp(String.raw`^(\d{1,2})[-/](\d{1,2})[-/](\d{4})${TIME}$`);
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Call `date` input, per the docs: YYYY-MM-DD (→ 09:00 IST), ISO-8601 date-time, and
 * YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY with optional HH:mm[:ss]. Times without a zone are IST.
 */
export function parseCallDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  if (HAS_ZONE.test(s) && /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const ymd = s.match(YMD);
  if (ymd) {
    const [, y, mo, d, h, mi, sec] = ymd;
    return istDate(+y, +mo, +d, h ? +h : 9, mi ? +mi : 0, sec ? +sec : 0);
  }
  const dmy = s.match(DMY);
  if (dmy) {
    const [, d, mo, y, h, mi, sec] = dmy;
    return istDate(+y, +mo, +d, h ? +h : 9, mi ? +mi : 0, sec ? +sec : 0);
  }
  return null;
}

/** YYYY-MM-DD of an instant in IST. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
