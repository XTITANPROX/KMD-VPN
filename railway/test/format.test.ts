import { describe, expect, it } from "vitest";
import { bytesToGb, fmtBytes, fmtDuration, gbToBytes, jalaliDate, jalaliMonthLength, toGregorian, toJalali } from "../src/lib/format.js";

describe("format helpers", () => {
  it("formats bytes", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(1024)).toBe("1 KB");
    expect(fmtBytes(1024 ** 3)).toBe("1 GB");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(null)).toBe("—");
  });

  it("converts GB", () => {
    expect(gbToBytes(1)).toBe(1073741824);
    expect(bytesToGb(1073741824)).toBe(1);
    expect(bytesToGb(1610612736)).toBe(1.5);
  });

  it("converts gregorian dates to jalali", () => {
    expect(toJalali(new Date(2026, 9, 16))).toEqual({ jy: 1405, jm: 7, jd: 24 });
    expect(toJalali(new Date(2024, 2, 20))).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(jalaliDate(new Date(2026, 9, 16))).toBe("1405/07/24");
    expect(jalaliDate(new Date(2026, 9, 16), { fa: true, monthName: true })).toContain("مهر");
  });

  it("round trips jalali → gregorian", () => {
    const date = toGregorian(1403, 1, 1);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(20);
  });

  it("knows month lengths", () => {
    expect(jalaliMonthLength(1403, 1)).toBe(31);
    expect(jalaliMonthLength(1403, 7)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(30); // leap year (verified against Intl persian calendar)
    expect(jalaliMonthLength(1403, 12)).toBe(29);
  });

  it("formats durations", () => {
    expect(fmtDuration(90_000)).toContain("روز");
    expect(fmtDuration(3600)).toContain("ساعت");
  });
});
