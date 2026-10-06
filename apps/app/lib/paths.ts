/** Only paths on this site: never `//evil.example` or `https://…`, so ?next= can't send anyone elsewhere. */
export function safeNext(next: string | null | undefined, fallback = "/shares"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n\t]/.test(next)) return fallback;
  return next;
}
