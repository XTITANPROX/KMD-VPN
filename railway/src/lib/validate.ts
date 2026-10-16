// Tiny validation helpers — keeps the dependency surface small while still
// giving precise, Persian-friendly error messages.

export class ValidationError extends Error {
  readonly fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export type FieldErrors = Record<string, string>;

export interface VContext {
  errors: FieldErrors;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class Validator<T extends Record<string, unknown>> {
  private readonly errors: FieldErrors = {};
  private readonly out: Record<string, unknown> = {};

  constructor(private readonly body: unknown) {}

  private src(): Record<string, unknown> {
    return isPlainObject(this.body) ? this.body : {};
  }

  raw(): Record<string, unknown> {
    return this.src();
  }

  string(key: string, opts: { required?: boolean; min?: number; max?: number; label?: string; pattern?: RegExp } = {}): this {
    const label = opts.label ?? key;
    const value = this.src()[key];
    if (value === undefined || value === null || value === "") {
      if (opts.required) this.errors[key] = `${label} الزامی است`;
      return this;
    }
    const str = String(value).trim();
    if (opts.min && str.length < opts.min) this.errors[key] = `${label} باید حداقل ${opts.min} کاراکتر باشد`;
    if (opts.max && str.length > opts.max) this.errors[key] = `${label} نباید بیشتر از ${opts.max} کاراکتر باشد`;
    if (opts.pattern && !opts.pattern.test(str)) this.errors[key] = `${label} معتبر نیست`;
    if (!this.errors[key]) this.out[key] = str;
    return this;
  }

  username(key = "username", label = "نام کاربری"): this {
    const value = this.src()[key];
    if (value === undefined || value === null || value === "") {
      this.errors[key] = `${label} الزامی است`;
      return this;
    }
    const str = String(value).trim();
    if (!/^[a-zA-Z0-9._@-]{3,32}$/.test(str)) {
      this.errors[key] = `${label} باید ۳ تا ۳۲ کاراکتر انگلیسی، عدد یا . _ - @ باشد`;
      return this;
    }
    this.out[key] = str;
    return this;
  }

  password(key = "password", label = "رمز عبور"): this {
    const value = this.src()[key];
    if (value === undefined || value === null || value === "") {
      this.errors[key] = `${label} الزامی است`;
      return this;
    }
    const str = String(value);
    if (str.length < 6) this.errors[key] = `${label} باید حداقل ۶ کاراکتر باشد`;
    else this.out[key] = str;
    return this;
  }

  int(key: string, opts: { required?: boolean; min?: number; max?: number; label?: string; def?: number } = {}): this {
    const label = opts.label ?? key;
    const value = this.src()[key];
    if (value === undefined || value === null || value === "") {
      if (opts.required) this.errors[key] = `${label} الزامی است`;
      else if (opts.def !== undefined) this.out[key] = opts.def;
      return this;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      this.errors[key] = `${label} باید عدد صحیح باشد`;
      return this;
    }
    if (opts.min !== undefined && num < opts.min) this.errors[key] = `${label} نباید کمتر از ${opts.min} باشد`;
    if (opts.max !== undefined && num > opts.max) this.errors[key] = `${label} نباید بیشتر از ${opts.max} باشد`;
    if (!this.errors[key]) this.out[key] = num;
    return this;
  }

  number(key: string, opts: { required?: boolean; min?: number; max?: number; label?: string; def?: number } = {}): this {
    const label = opts.label ?? key;
    const value = this.src()[key];
    if (value === undefined || value === null || value === "") {
      if (opts.required) this.errors[key] = `${label} الزامی است`;
      else if (opts.def !== undefined) this.out[key] = opts.def;
      return this;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      this.errors[key] = `${label} باید عدد باشد`;
      return this;
    }
    if (opts.min !== undefined && num < opts.min) this.errors[key] = `${label} نباید کمتر از ${opts.min} باشد`;
    if (opts.max !== undefined && num > opts.max) this.errors[key] = `${label} نباید بیشتر از ${opts.max} باشد`;
    if (!this.errors[key]) this.out[key] = num;
    return this;
  }

  bool(key: string, def = false): this {
    const value = this.src()[key];
    if (value === undefined || value === null) {
      this.out[key] = def;
      return this;
    }
    if (typeof value === "string") {
      this.out[key] = ["1", "true", "on", "yes", "بله"].includes(value.toLowerCase());
      return this;
    }
    this.out[key] = Boolean(value);
    return this;
  }

  array(key: string, opts: { required?: boolean; label?: string } = {}): this {
    const value = this.src()[key];
    if (value === undefined || value === null) {
      if (opts.required) this.errors[key] = `${opts.label ?? key} الزامی است`;
      return this;
    }
    if (Array.isArray(value)) {
      this.out[key] = value;
      return this;
    }
    if (typeof value === "string") {
      // comma / newline separated string is accepted everywhere.
      this.out[key] = value
        .split(/[\n,]/)
        .map((part) => part.trim())
        .filter(Boolean);
      return this;
    }
    this.errors[key] = `${opts.label ?? key} باید لیست باشد`;
    return this;
  }

  /** Accepts an ISO date string or unix seconds and normalises to unix seconds. */
  timestamp(key: string, label?: string): this {
    const value = this.src()[key];
    if (value === undefined || value === null || value === "") return this;
    if (typeof value === "number" || /^\d+$/.test(String(value))) {
      const num = Number(value);
      this.out[key] = num > 10_000_000_000 ? Math.floor(num / 1000) : num;
      return this;
    }
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      this.errors[key] = `${label ?? key} تاریخ معتبر نیست`;
      return this;
    }
    this.out[key] = Math.floor(date.getTime() / 1000);
    return this;
  }

  enum(key: string, allowed: readonly string[], opts: { required?: boolean; label?: string; def?: string } = {}): this {
    const label = opts.label ?? key;
    const value = this.src()[key];
    if (value === undefined || value === null || value === "") {
      if (opts.required) this.errors[key] = `${label} الزامی است`;
      else if (opts.def !== undefined) this.out[key] = opts.def;
      return this;
    }
    const str = String(value);
    if (!allowed.includes(str)) {
      this.errors[key] = `${label} باید یکی از این مقادیر باشد: ${allowed.join(", ")}`;
      return this;
    }
    this.out[key] = str;
    return this;
  }

  /** Escape hatch for custom rules. */
  custom<T>(key: string, fn: (value: unknown) => { ok: true; value: T } | { ok: false; message: string }): this {
    const result = fn(this.src()[key]);
    if (result.ok) this.out[key] = result.value;
    else this.errors[key] = result.message;
    return this;
  }

  value(key: string, fallback: unknown): this {
    const value = this.src()[key];
    this.out[key] = value === undefined ? fallback : value;
    return this;
  }

  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  get errorsMap(): FieldErrors {
    return { ...this.errors };
  }

  done(): T {
    if (this.failed) {
      throw new ValidationError("خطا در اعتبارسنجی داده‌ها", this.errors);
    }
    return this.out as T;
  }
}

export function validate<T extends Record<string, unknown>>(body: unknown, build: (v: Validator<T>) => void): T {
  const v = new Validator<T>(body);
  build(v);
  return v.done();
}

/** Converts GB (input from UI) to bytes. */
export function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 ** 3);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parseBoolean(value: unknown, def = false): boolean {
  if (value === undefined || value === null || value === "") return def;
  if (typeof value === "boolean") return value;
  const str = String(value).toLowerCase();
  return ["1", "true", "on", "yes", "بله", "فعال"].includes(str);
}
