// Number / byte / date formatting helpers (Persian-first, with Jalali dates).

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function faNum(value: number | string): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);
}

export function fmtNumber(value: number, fa = false): string {
  const s = new Intl.NumberFormat("en-US").format(Math.round(value));
  return fa ? faNum(s) : s;
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Human readable bytes: 1073741824 -> "1 GB". */
export function fmtBytes(bytes: number | null | undefined, digits = 2): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes <= 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const val = bytes / Math.pow(1024, i);
  const rounded = val >= 100 ? val.toFixed(0) : val.toFixed(digits);
  return `${Number(rounded)} ${UNITS[i]}`;
}

/** pnpm-style GB helpers. */
export function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 * 1024 * 1024);
}
export function bytesToGb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
}

const FA_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.floor(a / b) * b;

const JALAALI_BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

function jalCal(jy: number, withoutLeap = false): { leap: number; gy: number; march: number } {
  const bl = JALAALI_BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = JALAALI_BREAKS[0]!;
  let jump = 0;
  if (jy < jp || jy >= JALAALI_BREAKS[bl - 1]!) throw new Error("Invalid Jalaali year " + jy);
  for (let i = 1; i < bl; i += 1) {
    const jm = JALAALI_BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  let leap = 0;
  if (!withoutLeap) {
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
  }
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function toJalali(date: Date): { jy: number; jm: number; jd: number } {
  return d2j(g2d(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

export function toGregorian(jy: number, jm: number, jd: number): Date {
  const g = d2g(j2d(jy, jm, jd));
  return new Date(g.gy, g.gm - 1, g.gd, 12, 0, 0, 0);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalCal(jy, false).leap === 1 ? 30 : 29;
}

/** 1405/07/23 or with month name: ۲۳ مهر ۱۴۰۵ */
export function jalaliDate(input: Date | number | string | null | undefined, opts: { fa?: boolean; monthName?: boolean } = {}): string {
  if (input === null || input === undefined || input === "") return "—";
  const date = input instanceof Date ? input : new Date(typeof input === "number" ? input : String(input));
  if (Number.isNaN(date.getTime())) return "—";
  const { jy, jm, jd } = toJalali(date);
  const y = opts.fa ? faNum(jy) : String(jy);
  const d = opts.fa ? faNum(jd) : String(jd);
  if (opts.monthName) {
    const m = FA_MONTHS[jm - 1] ?? String(jm);
    return `${d} ${m} ${y}`;
  }
  return `${y}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

export function jalaliDateTime(input: Date | number | string | null | undefined, opts: { fa?: boolean } = {}): string {
  if (input === null || input === undefined || input === "") return "—";
  const date = input instanceof Date ? input : new Date(typeof input === "number" ? input : String(input));
  if (Number.isNaN(date.getTime())) return "—";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${jalaliDate(date, opts)} ${opts.fa ? faNum(time) : time}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function daysLeft(expiry: number | null | undefined): number | null {
  if (!expiry) return null;
  return Math.ceil((expiry * 1000 - Date.now()) / 86_400_000);
}

/** "۳ روز مانده" / "منقضی شده" */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} روز و ${h} ساعت`;
  if (h > 0) return `${h} ساعت و ${m} دقیقه`;
  return `${m} دقیقه`;
}

export function fmtToman(value: number | null | undefined, fa = false): string {
  if (value === null || value === undefined) return "—";
  const s = new Intl.NumberFormat("en-US").format(Math.round(value));
  return `${fa ? faNum(s) : s} تومان`;
}

export function randomFrom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function slugify(value: string, max = 24): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function maskMiddle(value: string, keepStart = 6, keepEnd = 6): string {
  if (value.length <= keepStart + keepEnd) return value;
  return `${value.slice(0, keepStart)}…${value.slice(-keepEnd)}`;
}
