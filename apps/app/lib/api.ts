/** Small helpers for the JSON API that `postrun` (the CLI and review app) calls. */

import { ShareError } from "./shares";

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function apiError(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

export function unauthorized(): Response {
  return json(
    { error: "not_signed_in", message: "This computer isn't signed in to Postrun, or its sign-in was removed. Run: postrun login" },
    401,
    { "www-authenticate": 'Bearer realm="postrun"' },
  );
}

export function fromError(e: unknown): Response {
  if (e instanceof ShareError) return apiError(e.status, e.code, e.message);
  console.error(e);
  return apiError(500, "server_error", "Something went wrong on app.postrun.app. Try again in a minute.");
}

/** Read a request body, refusing it as soon as it passes `limit` bytes instead of buffering all of it. */
export async function readBody(req: Request, limit: number): Promise<Buffer | undefined> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit) return undefined;
  if (!req.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
