import { format, formatDistanceToNow } from "date-fns";

export const fmtDuration = (sec: number | null | undefined) => {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};
export const fmtDate = (d: string | Date) => format(new Date(d), "d MMM yyyy");
export const fmtDateTime = (d: string | Date) => format(new Date(d), "d MMM yyyy, h:mm a");
export const fmtAgo = (d: string | Date) => formatDistanceToNow(new Date(d), { addSuffix: true });
export const fmtPct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${v.toFixed(digits)}%`);
export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
export const fmtInr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
/** "Ananya Bhat" → "Ananya B." — compact but unambiguous in chips. */
export const shortName = (name: string) => { const [f, ...r] = name.split(" "); return r.length ? `${f} ${r.at(-1)![0]}.` : f; };
