/** Dates in filters are IST calendar days (the floors we serve); date-times are taken as given. */
const IST = "+05:30";
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function istRange(from?: string, to?: string) {
  return {
    from: from ? new Date(isDate(from) ? `${from}T00:00:00${IST}` : from) : undefined,
    to: to ? new Date(isDate(to) ? `${to}T23:59:59.999${IST}` : to) : undefined,
  };
}

export const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
