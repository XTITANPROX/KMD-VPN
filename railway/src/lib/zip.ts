// Minimal ZIP reader (stored + deflate) used to unpack the Xray-core release
// archive without pulling in a native dependency.

import zlib from "node:zlib";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("فایل ZIP معتبر نیست (EOCD پیدا نشد)");
}

function listEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, size, offset: localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.offset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error("هدر فایل ZIP خراب است");
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`روش فشرده‌سازی پشتیبانی نمی‌شود: ${entry.method}`);
}

export function unzipAll(buffer: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const entry of listEntries(buffer)) {
    if (entry.name.endsWith("/")) continue;
    out.set(entry.name, readEntry(buffer, entry));
  }
  return out;
}

/** Extracts a single member (searched by basename). */
export function unzipFile(buffer: Buffer, basename: string): Buffer | null {
  for (const entry of listEntries(buffer)) {
    const name = entry.name.split("/").pop();
    if (name === basename) return readEntry(buffer, entry);
  }
  return null;
}

export function unzipList(buffer: Buffer): string[] {
  return listEntries(buffer).map((entry) => entry.name);
}
