/** A copy of the server's ZIP reader (packages/engine/src/parsers/zip.ts), so the Exporter opens CI artifact archives with the same limits without bundling any server code. Keep the two in step. */
/**
 * ZIP archives of file uploads, read in memory (nothing is written to disk, nothing is run).
 *
 * Safe limits, every one refusing the whole archive with a clear message:
 *   - at most ZIP_MAX_ENTRIES files;
 *   - at most ZIP_MAX_TOTAL bytes uncompressed in all, ZIP_MAX_ENTRY per file; the declared size of each
 *     entry is checked against what inflating actually produces (an entry that inflates beyond its
 *     declared size, or beyond the limits, is refused while inflating, never after);
 *   - a compression ratio above ZIP_MAX_RATIO is refused (zip bombs);
 *   - names with "..", an absolute path, a drive letter, a backslash path or a NUL are refused
 *     (zip-slip); directories, symbolic links and the macOS __MACOSX / ._ files are skipped;
 *   - a zip inside the zip is not opened (no nesting); encrypted entries, ZIP64 and compression methods
 *     other than stored and deflate are refused.
 */
import { inflateRawSync } from 'node:zlib';

export const ZIP_MAX_ENTRIES = 100;
export const ZIP_MAX_ENTRY = 50 * 1024 * 1024;
export const ZIP_MAX_TOTAL = 100 * 1024 * 1024;
export const ZIP_MAX_RATIO = 200;

export class ZipError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ZipEntry { name: string; data: Buffer }

export const isZip = (b: Buffer) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06);

/** A safe entry name, or a reason it is refused. */
export function unsafeName(name: string): string | null {
  if (!name || name.includes('\0')) return 'an empty name or a NUL character';
  if (name.includes('\\')) return 'a backslash in the path';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'an absolute path';
  if (name.split('/').some((p) => p === '..')) return 'a ".." path (zip-slip)';
  if (name.length > 400) return 'a name longer than 400 characters';
  return null;
}

export function readZip(buf: Buffer, opts: { maxEntries?: number; maxTotal?: number; maxEntry?: number; maxRatio?: number } = {}): { entries: ZipEntry[]; skipped: Array<{ name: string; reason: string }> } {
  const maxEntries = opts.maxEntries ?? ZIP_MAX_ENTRIES;
  const maxTotal = opts.maxTotal ?? ZIP_MAX_TOTAL;
  const maxEntry = opts.maxEntry ?? ZIP_MAX_ENTRY;
  const maxRatio = opts.maxRatio ?? ZIP_MAX_RATIO;
  // End of central directory: the last "PK\x05\x06" within the final 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError(400, 'The zip file is damaged or not a zip (no central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError(400, 'ZIP64 archives are not supported: zip fewer or smaller files');
  if (count > maxEntries) throw new ZipError(413, `The zip has ${count} files: at most ${maxEntries}`);
  if (cdOffset + cdSize > buf.length) throw new ZipError(400, 'The zip file is damaged (central directory out of range)');
  const entries: ZipEntry[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError(400, 'The zip file is damaged (bad central directory entry)');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString((flags & 0x800) ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;
    const bad = unsafeName(name);
    if (bad) throw new ZipError(400, `The zip contains "${name.slice(0, 100)}", with ${bad}: refused`);
    if (name.endsWith('/')) continue;
    const base = name.split('/').pop()!;
    if (name.startsWith('__MACOSX/') || base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db') { skipped.push({ name, reason: 'system file' }); continue; }
    if (((extAttr >>> 16) & 0o170000) === 0o120000) { skipped.push({ name, reason: 'a symbolic link (not followed)' }); continue; }
    if (flags & 0x1) throw new ZipError(400, `"${name}" is encrypted: send the files without a password`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError(400, 'ZIP64 archives are not supported');
    if (method !== 0 && method !== 8) throw new ZipError(400, `"${name}" uses an unsupported compression method (${method}): use deflate`);
    if (usize > maxEntry) throw new ZipError(413, `"${name}" is ${Math.round(usize / 1024 / 1024)} MB uncompressed: at most ${maxEntry / 1024 / 1024} MB per file`);
    if (total + usize > maxTotal) throw new ZipError(413, `The zip expands to more than ${maxTotal / 1024 / 1024} MB: refused`);
    if (csize > 0 && usize / csize > maxRatio) throw new ZipError(413, `"${name}" expands ${Math.round(usize / csize)} times (a zip bomb?): refused`);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(400, 'The zip file is damaged (bad local header)');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    if (start + csize > buf.length) throw new ZipError(400, 'The zip file is damaged (entry out of range)');
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) {
      if (csize !== usize) throw new ZipError(400, `"${name}": stored size does not match`);
      data = Buffer.from(raw);
    } else {
      try {
        // Never more than the declared size (+1 byte to notice a lie), whatever the stream says.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(usize, maxEntry) + 1) });
      } catch (e: any) {
        if (e?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|larger than/i.test(e?.message ?? '')) throw new ZipError(413, `"${name}" expands beyond its declared size: refused`);
        throw new ZipError(400, `"${name}" could not be decompressed`);
      }
      if (data.length !== usize) throw new ZipError(413, `"${name}" expands beyond its declared size: refused`);
    }
    total += data.length;
    if (isZip(data)) { skipped.push({ name, reason: 'a zip inside the zip is not opened (unpack it first)' }); continue; }
    entries.push({ name, data });
  }
  return { entries, skipped };
}
