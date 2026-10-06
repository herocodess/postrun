import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEachLine, readNdjson } from "./ndjson.js";

describe("chunked ndjson reading", () => {
  const dir = mkdtempSync(join(tmpdir(), "postrun-ndjson-"));

  it("reads lines that span the 4 MB chunk boundary, including multi-byte characters split across it", () => {
    const p = join(dir, "big.ndjson");
    const big = "é".repeat(3 * 1024 * 1024); // 6 MB of two-byte characters: crosses a chunk edge mid-character
    writeFileSync(p, `${JSON.stringify({ a: 1 })}\n${JSON.stringify({ big })}\n{bad json\n${JSON.stringify({ c: 3 })}`);
    const r = readNdjson<{ a?: number; big?: string; c?: number }>(p);
    expect(r.records).toHaveLength(3);
    expect(r.records[1]!.big).toBe(big);
    expect(r.records[2]!.c).toBe(3); // last line without a newline is still read
    expect(r.skipped_lines).toEqual([3]);
  });

  it("resumes from a byte offset and leaves an unfinished last line for later", () => {
    const p = join(dir, "tail.ndjson");
    writeFileSync(p, '{"n":1}\n{"n":2}\n{"n":');
    const seen: string[] = [];
    const off = forEachLine(p, (l) => seen.push(l));
    expect(seen).toEqual(['{"n":1}', '{"n":2}']);
    appendFileSync(p, '3}\n{"n":"ü"}\n');
    const more: string[] = [];
    const off2 = forEachLine(p, (l) => more.push(l), off);
    expect(more).toEqual(['{"n":3}', '{"n":"ü"}']);
    expect(forEachLine(p, () => expect.fail("nothing new"), off2)).toBe(off2);
  });
});
