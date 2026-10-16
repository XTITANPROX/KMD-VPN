<div dir="rtl">

# KalFetela Panel — نسخه Railway / Docker

پنل مدیریت کاربران و اکانت‌های VPN، مخصوص اجرا روی **Railway** (یا هر سرور Docker دیگری) با **Node.js**.
این نسخه‌ی «همه‌کاره» است: هم پنل مدیریت کامل، هم **هسته‌ی Xray داخلی** (پنل خودش می‌تواند نود باشد)، هم
اتصال به **پنل‌های خارجی** (3x-ui / مرزبان)، هم **ایجنت روی VPS**، هم **ربات فروش تلگرام**، پلن‌ها، پرداخت،
نمایندگان فروش، تیکت و بکاپ.

> کنار این پوشه، نسخه‌ی Cloudflare Workers پروژه (`src/`) هم دست‌نخورده باقی مانده است؛ هر دو در یک ریپو
> زندگی می‌کنند و هر کدام را جدا می‌توانید دیپلوی کنید.

---

## ✨ امکانات

**مدیریت کاربر و اکانت**
- ساخت/ویرایش/حذف کاربر، عملیات گروهی (فعال‌سازی، غیرفعال‌سازی، صفر کردن مصرف، تمدید، تغییر پلن، حذف)
- **ساخت گروهی اکانت** (`/api/users/bulk-create`): تا ۵۰۰ اکانت در یک درخواست با پیش‌شماره/شماره‌گذاری،
  پخش خودکار (round-robin) روی نودها یا پنل‌های فلیت، تکرارنشدنی بودن نام‌ها و خروجی آماده‌ی لینک ساب
- **برچسب (tag)** برای کاربران، نودها و پنل‌ها + فیلتر `?tag=` در لیست کاربران (برای دسته‌بندی مشتری‌ها،
  پلن‌ها و سرورها در مقیاس چند صد اکانت)
- حجم، تاریخ انقضا، تعداد دستگاه، محدودیت سرعت، یادداشت، آیدی تلگرام، ایمیل
- وضعیت‌های خودکار: `active` / `limited` (اتمام حجم) / `expired` / `disabled` / `on_hold`
- تمدید خودکار دوره‌ای (روزانه/هفتگی/ماهانه) و ریست مصرف
- لینک ساب چندفرمتی: Base64، Raw، Clash/Mihomo، sing-box، Xray (با Fragment و مسیریابی ایران)، صفحه‌ی QR
- صفحه‌ی ساب با QR، چیپ‌های فرمت و **افزودن با یک ضربه**: `v2rayng://`، `hiddify://`، `sing-box://`،
  `clash://`، `sub://` (Shadowrocket) و `streisand://`
- `GET /api/qr?data=...` برای ساخت QR دلخواه (SVG) و `GET /api/public/apps` برای کاتالوگ کلاینت‌ها
- خروجی CSV/JSON، ورودی گروهی، آمار مصرف ۱۴ روزه هر کاربر، IPهای آنلاین و شمارش دستگاه

**WireGuard (کامل و خودکار)**
- روی هر نود با پروتکل `wireguard` کلید سرور (X25519) خودکار ساخته می‌شود
- برای هر کاربر یک کلید خصوصی/عمومی جدا؛ کلید خصوصی هر کاربر در دیتابیس ذخیره و در لینک ساب او تزریق می‌شود
- خروجی‌ها: کانفیگ `wg-quick` کاربر (کپی + دانلود فایل)، صفحه‌ی ساب، و **کانفیگ سرور** با جدول `[Peer]`‌ها
- ایجنت روی VPS در حالت WireGuard: کانفیگ را می‌گیرد، با `wg-quick`/`wg syncconf` اعمال می‌کند و مصرف هر Peer را از `wg show ... dump` می‌خواند و به پنل می‌فرستد

**مدیریت چندین اکانت / چندین پنل روی Railway (فلیت)**
- در «پنل‌های متصل» یک پنل از نوع **KalFetela** اضافه کنید: آدرس ریشه‌ی پنل مقصد + **توکن API** (`kf_…` از تنظیمات → API).
- «⚡ ایمپورت همه» تمام نودهای پنل مقصد را یکجا به‌عنوان نود اینجا اضافه می‌کند؛ از آن به بعد ساخت/ویرایش/حذف کاربر،
  مصرف و وضعیت سرویس، خودکار روی همان پنل انجام می‌شود (هر پنل مقصد = یک سرور، هر تعداد پنل = فلیت شما).
- بالای صفحه‌ی پنل‌ها یک داشبورد زنده می‌بینید: تعداد پنل‌ها، آنلاین‌ها، نودهای ایمپورت‌شده، کاربران هر پنل و مصرف امروز کل فلیت.
- **ساخت گروهی کاربران**: دکمه‌ی «⚡ ساخت گروهی» در صفحه‌ی کاربران — پیش‌شماره، تعداد (تا ۵۰۰)، شماره‌گذاری با صفر،
  پسوند تصادفی، پلن/حجم/روز/دستگاه، انتخاب چند نود و پخش خودکار کاربران روی آن‌ها؛ در پایان لیست
  `username → لینک ساب` را یکجا کپی/دانلود می‌کنید.
- **برچسب (Tag)** برای کاربران، نودها و پنل‌ها + فیلتر سریع برچسب در لیست کاربران؛ برای مدیریت مشتری‌ها و سرورها در مقیاس صدها اکانت.
- **API کامل با کلید**: `X-API-Key: kf_…` (یا `?api_key=`) روی همه‌ی مسیرهای `/api/*` کار می‌کند؛ کلیدهای «read-only» فقط اجازه‌ی خواندن دارند.

**نودها (سه حالت)**
1. **داخلی (Embedded)** — خود پنل، هسته‌ی Xray را دانلود و اجرا می‌کند؛ پروتکل‌های VLESS/VMess/Trojan/Shadowsocks
   با ترانسپورت‌های TCP/WS/gRPC/HTTPUpgrade و امنیت TLS/REALITY. کلیدهای REALITY خودکار ساخته می‌شوند.
   مصرف هر کاربر از API هسته خوانده می‌شود و کاربران آنلاین/تعداد IP از لاگ دسترسی استخراج می‌شود
   (برای «تعداد دستگاه مجاز»).
2. **پنل خارجی** — اتصال به 3x-ui / Sanaei / Alireza / Marzban؛ ایمپورت خودکار اینباندها به‌عنوان نود،
   ساخت/ویرایش/حذف کلاینت روی پنل، خواندن مصرف و وضعیت سرور.
3. **فلیت KalFetela (چند پنل روی چند Railway)** — یک پنل «مادر» می‌تواند ده‌ها پنل KalFetela دیگر را
   با «توکن API» مدیریت کند؛ صفحه‌ی «فلیت پنل‌ها» وضعیت، CPU/RAM، تعداد کاربر و مصرف امروز هر پنل را
   زنده نشان می‌دهد و با یک کلیک نودهای پنل مقصد به‌عنوان نود محلی ایمپورت می‌شوند (ساخت/حذف/مصرف کاربران
   از همان‌جا انجام می‌شود).
4. **ایجنت روی VPS** — اسکریپت `agent/agent.mjs` روی هر سروری اجرا می‌شود، کانفیگ را از پنل می‌گیرد،
   هسته را (خودش دانلود و) اجرا می‌کند و مصرف را برمی‌گرداند. هم حالت Pull (پشت NAT) و هم Push.
   همین ایجنت نودهای **WireGuard** را هم می‌سازد (`WG_ENABLED=true`, default) — با `wg-quick up` رابط را بالا
   می‌آورد و مصرف هر کاربر را گزارش می‌کند.

**فروش و مالی**
- ربات تلگرام: منوی خرید، کارت‌به‌کارت + ارسال رسید، تایید/رد توسط مدیر، ساخت خودکار اکانت و ارسال کانفیگ
- تست رایگان، پلن‌ها (قیمت/حجم/مدت/دستگاه/نود)، تخفیف، پرداخت USDT (اختیاری)
- گزارش درآمد روزانه/ماهانه، تفکیک روش پرداخت، بازگشت وجه
- نمایندگان فروش با سقف حجم، سقف تعداد کاربر و کیف پول (شارژ/برداشت)
- **قطع خودکار نماینده:** با تمام شدن سقف حجم نماینده، کاربران او روی حالت «نگهداری» می‌روند و ساخت کاربر جدید
  تا شارژ سقف متوقف می‌شود (`admin_quota_cutoff` در تنظیمات)

**پشتیبانی و عملیات**
- تیکت: از ربات، از سایت (فرم عمومی) و از پنل؛ پاسخ مدیر از پنل یا تلگرام
- پیام گروهی (براودکست) به همه‌ی کاربران
- اعلان‌ها: نزدیک شدن انقضا، اتمام حجم، عبور از تعداد دستگاه، گزارش روزانه
- بکاپ JSON (دستی/خودکار) + بازگردانی کامل، لاگ رویدادها (Audit)، کلیدهای API
- داشبورد زنده (SSE): CPU/RAM/دیسک، ترافیک ۱۴ روز، کاربران آنلاین، درآمد
- ورود دو مرحله‌ای با تلگرام، محدودیت تلاش ورود، نشست‌های HttpOnly

---

## 🚀 دیپلوی روی Railway (گام‌به‌گام)

### ۰) مسیر پنل و ورود اولیه
- آدرس پنل: `https://<domain>/KalFetela` (این مسیر از تنظیمات `panel_path` خوانده می‌شود و با
  نام‌های `/panel`، `/kalfetela` و `/panel/` هم باز می‌شود؛ برای مخفی‌کردن پنل می‌توانید در تنظیمات
  مقدار دلخواه مثل `/sp-admin-7k2q9` بگذارید).
- در نصب تازه، حساب مدیر **خودکار** ساخته می‌شود: `admin` / `admin` — بعد از اولین ورود از «حساب من» رمز را عوض کنید.
  برای غیرفعال‌کردن این رفتار `DISABLE_DEFAULT_ADMIN=true` بگذارید یا با `ADMIN_USERNAME`/`ADMIN_PASSWORD` حساب دلخواه بسازید.

### ۱) فورک و ساخت پروژه
1. ریپو را **Fork** کنید (دکمه‌ی Fork در GitHub).
2. در Railway: `New Project` → `Deploy from GitHub repo` → ریپوی فورک‌شده را انتخاب کنید.
3. در سرویس ساخته‌شده → `Settings`:
   - **Root Directory** را روی `railway` بگذارید (مهم!)
   - Builder به‌صورت خودکار `railway/Dockerfile` را می‌سازد (فایل `railway.json` هم موجود است).
4. در `Variables` متغیرها را وارد کنید (جدول پایین).
   حداقل پیشنهادی:

   | متغیر | مقدار |
   |---|---|
   | `ADMIN_USERNAME` | نام کاربری مدیر اصلی (مثلاً `admin`) |
   | `ADMIN_PASSWORD` | رمز قوی مدیر اصلی |
   | `PANEL_SECRET` | یک رشته‌ی تصادفی ۳۲ بایتی (اختیاری — خودش ساخته و ذخیره می‌شود) |
   | `AGENT_SECRET` | برای حالت ایجنت (اختیاری) |

5. `Settings → Networking` → **Generate Domain** (پورت `8080`) تا آدرس پنل را بگیرید.
6. `Settings → Volumes` → یک حجم بسازید و **Mount Path** را `/data` بگذارید.
   (دیتابیس SQLite، هسته‌ی Xray، لاگ‌ها و بکاپ‌ها اینجا ذخیره می‌شوند.)
7. `Deploy` کنید. بعد از بالا آمدن، `https://<your-domain>/panel` را باز کنید و وارد شوید.

> اگر `ADMIN_USERNAME/ADMIN_PASSWORD` را نگذارید، اولین ورود صفحه‌ی «راه‌اندازی اولیه» را نشان می‌دهد و
> خودتان مدیر اصلی را می‌سازید.

### ۲) فعال کردن «نود داخلی» (اجرای Xray روی همین سرویس)
1. در `Settings → Networking` یک **TCP Proxy** بسازید که به پورت نود (مثلاً `10001`) اشاره کند.
   Railway آدرسی مثل `containers-us-west-xxx.railway.app:12345` می‌دهد.
2. در پنل → «نودها و هسته» → «نود جدید»:
   - نوع: **داخلی (اجرای Xray در همین سرور)**
   - پروتکل `vless`، ترانسپورت `ws`، امنیت `reality`
   - آدرس: همان دامنه‌ی TCP Proxy، پورت: همان پورتی که Railway داد
   - SNI: مثلاً `www.cloudflare.com`
3. ذخیره کنید → دکمه‌ی «نصب / بروزرسانی هسته» را بزنید (هسته از GitHub دانلود می‌شود).
4. کاربر بسازید و لینک ساب بگیرید. تمام! 🎉

> نکته: برای هر نود داخلی، یک TCP Proxy جدا با پورت داخلی متفاوت بسازید (`10001`, `10002`, ...).

### ۲.۵) راه‌اندازی WireGuard
1. پنل → «نودها» → «نود جدید» → پروتکل **wireguard**، آدرس دامنه/آی‌پی سرور، پورت `51820`
   (برای نود از نوع `custom` یا `agent`). کلید سرور و شبکه‌ی `10.66.66.0/24` خودکار ساخته می‌شود.
2. کاربر را به این نود وصل کنید؛ در «کانفیگ کاربر» دکمه‌ی **🐧 کانفیگ WireGuard** کانفیگ آماده‌ی
   `wg-quick` را می‌دهد (کپی/دانلود). همان کانفیگ در لینک ساب کاربر هم سرو می‌شود.
3. برای اجرای سرور: دکمه‌ی **🐧 کانفیگ سرور WireGuard** در لیست نودها، کانفیگ کامل با `[Peer]`ها را
   می‌سازد و با «💾 ذخیره در سرور» در `DATA_DIR/wireguard/node-<id>.conf` می‌نویسد.
   یا ایجنت را روی VPS نصب کنید تا خودش `wg-quick up` کند:
   ```bash
   WG_ENABLED=true WG_IFACE=kalfetela AGENT_SECRET=... PANEL_URL=https://DOMAIN NODE_ID=<id> node agent.mjs
   ```
4. سمت سرور به `iptables` و `net.ipv4.ip_forward=1` نیاز دارید (خطوط PostUp/PostDown در کانفیگ آمده‌اند).

### ۳) اتصال پنل خارجی (3x-ui / مرزبان)
1. پنل → «پنل‌های متصل» → «افزودن پنل» (آدرس با `https://`، نام کاربری/رمز یا توکن API).
2. «تست» → «ایمپورت اینباند» → اینباند مورد نظر را انتخاب و آدرس سرور را وارد کنید.
3. از این پس، کاربران روی همان پنل ساخته/حذف می‌شوند و مصرفشان خودکار خوانده می‌شود.

### ۴) ایجنت روی VPS (بدون باز کردن پورت پنل)
```bash
# روی سرور نود
curl -fsSL https://raw.githubusercontent.com/<YOUR-FORK>/KMD-VPN/main/railway/agent/agent.mjs -o agent.mjs
AGENT_SECRET="<همان AGENT_SECRET ریلوی>" \
PANEL_URL="https://<your-domain>" \
NODE_ID=<شناسه نودی که در پنل با نوع agent ساختید> \
node agent.mjs
```
برای اجرای دائمی: یک `systemd` service بسازید (نمونه در پایین همین سند) یا از `pm2`/`screen` استفاده کنید.

---

## 🔧 متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` | `8080` | پورت پنل |
| `HOST` | `0.0.0.0` | آدرس bind |
| `DATA_DIR` | `/data` (اگر writable باشد) | محل دیتابیس، هسته، بکاپ، آپلود |
| `DATABASE_URL` | — | اگر بگذارید، به‌جای SQLite از PostgreSQL استفاده می‌شود |
| `SQLITE_FILE` | `<DATA_DIR>/kalfetela.db` | مسیر فایل SQLite |
| `PUBLIC_URL` | `RAILWAY_PUBLIC_DOMAIN` | دامنه‌ی عمومی (برای لینک‌های ساب در ربات) |
| `DISABLE_DEFAULT_ADMIN` | `false` | اگر `true` باشد حساب پیش‌فرض `admin/admin` ساخته نمی‌شود (باید `ADMIN_USERNAME`/`ADMIN_PASSWORD` بدهید) |
| `PANEL_SECRET` | خودکار | کلید امضای نشست‌ها (۳۲ بایت تصادفی) |
| `AGENT_SECRET` | خودکار | کلید مشترک ایجنت‌ها و API ایجنت |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | `admin` / `admin` | ساخت خودکار مدیر اصلی در اولین اجرا؛ بعد از اولین ورود رمز را عوض کنید |
| `XRAY_ENABLED` | `auto` (`true`) | اجرای هسته‌ی داخلی؛ `false` یعنی فقط کانفیگ |
| `XRAY_AUTO_DOWNLOAD` | `true` | دانلود خودکار هسته از GitHub |
| `XRAY_VERSION` | `latest` | نسخه‌ی دلخواه هسته (مثلاً `1.8.24`) |
| `XRAY_DOWNLOAD_URL` | — | آدرس دلخواه برای دانلود آرشیو هسته (آینه/فورک) |
| `XRAY_API_PORT` | `10085` | پورت داخلی API آمار هسته |
| `XRAY_LOG_LEVEL` | `warning` | سطح لاگ هسته |
| `XRAY_STATS_INTERVAL_MS` | `20000` | فاصله‌ی خواندن مصرف کاربران از هسته |
| `TELEGRAM_BOT_TOKEN` | — | توکن ربات (یا از داخل پنل تنظیم کنید) |
| `WG_ENABLED` | `true` | حالت WireGuard در ایجنت |
| `WG_IFACE` | `kalfetela` | نام اینترفیس WireGuard در ایجنت |
| `WG_CONF` | `/etc/wireguard/<iface>.conf` | مسیر کانفیگ سرور (اگر قابل نوشتن نبود، در `DATA_DIR/wireguard`) |
| `WG_APPLY` | `true` | اعمال خودکار کانفیگ با `wg-quick`/`wg syncconf` |
| `UPDATE_REPO` | `XTITANPROX/KMD-VPN` | مخزن بررسی نسخه‌ی جدید |
| `DISABLE_UPDATE_CHECK` | `false` | خاموش کردن بررسی بروزرسانی |
| `XRAY_INSECURE_TLS` | `false` | فقط اگر شبکه‌تان TLS را بازرسی می‌کند (توصیه نمی‌شود) |

---

## 🧭 پنل و مسیرها

| مسیر | توضیح |
|---|---|
| `/` | صفحه‌ی عمومی فروش (پلن‌ها، فرم تماس، لینک ورود مدیران) |
| `/KalFetela` | پنل مدیریت (SPA، قابل نصب به‌صورت PWA) — مسیر از تنظیمات `panel_path` خوانده می‌شود |
| `/KalFetela/`, `/kalfetela`, `/panel`, `/panel/` | همان پنل با نام‌های جایگزین (سازگاری) |
| `/sub/<token>` | لینک اشتراک Base64 |
| `/sub/<token>?format=raw\|clash\|singbox\|xray\|page` | فرمت‌های دیگر |
| `/sub/<token>/info` | اطلاعات JSON اشتراک |
| `/api/...` | API پنل (نشست، Bearer یا `X-API-Key`) |
| `/api/agent/...` | API ایجنت‌ها (هدر `x-agent-secret`) |
| `/healthz` | بررسی سلامت (برای Railway) |

### افزودن یک پنل KalFetela دیگر به فلیت
```bash
# ۱) در پنل مقصد: تنظیمات → API → ساخت کلید (kf_...)
# ۲) در پنل مادر:
curl -X POST -H "X-API-Key: kf_mother" -H "content-type: application/json" \
  -d '{"name":"Railway-DE","type":"kalfetela","base_url":"https://other.up.railway.app","api_token":"kf_remote","tags":["آلمان"]}' \
  https://DOMAIN/api/panels
# ۳) نودهای پنل مقصد را ایمپورت کنید، بعد کاربران روی همان پنل ساخته می‌شوند:
curl -X POST -H "X-API-Key: kf_mother" https://DOMAIN/api/panels/1/import \
  -H "content-type: application/json" -d '{"inbounds":[...],"host":"de.example.com"}'
curl -H "X-API-Key: kf_mother" https://DOMAIN/api/panels/fleet     # وضعیت همه‌ی پنل‌ها
```

### ساخت گروهی کاربر (مقیاس چند صد اکانت)
```bash
curl -X POST -H "X-API-Key: kf_xxx" -H "content-type: application/json" \
  -d '{"prefix":"arash","count":50,"padding":3,"data_gb":30,"days":30,"distribution":"round_robin","node_ids":[1,2,3],"tags":["فروش-مهر"]}' \
  https://DOMAIN/api/users/bulk-create
```

### نمونه‌ی استفاده از API با کلید
```bash
# ساخت کلید: پنل → تنظیمات → API
curl -H "X-API-Key: kf_xxx" https://DOMAIN/api/users
curl -X POST -H "X-API-Key: kf_xxx" -H "content-type: application/json" \
  -d '{"username":"ali","data_gb":50,"days":30,"device_limit":2}' https://DOMAIN/api/users
curl -X POST -H "x-agent-secret: ..." "https://DOMAIN/api/agent/report" \
  -H "content-type: application/json" \
  -d '{"node_id":3,"usages":[{"email":"ali","upload":1024,"download":2048}]}'
```

---

## 🖥 اجرای محلی / بدون Railway

```bash
cd railway
npm install --legacy-peer-deps
npm run build
DATA_DIR=./data ADMIN_USERNAME=admin ADMIN_PASSWORD=kal1234 npm start
# → http://localhost:8080/KalFetela   (نام کاربری/رمز پیش‌فرض: admin / admin)
```
برای توسعه: `npm run dev` (tsx watch)، `npm test` (vitest)، `npm run typecheck`.

هسته‌ی Xray را دستی هم می‌توانید نصب کنید (مثلاً برای تست آفلاین):
```bash
bash scripts/download-xray.sh ./data/xray     # یا: apt install xray / دانلود از GitHub
```

---

## 🧱 ساختار پروژه

```text
railway/
├── src/
│   ├── app.ts               مسیرها و روترها (بدون listen — برای تست)
│   ├── index.ts             بوت‌استرپ سرور، هسته، ربات، زمان‌بند
│   ├── env.ts               متغیرهای محیطی و مسیرها
│   ├── db/                  لایه‌ی دیتابیس (SQLite/Postgres) + ساختار جداول
│   ├── lib/                 ابزارها: رمزنگاری، تاریخ شمسی، اعتبارسنجی، ZIP
│   ├── middleware.ts        نشست، API-Key، ایجنت، خطاها
│   ├── routes/              auth, users, nodes, panels, plans, admins,
│   │                        payments, tickets, settings, system, public
│   └── services/
│       ├── store.ts         همه‌ی کوئری‌ها و قواعد کسب‌وکار
│       ├── nodes.ts         همگام‌سازی کاربر↔نود، جمع‌آوری مصرف، اعمال محدودیت‌ها
│       ├── clients/         local (Xray داخلی) · xui · marzban
│       ├── links.ts         سازنده‌ی لینک/Clash/sing-box/Xray
│       ├── wireguard.ts     کلیدها، کانفیگ کاربر و سرور WireGuard
│       ├── bot.ts           ربات فروش و اعلان‌ها
│       ├── telegram.ts      لایه‌ی Bot API
│       ├── scheduler.ts     زمان‌بند (مصرف، سلامتی، اعلان، بکاپ، آپدیت)
│       ├── backup.ts        بکاپ/بازگردانی JSON
│       └── auth.ts          نشست، Rate limit، کد یک‌بارمصرف
├── public/                  رابط کاربری (SPA فارسی + صفحه‌ی فروش + PWA)
├── agent/agent.mjs          ایجنت نود برای VPS
├── scripts/                 اسکریپت‌های کمکی
├── test/                    تست‌ها (vitest): API، لینک‌ها، تاریخ، هسته‌ی Xray
└── Dockerfile, railway.json, .npmrc
```

---

## 🔐 امنیت

- رمزها با **scrypt** هش می‌شوند؛ نشست‌ها با HMAC امضا و در کوکی `HttpOnly` نگه داشته می‌شوند.
- محدودیت تلاش ناموفق ورود + امکان ورود دو مرحله‌ای با تلگرام.
- کلیدهای API فقط یک بار نمایش داده می‌شوند و قابل ابطال هستند.
- کاربرها فقط با توکن ساب خودشان به کانفیگ دسترسی دارند؛ توکن را با کسی به اشتراک نگذارید.
- پیشنهاد: Cloudflare Access روی `/panel`، بکاپ منظم، و `PANEL_SECRET`/`AGENT_SECRET` تصادفی.
- هسته‌ی Xray روی پورت‌های TCP Proxy گوش می‌دهد؛ پورت پنل را برای کاربران باز نکنید.

---

## 🧪 تست‌ها

```bash
cd railway
npm test          # ۳۱ تست: API سرتاسری (شامل WireGuard و سقف نماینده)، لینک‌ها، تاریخ شمسی، مدیریت هسته
npm run typecheck # بررسی نوع‌ها با strict mode
```

---

## 🛠 رفع اشکال

| مشکل | راه‌حل |
|---|---|
| صفحه‌ی پنل بالا نمی‌آید | Root Directory باید `railway` باشد و پورت سرویس `8080`. |
| «هسته نصب نشد» | دسترسی خروجی به GitHub لازم است؛ یا `XRAY_VERSION`/`XRAY_DOWNLOAD_URL` را روی یک آینه بگذارید. |
| کاربر وصل نمی‌شود | TCP Proxy را بررسی کنید (دامنه:پورت دقیقاً مثل نود)، و اینکه هسته در وضعیت «در حال اجرا» است. |
| لینک ساب با دامنه‌ی اشتباه | `PUBLIC_URL` را ست کنید (یا از همان دامنه وارد پنل شوید تا خودکار ثبت شود). |
| دیتابیس با هر دیپلوی خالی می‌شود | Volume روی `/data` را فراموش نکرده‌اید؟ (`Settings → Volumes`) |
| مصرف کاربران بالا نمی‌رود | در نودهای پنلی، دکمه‌ی «تست/سینک» را بزنید و مطمئن شوید رمز/توکن پنل درست است. |
| ربات جواب نمی‌دهد | توکن ربات در تنظیمات، و اینکه کاربر «/start» زده باشد. |

---

## 📦 سرویس systemd نمونه برای ایجنت

```ini
[Unit]
Description=KalFetela Node Agent
After=network-online.target

[Service]
WorkingDirectory=/opt/kalfetela-agent
Environment=PANEL_URL=https://your-domain
Environment=AGENT_SECRET=xxxxxxxx
Environment=NODE_ID=3
ExecStart=/usr/bin/node /opt/kalfetela-agent/agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## 📜 مجوز و اعتبار

KalFetela Panel تحت **GNU GPL v3 یا بالاتر** منتشر می‌شود (فایل `LICENSE` در ریشه‌ی ریپو).
معماری اولیه از [Aether Panel](https://github.com/nikzadcr-cmyk/aether-panel) (MIT) و ایده‌های
سازگاری از [BPB Worker Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel) (GPL-3.0) آمده است؛
جزئیات در `NOTICE.md`. هسته‌ی Xray-core متعلق به پروژه‌ی [XTLS](https://github.com/XTLS/Xray-core) است.

> ⚠️ این ابزار را مطابق قوانین محل زندگی و شرایط استفاده‌ی سرویس‌دهنده‌ی خود (Railway/GitHub) به کار ببرید.

</div>
