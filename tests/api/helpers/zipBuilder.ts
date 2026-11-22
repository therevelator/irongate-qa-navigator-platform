import { crc32, deflateRawSync } from 'zlib';

/**
 * A minimal ZIP writer for the upload tests: real archives, plus the hostile ones the reader must
 * refuse (a name with "..", a declared size smaller than the data, encrypted flags, too many entries).
 */
export interface ZipItem {
  name: string;
  data: Buffer | string;
  /** Store instead of deflate. */
  store?: boolean;
  /** Lie about the uncompressed size in both headers (zip bombs announce a small size). */
  declaredSize?: number;
  /** General purpose flags (1 = encrypted). */
  flags?: number;
  /** External attributes (a symbolic link: 0o120777 << 16). */
  externalAttr?: number;
}

export function buildZip(items: ZipItem[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const it of items) {
    const raw = Buffer.isBuffer(it.data) ? it.data : Buffer.from(it.data);
    const comp = it.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(it.name, 'utf8');
    const crc = crc32(raw) >>> 0;
    const usize = it.declaredSize ?? raw.length;
    const method = it.store ? 0 : 8;
    const flags = (it.flags ?? 0) | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(usize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((it.externalAttr ?? 0) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
