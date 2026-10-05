/**
 * Loopback Host header check, shared by every listener Postrun opens.
 *
 * Binding to 127.0.0.1 keeps remote machines out, but not a browser on this
 * machine: a page can point a DNS name at 127.0.0.1 (DNS rebinding) and then
 * read the API as if it were same-origin. The browser still sends that name
 * in the Host header, so refusing any Host that is not a loopback name closes
 * the hole.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True when the Host header names this machine's loopback interface, with or without a port. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  // "[::1]:1234" | "127.0.0.1:1234" | "localhost"
  const name = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0] ?? "";
  return LOOPBACK.has(name);
}
