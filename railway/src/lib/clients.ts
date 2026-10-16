// Recommended client apps (adapted from the client lists used by BPB-Worker-Panel
// and Aether) plus the quick-start guides the subscription page shows.

export interface ClientApp {
  id: string;
  name: string;
  platforms: string[];
  /** Subscription formats this app understands best. */
  formats: Array<"raw" | "base64" | "clash" | "singbox" | "xray">;
  url: string;
  note: string;
  /** Renders a prominent "install" button on the public pages. */
  featured?: boolean;
}

export const CLIENT_APPS: ClientApp[] = [
  {
    id: "v2rayng",
    name: "v2rayNG",
    platforms: ["Android"],
    formats: ["raw", "base64"],
    url: "https://github.com/2dust/v2rayNG/releases/latest",
    note: "سبک و سریع؛ لینک ساب را با «Import config from clipboard» اضافه کنید.",
    featured: true,
  },
  {
    id: "hiddify",
    name: "Hiddify Next",
    platforms: ["Android", "iOS", "Windows", "macOS", "Linux"],
    formats: ["singbox", "raw"],
    url: "https://github.com/hiddify/hiddify-app/releases/latest",
    note: "چندپلتفرمی با پشتیبانی کامل sing-box و REALITY؛ گزینهٔ پیشنهادی ما.",
    featured: true,
  },
  {
    id: "streisand",
    name: "Streisand",
    platforms: ["iOS", "macOS"],
    formats: ["raw", "clash"],
    url: "https://apps.apple.com/app/streisand/id6450534064",
    note: "رایگان و پایدار روی آیفون/آیپد؛ از لینک ساب پشتیبانی می‌کند.",
    featured: true,
  },
  {
    id: "shadowrocket",
    name: "Shadowrocket",
    platforms: ["iOS", "macOS"],
    formats: ["raw"],
    url: "https://apps.apple.com/app/shadowrocket/id932747118",
    note: "پرداختی؛ پشتیبانی عالی از REALITY و Fragment.",
  },
  {
    id: "clash-verge",
    name: "Clash Verge Rev",
    platforms: ["Windows", "macOS", "Linux"],
    formats: ["clash"],
    url: "https://github.com/clash-verge-rev/clash-verge-rev/releases/latest",
    note: "Mihomo/Clash Meta با پشتیبانی از Fragment و قاعده‌های ایران.",
    featured: true,
  },
  {
    id: "flclash",
    name: "FlClash",
    platforms: ["Android", "Windows", "macOS", "Linux"],
    formats: ["clash"],
    url: "https://github.com/chen08209/FlClash/releases/latest",
    note: "رابط کاربری تمیز Clash Meta برای موبایل و دسکتاپ.",
  },
  {
    id: "nekobox",
    name: "NekoBox",
    platforms: ["Android"],
    formats: ["raw"],
    url: "https://github.com/MatsuriDayo/NekoBoxForAndroid/releases/latest",
    note: "قدرتمند با پشتیبانی از ترنسپورت‌های خاص و Fragment.",
  },
  {
    id: "singbox",
    name: "sing-box (رسمی)",
    platforms: ["Android", "iOS", "macOS", "Windows", "Linux"],
    formats: ["singbox"],
    url: "https://github.com/SagerNet/sing-box/releases/latest",
    note: "کلاینت رسمی؛ مناسب کاربران حرفه‌ای و سرورها.",
  },
  {
    id: "v2box",
    name: "V2Box",
    platforms: ["iOS", "Android"],
    formats: ["raw", "base64"],
    url: "https://apps.apple.com/app/v2box-v2ray-client/id6446814690",
    note: "جایگزین سادهٔ iOS بدون محدودیت اپ‌استور ایران.",
  },
  {
    id: "happ",
    name: "Happ",
    platforms: ["iOS", "macOS", "Android", "Windows"],
    formats: ["raw", "clash"],
    url: "https://happ.su/",
    note: "کلاینت مدرن با پشتیبانی از انواع پروتکل و لینک ساب.",
  },
];

/** Quick-start steps shown under the subscription links. */
export const SETUP_STEPS: Array<{ title: string; body: string }> = [
  { title: "۱. برنامهٔ مناسب را نصب کنید", body: "از فهرست بالا، کلاینت مخصوص دستگاه خودتان را نصب کنید." },
  { title: "۲. لینک اشتراک را کپی کنید", body: "لینک پایین همین صفحه را کپی کنید (یا QR را با دوربین اسکن کنید)." },
  {
    title: "۳. در برنامه «Add subscription / Import» بزنید",
    body: "لینک را اضافه کنید و به‌روزرسانی (Update) را بزنید تا همهٔ کانفیگ‌ها بیاید.",
  },
  { title: "۴. وصل شوید", body: "یک کانفیگ را انتخاب و اتصال را روشن کنید. اگر قطع شد، کانفیگ دیگر را امتحان کنید." },
];

export function appsForFormat(format: string): ClientApp[] {
  const key = format.replace(/^sing-box$/, "singbox") as ClientApp["formats"][number];
  return CLIENT_APPS.filter((app) => app.formats.includes(key));
}
