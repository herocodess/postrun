/** Dates and sizes as people say them. Pure, so pages and tests share them. */

const DAY = 86_400_000;

export function relative(d: Date, now = new Date()): string {
  const ms = d.getTime() - now.getTime();
  const future = ms > 0;
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  let s: string;
  if (mins < 1) return future ? "in a moment" : "just now";
  if (mins < 60) s = `${mins} min`;
  else if (abs < DAY) s = `${Math.round(abs / 3_600_000)} h`;
  else {
    const days = Math.round(abs / DAY);
    s = days === 1 ? "1 day" : `${days} days`;
  }
  return future ? `in ${s}` : `${s} ago`;
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}
