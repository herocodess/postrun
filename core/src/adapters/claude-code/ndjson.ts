import { readFileSync } from "node:fs";

export interface NdjsonResult<T = unknown> {
  records: T[];
  /** Number of non-empty lines that failed to parse as JSON. */
  skipped: number;
  /** Total non-empty lines seen. */
  total: number;
  /** 1-based line numbers that were skipped. */
  skipped_lines: number[];
}

/**
 * Read an NDJSON file, skipping malformed lines instead of throwing.
 * hooks.ndjson is known to contain spliced records from concurrent appends,
 * so tolerance is required rather than optional.
 */
export function readNdjson<T = unknown>(path: string): NdjsonResult<T> {
  const text = readFileSync(path, "utf8");
  return parseNdjson<T>(text);
}

export function parseNdjson<T = unknown>(text: string): NdjsonResult<T> {
  const records: T[] = [];
  const skipped_lines: number[] = [];
  let total = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    total++;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      skipped_lines.push(i + 1);
    }
  }
  return { records, skipped: skipped_lines.length, total, skipped_lines };
}
