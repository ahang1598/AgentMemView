import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Minimal ustar tar implementation (subset): regular files only, names <=100
 * chars. Enough for .mempack bundles without adding a dependency.
 */

interface TarEntryHeader {
  name: string;
  size: number;
}

export interface TarEntry {
  name: string;
  data: Buffer;
}

const BLOCK = 512;

function writeHeader(name: string, size: number): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, Math.min(name.length, 100), "utf8");
  block.write("0000644", 100, 7, "utf8"); // mode
  block.write("0000000", 108, 7, "utf8"); // uid
  block.write("0000000", 116, 7, "utf8"); // gid
  block.write(size.toString(8).padStart(11, "0"), 124, 11, "utf8");
  block.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0"),
    136,
    11,
    "utf8",
  );
  block.write("        ", 148, 8, "utf8"); // checksum placeholder (spaces)
  block.write("0", 156, 1, "utf8"); // typeflag: regular file
  block.write("ustar", 257, 5, "utf8");
  block.write("00", 263, 2, "utf8");
  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  block.write(sum.toString(8).padStart(6, "0"), 148, 6, "utf8");
  block.write("\0", 154, 1, "utf8");
  return block;
}

/** Pack entries into a gzipped tar archive. */
export function packTarGz(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(writeHeader(entry.name, entry.data.length));
    parts.push(entry.data);
    const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
    if (pad > 0) {
      parts.push(Buffer.alloc(pad));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // end-of-archive
  return gzipSync(Buffer.concat(parts));
}

function readString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? length : nul).toString("utf8");
}

function parseOctal(buffer: Buffer, offset: number, length: number): number {
  const raw = readString(buffer, offset, length).trim();
  return raw.length === 0 ? 0 : Number.parseInt(raw, 8);
}

/** Unpack a gzipped tar archive; returns regular-file entries. */
export function unpackTarGz(archive: Buffer): TarEntry[] {
  const data = gunzipSync(archive);
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= data.length) {
    const block = data.subarray(offset, offset + BLOCK);
    if (block.every((b) => b === 0)) {
      break;
    }
    const header: TarEntryHeader = {
      name: readString(block, 0, 100),
      size: parseOctal(block, 124, 12),
    };
    offset += BLOCK;
    const content = Buffer.from(data.subarray(offset, offset + header.size));
    entries.push({ name: header.name, data: content });
    offset += header.size;
    offset += (BLOCK - (header.size % BLOCK)) % BLOCK;
  }
  return entries;
}
