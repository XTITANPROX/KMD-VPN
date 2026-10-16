<div dir="rtl">

# KALFETELA

پنل متن‌باز و راست‌چین مدیریت تونل روی Cloudflare Workers؛ ترکیبی از معماری چندکاربره و ماژولار Aether و ایده‌های پایداری اتصال، Fragment، مسیریابی ایران و DoH در BPB.

> **واقع‌بینانه:** هیچ ابزار مبتنی بر Cloudflare نمی‌تواند اتصال دائمی یا عبور ۱۰۰٪ از همه اپراتورها را تضمین کند. نتیجه به اپراتور، دامنه، IP تمیز، نسخه کلاینت و سیاست‌های Cloudflare بستگی دارد. از پروژه فقط مطابق قوانین محل زندگی و شرایط استفاده Cloudflare استفاده کنید.

## امکانات

- VLESS، Trojan و VMess روی WebSocket
- مدیریت چندکاربره، سهمیه حجم/درخواست، تاریخ انقضا و محدودیت دستگاه
- پنل فارسی RTL، واکنش‌گرا و قابل نصب به‌صورت PWA
- خروجی Base64، Raw، Clash Meta، sing-box و **Xray Fragment مخصوص شرایط ایران**
- انتخاب بهترین IP با Observatory و `leastPing` در پروفایل Xray
- مسیریابی مستقیم دامنه‌های `.ir` و قوانین سفارشی Direct/Block
- DNS-over-HTTPS خصوصی در مسیر `/dns-query`
- استخر پراکسی بالادست SOCKS4/5 و HTTP CONNECT با بررسی سلامت
- اسکن IP تمیز، چرخش خودکار IP، آمار مصرف، لاگ ممیزی و بکاپ/بازیابی
- احراز هویت PBKDF2، نشست HttpOnly/Secure، نقش‌های مدیر و Rate Limit
- D1، Durable Objects، KV و Queue برای ذخیره‌سازی و شمارش پایدار

## راه‌اندازی سریع

### پیش‌نیاز

- Node.js 20 یا جدیدتر
- حساب Cloudflare با دسترسی Workers، D1، KV، Durable Objects و Queues
- API Token محدودشده به همان حساب و منابع لازم

### روش خودکار

```bash
npm ci
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."
export PANEL_SECRET="$(openssl rand -hex 32)" # اختیاری؛ اسکریپت می‌سازد
bash deploy.sh kalfetela
```

اسکریپت منابع لازم را ایجاد، شناسه‌های `wrangler.toml` را تنظیم، migration را اجرا و Worker را deploy می‌کند. توکن را داخل فایل یا Git ذخیره نکنید.

### روش دستی

```bash
npm ci
npx wrangler d1 create kalfetela
npx wrangler kv namespace create KALFETELA_KV
npx wrangler queues create kalfetela-writes
```

شناسه‌های D1 و KV را جایگزین `REPLACE_WITH_D1_ID` و `REPLACE_WITH_KV_ID` در `wrangler.toml` کنید، سپس:

```bash
npx wrangler secret put PANEL_SECRET
npm run db:migrate:remote
npm run deploy
```

بعد از deploy، مسیر `/panel` را باز کنید و اولین مدیر را بسازید.

## استفاده از اشتراک

برای هر کاربر:

| فرمت | آدرس |
|---|---|
| عمومی Base64 | `/sub/USERNAME` |
| لینک خام | `/sub/USERNAME?format=raw` |
| Clash Meta | `/sub/USERNAME?format=clash` |
| sing-box | `/sub/USERNAME?format=singbox` |
| Xray Fragment | `/sub/USERNAME?format=xray` |

پروفایل Xray شامل چند IP، انتخاب خودکار کم‌تاخیر، Fragment TLS و مسیریابی مستقیم ایران است. مقدار Fragment هر کاربر با قالب `length,delay,packets` تنظیم می‌شود؛ نمونه: `100-200,1-3,tlshello`.

## توسعه

```bash
npm ci
npm run typecheck
npm test
npm run dev
```

ساختار اصلی:

```text
src/core/          تونل، parser پروتکل و اتصال بالادست
src/routes/        API مدیریت کاربران، پراکسی، اسکنر و سیستم
src/services/      اشتراک‌ها، DoH، IP تمیز و اسکن
src/do/            Durable Objects
src/ui/            پنل RTL و PWA
migrations/        ساختار D1
```

## امنیت

- برای `PANEL_SECRET` حداقل ۳۲ بایت تصادفی استفاده کنید.
- Token کلودفلر را با کمترین دسترسی و فقط برای حساب موردنظر بسازید.
- دامنه اختصاصی، Access Policy و محدودیت نرخ Cloudflare توصیه می‌شود.
- لینک اشتراک حاوی شناسه اتصال است؛ آن را عمومی نکنید.
- پیش از انتشار عمومی، قوانین و محدودیت‌های طرح Cloudflare خود را بررسی کنید.

## ریشه پروژه و مجوز

این پروژه از معماری [Aether Panel](https://github.com/nikzadcr-cmyk/aether-panel) (MIT) آغاز شده و قابلیت‌ها و ایده‌های سازگار با [BPB Worker Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel) (GPL-3.0) را ادغام و بازطراحی کرده است. جزئیات در `NOTICE.md` آمده است.

KALFETELA تحت **GNU GPL v3 یا نسخه‌های بعدی** منتشر می‌شود. متن کامل در `LICENSE` است.

</div>

---

## English summary

KALFETELA is an open-source, Persian-first Cloudflare Workers tunnel panel combining Aether's multi-user architecture with BPB-inspired Fragment, Iran routing and private DoH features. It supports VLESS/Trojan/VMess over WebSocket and Base64, raw, Clash, sing-box and Xray Fragment subscriptions. See the Persian instructions above for deployment.
