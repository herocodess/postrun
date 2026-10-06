import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export interface NdjsonResult<T = unknown> {
  records: T[];
  /** Number of non-empty lines that failed to parse as JSON. */
  skipped: number;
  /** Total non-empty lines seen. */
  total: number;
  /** 1-based line numbers that were skipped. */
  skipped_lines: number[];
}

const CHUNK = 4 * 1024 * 1024;

/**
 * Call `onLine` for every complete line of a file, reading it in 4 MB chunks so
 * no file is ever held as one string (Node cannot build a string over 512 MB).
 * Starts at byte `from`; a trailing line with no newline yet is left unread.
 * Returns the byte offset just past the last complete line, to resume from.
 */
export function forEachLine(path: string, onLine: (line: string, lineNo: number) => void, from = 0): number {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, size - from)));
    const decoder = new StringDecoder("utf8");
    let pos = from;
    let pending = "";
    let consumed = from;
    let lineNo = 0;
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      const text = pending + decoder.write(buf.subarray(0, n));
      let start = 0;
      let nl = text.indexOf("\n", start);
      while (nl !== -1) {
        const line = text.slice(start, nl);
        consumed += Buffer.byteLength(line, "utf8") + 1;
        lineNo++;
        onLine(line, lineNo);
        start = nl + 1;
        nl = text.indexOf("\n", start);
      }
      pending = text.slice(start);
    }
    return consumed;
  } finally {
    closeSync(fd);
  }
}

/**
 * Read an NDJSON file, skipping malformed lines instead of throwing.
 * hooks.ndjson is known to contain spliced records from concurrent appends,
 * so tolerance is required rather than optional. A final line without a
 * newline is read too (a file written in one go may not end with one).
 */
export function readNdjson<T = unknown>(path: string): NdjsonResult<T> {
  const records: T[] = [];
  const skipped_lines: number[] = [];
  let total = 0;
  const take = (line: string, lineNo: number) => {
    if (line.trim() === "") return;
    total++;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      skipped_lines.push(lineNo);
    }
  };
  let last = 0;
  const end = forEachLine(path, (line, n) => {
    last = n;
    take(line, n);
  });
  // forEachLine leaves an unterminated last line; a whole-file read takes it.
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (end < size) {
      const tail = Buffer.alloc(size - end);
      readSync(fd, tail, 0, tail.length, end);
      take(tail.toString("utf8"), last + 1);
    }
  } finally {
    closeSync(fd);
  }
  return { records, skipped: skipped_lines.length, total, skipped_lines };
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
