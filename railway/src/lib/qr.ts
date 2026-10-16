// Minimal QR Code encoder (byte mode, versions 1–10, ECC level L/M/Q/H).
// Written in-house so the panel ships QR codes without any extra dependency.
// Reference: ISO/IEC 18004; verified by the round-trip decoder in test/qr.test.ts.

/* ------------------------------ GF(256) math ----------------------------- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < degree) result[j] ^= result[j + 1]!;
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const degree = divisor.length;
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0]!;
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i += 1) result[i] ^= gfMul(divisor[i]!, factor);
  }
  return result;
}

/* ------------------------------ spec tables ----------------------------- */

export type EccLevel = "L" | "M" | "Q" | "H";

const ECC_FORMAT_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

interface BlockSpec {
  /** data codewords per block in group 1, group 2 (may be 0) */
  blocks: Array<[count: number, dataCodewords: number]>;
  eccPerBlock: number;
}

/** RS block structure per version + ECC level (versions 1–10). */
const BLOCKS: Record<EccLevel, Record<number, BlockSpec>> = {
  L: {
    1: { blocks: [[1, 19]], eccPerBlock: 7 },
    2: { blocks: [[1, 34]], eccPerBlock: 10 },
    3: { blocks: [[1, 55]], eccPerBlock: 15 },
    4: { blocks: [[1, 80]], eccPerBlock: 20 },
    5: { blocks: [[1, 108]], eccPerBlock: 26 },
    6: { blocks: [[2, 68]], eccPerBlock: 18 },
    7: { blocks: [[2, 78]], eccPerBlock: 20 },
    8: { blocks: [[2, 97]], eccPerBlock: 24 },
    9: { blocks: [[2, 116]], eccPerBlock: 30 },
    10: { blocks: [[2, 68], [2, 69]], eccPerBlock: 18 },
  },
  M: {
    1: { blocks: [[1, 16]], eccPerBlock: 10 },
    2: { blocks: [[1, 28]], eccPerBlock: 16 },
    3: { blocks: [[1, 44]], eccPerBlock: 26 },
    4: { blocks: [[2, 32]], eccPerBlock: 18 },
    5: { blocks: [[2, 43]], eccPerBlock: 24 },
    6: { blocks: [[4, 27]], eccPerBlock: 16 },
    7: { blocks: [[4, 31]], eccPerBlock: 18 },
    8: { blocks: [[2, 38], [2, 39]], eccPerBlock: 22 },
    9: { blocks: [[3, 36], [2, 37]], eccPerBlock: 22 },
    10: { blocks: [[4, 43], [1, 44]], eccPerBlock: 26 },
  },
  Q: {
    1: { blocks: [[1, 13]], eccPerBlock: 13 },
    2: { blocks: [[1, 22]], eccPerBlock: 22 },
    3: { blocks: [[2, 17]], eccPerBlock: 18 },
    4: { blocks: [[2, 24]], eccPerBlock: 26 },
    5: { blocks: [[2, 15], [2, 16]], eccPerBlock: 18 },
    6: { blocks: [[4, 19]], eccPerBlock: 24 },
    7: { blocks: [[2, 14], [4, 15]], eccPerBlock: 18 },
    8: { blocks: [[4, 18], [2, 19]], eccPerBlock: 22 },
    9: { blocks: [[4, 16], [4, 17]], eccPerBlock: 20 },
    10: { blocks: [[6, 19], [2, 20]], eccPerBlock: 24 },
  },
  H: {
    1: { blocks: [[1, 9]], eccPerBlock: 17 },
    2: { blocks: [[1, 16]], eccPerBlock: 28 },
    3: { blocks: [[2, 13]], eccPerBlock: 22 },
    4: { blocks: [[4, 9]], eccPerBlock: 16 },
    5: { blocks: [[2, 11], [2, 12]], eccPerBlock: 22 },
    6: { blocks: [[4, 15]], eccPerBlock: 28 },
    7: { blocks: [[4, 13], [1, 14]], eccPerBlock: 26 },
    8: { blocks: [[4, 14], [2, 15]], eccPerBlock: 26 },
    9: { blocks: [[4, 12], [4, 13]], eccPerBlock: 24 },
    10: { blocks: [[6, 15], [2, 16]], eccPerBlock: 28 },
  },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** Version information bit strings for versions 7–10 (18 bits). */
const VERSION_BITS: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

function dataCodewords(version: number, level: EccLevel): number {
  const spec = BLOCKS[level][version]!;
  return spec.blocks.reduce((sum, [count, per]) => sum + count * per, 0);
}

function eccCodewords(version: number, level: EccLevel): number {
  const spec = BLOCKS[level][version]!;
  return spec.blocks.reduce((sum, [count]) => sum + count, 0) * spec.eccPerBlock;
}

/* ------------------------------- encoding -------------------------------- */

function toUtf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Smallest version (1–10) that fits the payload in byte mode. */
export function pickVersion(text: string, level: EccLevel = "M"): number {
  const bytes = toUtf8Bytes(text).length;
  for (let version = 1; version <= 10; version += 1) {
    const capacityBits = dataCodewords(version, level) * 8;
    const headerBits = 4 + (version <= 9 ? 8 : 16);
    if (headerBits + bytes * 8 <= capacityBits) return version;
  }
  throw new Error("متن برای تولید QR طولانی است (حداکثر نسخه ۱۰ پشتیبانی می‌شود)");
}

function buildCodewords(text: string, version: number, level: EccLevel): Uint8Array {
  const bytes = toUtf8Bytes(text);
  const capacity = dataCodewords(version, level);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const capacityBits = capacity * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  push(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  let pad = 0xec;
  while (codewords.length < capacity) {
    codewords.push(pad);
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return Uint8Array.from(codewords);
}

function interleave(data: Uint8Array, version: number, level: EccLevel): Uint8Array {
  const spec = BLOCKS[level][version]!;
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  const divisor = rsDivisor(spec.eccPerBlock);
  let offset = 0;
  for (const [count, per] of spec.blocks) {
    for (let i = 0; i < count; i += 1) {
      const block = data.subarray(offset, offset + per);
      offset += per;
      dataBlocks.push(block);
      eccBlocks.push(rsRemainder(block, divisor));
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < spec.eccPerBlock; i += 1) {
    for (const block of eccBlocks) out.push(block[i]!);
  }
  return Uint8Array.from(out);
}

/* -------------------------------- matrix --------------------------------- */

/**
 * Map of function modules (finders, timing, alignment, format/version areas).
 * `true` marks a module that is not part of the data area.
 */
export function reservedMap(version: number): boolean[][] {
  const size = version * 4 + 17;
  const reserved = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const mark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    reserved[y]![x] = true;
  };
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  const positions = ALIGNMENT[version]!;
  for (const cy of positions) {
    for (const cx of positions) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(cx + dx, cy + dy);
    }
  }
  for (let i = 0; i <= 8; i += 1) {
    mark(i, 8);
    mark(8, i);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return reserved;
}

function drawFunctionPatterns(version: number): boolean[][] {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y]![x] = dark;
  };
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    set(i, 6, dark);
    set(6, i, dark);
  }
  const positions = ALIGNMENT[version]!;
  for (const cy of positions) {
    for (const cx of positions) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, distance !== 1);
        }
      }
    }
  }
  if (version >= 7) {
    const bits = VERSION_BITS[version]!;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }
  return modules;
}

/** Places the interleaved codewords inside the data area (zig-zag order). */
export function placeCodewords(version: number, codewords: Uint8Array): boolean[][] {
  const size = version * 4 + 17;
  const reserved = reservedMap(version);
  const modules = drawFunctionPatterns(version);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y]![x] || bitIndex >= codewords.length * 8) continue;
        const byte = codewords[bitIndex >>> 3]!;
        modules[y]![x] = ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0;
        bitIndex += 1;
      }
    }
  }
  return modules;
}

function buildMatrix(version: number, level: EccLevel, codewords: Uint8Array): { modules: boolean[][]; mask: number } {
  const reserved = reservedMap(version);
  const size = version * 4 + 17;
  const base = placeCodewords(version, codewords);
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules = base;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = maskModules(base, reserved, mask);
    writeFormat(candidate, size, level, mask);
    const penalty = penaltyScore(candidate, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = candidate;
    }
  }
  return { modules: bestModules, mask: bestMask };
}

/** Applies one of the eight QR masks to the data area only. */
export function maskModules(modules: boolean[][], reserved: boolean[][], mask: number): boolean[][] {
  const size = modules.length;
  const out = modules.map((row) => [...row]);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (reserved[y]![x]) continue;
      let invert = false;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) out[y]![x] = !out[y]![x];
    }
  }
  return out;
}



export function formatBits(level: EccLevel, mask: number): number {
  const data = (ECC_FORMAT_BITS[level] << 3) | mask;
  // BCH(15,5) remainder with the generator polynomial x^10+x^8+x^5+x^4+x^2+x+1
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/**
 * Writes both copies of the 15-bit format information.
 * Bit i (0 = LSB) sits at column 8 / row i for i ≤ 5 and the other copy is
 * mirrored around the bottom-left & top-right finders (ISO/IEC 18004 fig. 25).
 */
export function writeFormat(modules: boolean[][], size: number, level: EccLevel, mask: number): void {
  const bits = formatBits(level, mask);
  const get = (i: number) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i += 1) modules[i]![8] = get(i);
  modules[7]![8] = get(6);
  modules[8]![8] = get(7);
  modules[8]![7] = get(8);
  for (let i = 9; i < 15; i += 1) modules[8]![14 - i] = get(i);
  for (let i = 0; i < 8; i += 1) modules[8]![size - 1 - i] = get(i);
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i]![8] = get(i);
  modules[size - 8]![8] = true;
}

function penaltyScore(modules: boolean[][], size: number): number {
  let penalty = 0;
  // rule 1: runs of 5+ same-colour modules
  for (let y = 0; y < size; y += 1) {
    let run = 1;
    for (let x = 1; x < size; x += 1) {
      if (modules[y]![x] === modules[y]![x - 1]) run += 1;
      else {
        if (run >= 5) penalty += run - 2;
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }
  for (let x = 0; x < size; x += 1) {
    let run = 1;
    for (let y = 1; y < size; y += 1) {
      if (modules[y]![x] === modules[y - 1]![x]) run += 1;
      else {
        if (run >= 5) penalty += run - 2;
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }
  // rule 2: 2x2 blocks
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const value = modules[y]![x];
      if (value === modules[y]![x + 1] && value === modules[y + 1]![x] && value === modules[y + 1]![x + 1]) penalty += 3;
    }
  }
  // rule 3: finder-like patterns
  const pattern = [true, false, true, true, true, false, true];
  const matches = (get: (i: number) => boolean, start: number) => {
    for (let i = 0; i < 7; i += 1) if (get(start + i) !== pattern[i]) return false;
    return true;
  };
  const quiet = (get: (i: number) => boolean, start: number, length: number) => {
    for (let i = start; i < start + 4; i += 1) {
      if (i < 0 || i >= length) continue;
      if (get(i)) return false;
    }
    return true;
  };
  for (let y = 0; y < size; y += 1) {
    const get = (i: number) => modules[y]![i] ?? false;
    for (let x = 0; x + 7 <= size; x += 1) {
      if (!matches(get, x)) continue;
      if (quiet(get, x - 4, size) || quiet(get, x + 7, size)) penalty += 40;
    }
  }
  for (let x = 0; x < size; x += 1) {
    const get = (i: number) => modules[i]?.[x] ?? false;
    for (let y = 0; y + 7 <= size; y += 1) {
      if (!matches(get, y)) continue;
      if (quiet(get, y - 4, size) || quiet(get, y + 7, size)) penalty += 40;
    }
  }
  // rule 4: dark module ratio
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  const percent = (dark / (size * size)) * 100;
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return penalty;
}

/* -------------------------------- public --------------------------------- */

export interface QrCode {
  size: number;
  version: number;
  mask: number;
  level: EccLevel;
  modules: boolean[][];
}

export function qrMatrix(text: string, level: EccLevel = "M"): QrCode {
  if (!text) throw new Error("متن خالی برای QR");
  const version = pickVersion(text, level);
  const codewords = interleave(buildCodewords(text, version, level), version, level);
  const { modules, mask } = buildMatrix(version, level, codewords);
  return { size: modules.length, version, mask, level, modules };
}

export interface QrSvgOptions {
  scale?: number;
  margin?: number;
  dark?: string;
  light?: string;
}

/** Renders a QR code as a standalone SVG document. */
export function qrSvg(text: string, options: QrSvgOptions = {}): string {
  const { scale = 6, margin = 2, dark = "#0b1220", light = "#ffffff" } = options;
  const code = qrMatrix(text);
  const dimension = (code.size + margin * 2) * scale;
  const cells: string[] = [];
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (!code.modules[y]![x]) continue;
      cells.push(`M${(x + margin) * scale} ${(y + margin) * scale}h${scale}v${scale}h-${scale}z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges" role="img" aria-label="QR">
<rect width="${dimension}" height="${dimension}" fill="${light}"/>
<path d="${cells.join("")}" fill="${dark}"/>
</svg>`;
}

/** Data-URI variant, handy for `img src` inside HTML pages. */
export function qrDataUri(text: string, options: QrSvgOptions = {}): string {
  return `data:image/svg+xml;base64,${Buffer.from(qrSvg(text, options), "utf8").toString("base64")}`;
}

export const __internal = { dataCodewords, eccCodewords, rsDivisor, rsRemainder, buildCodewords, interleave };
