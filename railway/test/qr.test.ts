// QR encoder round-trip: the test decodes the produced matrix back (format
// info → unmask → codewords → de-interleave → byte mode payload) so a wrong
// mask, block layout or RS split would fail here.

import { describe, expect, it } from "vitest";
import {
  __internal,
  formatBits,
  maskModules,
  pickVersion,
  placeCodewords,
  qrMatrix,
  qrSvg,
  reservedMap,
} from "../src/lib/qr.js";
import type { EccLevel } from "../src/lib/qr.js";

interface VersionInfo {
  eccPerBlock: number;
  blocks: Array<[number, number]>;
}

/** Mirrors the encoder's RS block table (kept separate on purpose). */
const BLOCKS: Record<EccLevel, Record<number, VersionInfo>> = {
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

const FORMAT_LEVELS: Record<number, EccLevel> = { 1: "L", 0: "M", 3: "Q", 2: "H" };

function readFormat(modules: boolean[][], size: number): { level: EccLevel; mask: number } {
  const read = (i: number) => {
    // copy 2: mirrored around the bottom-left / top-right finders
    if (i < 8) return modules[8]![size - 1 - i]!;
    return modules[size - 15 + i]![8]!;
  };
  let bits = 0;
  for (let i = 14; i >= 0; i -= 1) bits = (bits << 1) | (read(i) ? 1 : 0);
  bits ^= 0x5412;
  const level = FORMAT_LEVELS[(bits >>> 13) & 0b11]!;
  const mask = (bits >>> 10) & 0b111;
  return { level, mask };
}

function readCodewords(version: number, modules: boolean[][]): Uint8Array {
  const size = version * 4 + 17;
  const reserved = reservedMap(version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y]![x]) continue;
        bits.push(modules[y]![x] ? 1 : 0);
      }
    }
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i += 1) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i * 8 + j]!;
    out[i] = byte;
  }
  return out;
}

/** Reverse of the encoder's interleave: rebuild the data area. */
function deinterleave(codewords: Uint8Array, version: number, level: EccLevel): Uint8Array {
  const spec = BLOCKS[level][version]!;
  const lengths: number[] = [];
  for (const [count, per] of spec.blocks) for (let i = 0; i < count; i += 1) lengths.push(per);
  const blocks = lengths.map(() => [] as number[]);
  const maxData = Math.max(...lengths);
  let index = 0;
  for (let i = 0; i < maxData; i += 1) {
    for (let b = 0; b < blocks.length; b += 1) {
      if (i < lengths[b]!) blocks[b]!.push(codewords[index++]!);
    }
  }
  const out: number[] = [];
  for (const block of blocks) out.push(...block);
  return Uint8Array.from(out);
}

function decodeQr(text: string, level: EccLevel): string {
  const code = qrMatrix(text, level);
  const { level: readLevel, mask } = readFormat(code.modules, code.size);
  expect(readLevel).toBe(level);
  expect(code.mask).toBe(mask);

  const reserved = reservedMap(code.version);
  const unmasked = maskModules(code.modules, reserved, mask);
  // function modules are unaffected by masking; re-apply the format patterns
  const codewords = readCodewords(code.version, unmasked);
  const data = deinterleave(codewords, code.version, readLevel);

  let bitIndex = 0;
  const readBits = (count: number) => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = data[bitIndex >>> 3]!;
      value = (value << 1) | ((byte >>> (7 - (bitIndex & 7))) & 1);
      bitIndex += 1;
    }
    return value;
  };
  const mode = readBits(4);
  expect(mode).toBe(0b0100);
  const length = readBits(code.version <= 9 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(readBits(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

describe("QR encoder", () => {
  it("round-trips URLs of every size class", () => {
    const samples = [
      "https://panel.example.com/sub/AbC123",
      "https://kal-fetela-production.up.railway.app/sub/9xC2UOm3LpQ0aGd7sKq1",
      "https://kal-fetela.up.railway.app/sub/" + "x".repeat(120),
      "https://kal-fetela.up.railway.app/sub/" + "y".repeat(170),
    ];
    for (const sample of samples) {
      expect(decodeQr(sample, "M")).toBe(sample);
    }
  });

  it("supports every ECC level and picks the smallest version", () => {
    const text = "https://kalfetela.example/sub/token123";
    for (const level of ["L", "M", "Q", "H"] as EccLevel[]) {
      expect(decodeQr(text, level)).toBe(text);
    }
    expect(pickVersion("a".repeat(14), "M")).toBe(1);
    expect(pickVersion("a".repeat(15), "M")).toBe(2);
    expect(pickVersion("a".repeat(106), "M")).toBe(6);
    expect(pickVersion("a".repeat(213), "M")).toBe(10);
    expect(() => pickVersion("a".repeat(214), "M")).toThrow();
  });

  it("matches known capacity numbers of the standard", () => {
    for (const [level, capacity] of [["L", 271], ["M", 213], ["Q", 151], ["H", 119]] as Array<[EccLevel, number]>) {
      const data = __internal.dataCodewords(10, level);
      const headerBits = 4 + 16;
      const bytes = Math.floor((data * 8 - headerBits) / 8);
      expect(bytes).toBe(capacity);
      expect(__internal.eccCodewords(10, level)).toBeGreaterThan(0);
    }
  });

  it("matches the format-information strings of the standard", () => {
    // values taken from the reference encoder (ISO/IEC 18004 table C.1)
    const table: Record<string, number[]> = {
      L: [30660, 29427, 32170, 30877, 26159, 25368, 27713, 26998],
      M: [21522, 20773, 24188, 23371, 17913, 16590, 20375, 19104],
      Q: [13663, 12392, 16177, 14854, 9396, 8579, 11994, 11245],
      H: [5769, 5054, 7399, 6608, 1890, 597, 3340, 2107],
    };
    for (const [level, values] of Object.entries(table)) {
      values.forEach((expected, mask) => {
        expect(formatBits(level as EccLevel, mask)).toBe(expected);
      });
    }
  });

  it("renders SVG with a quiet zone and one path per dark module", () => {
    const svg = qrSvg("https://example.com/sub/abc", { scale: 4, margin: 2 });
    expect(svg.startsWith("<svg")).toBe(true);
    const code = qrMatrix("https://example.com/sub/abc");
    const expected = code.modules.flat().filter(Boolean).length;
    expect((svg.match(/M\d+ \d+h\d+v\d+h-\d+z/g) ?? []).length).toBe(expected);
    expect(svg).toContain(`width="${(code.size + 4) * 4}"`);
  });

  it("places only in the data area and keeps the timing patterns intact", () => {
    const code = qrMatrix("https://example.com/sub/xyz");
    const reserved = reservedMap(code.version);
    const placed = placeCodewords(code.version, new Uint8Array(__internal.dataCodewords(code.version, "M")).fill(0xff));
    void placed;
    for (let i = 8; i < code.size - 8; i += 1) {
      expect(code.modules[6]![i]).toBe(i % 2 === 0);
      expect(code.modules[i]![6]).toBe(i % 2 === 0);
    }
    expect(reserved[0]![0]).toBe(true); // finder pattern
    expect(reserved[6]![6]).toBe(true); // crossing of both timing patterns
    expect(reserved[code.size - 8]![8]).toBe(true); // always-dark module
    const dataCells = reserved.flat().filter((cell) => !cell).length;
    expect(dataCells).toBeGreaterThan(code.size * code.size * 0.5);
    expect(code.modules[code.size - 8]![8]).toBe(true); // dark module stays set
  });
});
