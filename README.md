# tg-media-bot — بات تلگرامی دانلودر ویدیو/صوت/متن

بات تلگرامی که لینک **یوتیوب، اینستاگرام، ایکس (توییتر)، تیک‌تاک** و ده‌ها سایت دیگر
را می‌گیرد، با **yt-dlp** دانلود می‌کند و فایل را در همان چت تلگرام برمی‌گرداند
(ویدیو تا **۲GB** با سرور Bot API محلی). کد اصلی از
[Borodutch/VideoDownloadBot](https://github.com/Borodutch/VideoDownloadBot) (لایسنس MIT) است
و در این مخزن برای **اجرای شخصی روی یک هاست لینوکسی** تنظیم شده است.

> اعتبار اصلی: [Borodutch/VideoDownloadBot](https://github.com/Borodutch/VideoDownloadBot) — MIT

---

## ساختار مخزن

```
tg-media-bot/
├── bot/                     # کد اصلی بات (TypeScript / bun + grammy + yt-dlp)
│   ├── bot.ts               # خود بات
│   ├── Dockerfile           # تصویر بات
│   └── ...
├── deploy/
│   ├── bot-api.Dockerfile   # (اختیاری) بیلد سرور Bot API خودتان
├── docker-compose.yml       # بات + سرور Bot API محلی (۲GB)
├── scripts/
│   └── install-linux.sh     # نصب یکپارچه روی هاست لینوکسی
├── .github/workflows/ci.yml # تست خودکار با هر push
├── .env.example             # نمونه تنظیمات
└── README.md
```

## امکانات

- لینک بفرست ← فایل برگردد (ویدیو/صوت/انیمیشن)، با تشخیص خودکار نوع
- همه سایت‌های پشتیبانی‌شده [yt-dlp](https://github.com/yt-dlp/yt-dlp) (۱۰۰۰+)
- ارسال تا **۲GB** با سرور Bot API محلی (`--local`)
- کش: لینک تکراری همان لحظه برمی‌گردد (SQLite)
- صف دانلود، مدیریت flood-control تلگرام، کار در گروه و Private
- آپدیت خودکار yt-dlp (قابل خاموش کردن با `YTDLP_UPDATE=off`)
- پاسخ‌ها چندزبانه (`i18n.ts` — افزودن فارسی در فهرست کارهای بعدی)

## پیش‌نیازها

تنها **Docker** (با پلاگین Compose) لازم است — bun، yt-dlp و ffmpeg همگی
داخل تصویرهای کانتینر نصب می‌شوند.

## تنظیمات (.env)

یک فایل `.env` در ریشهٔ مخزن، **هر دو سرویس** (بات + سرور Bot API) را تنظیم می‌کند:

```bash
cp .env.example .env
nano .env
```

| متغیر | اجباری | توضیح |
|---|---|---|
| `TOKEN` | **بله** | توکن بات از @BotFather |
| `TELEGRAM_API_ID` | **بله** | از [my.telegram.org](https://my.telegram.org) ← *API development tools* (برای ۲GB) |
| `TELEGRAM_API_HASH` | **بله** | همان صفحه |
| `YTDLP_UPDATE` | خیر | `off` = پین کردن نسخه yt-dlp (پیش‌فرضِ نمونه) |
| `MAX_DOWNLOADS` | خیر | دانلودهای هم‌زمان (پیش‌فرض 8) |
| `ADMIN_ID` | خیر | اعلان خرابی لگین یوتیوب |
| `DATA_DIR` / `STATS_PORT` / `STORAGE_CHAT` / `COOKIES` | خیر | جزئیات در `.env.example` |

## اجرا

```bash
docker compose up -d --build
docker compose logs -f
```

کانتینرها:
- `tg-media-bot` — خود بات (polling + yt-dlp + ffmpeg)
- `tg-botapi` — سرور Bot API محلی با `--local` → ارسال تا **۲GB**

مدیریت روزمره:

```bash
docker compose ps              # وضعیت
docker compose logs -f         # لاگ
docker compose down            # توقف
git pull && docker compose up -d --build   # آپدیت
```

## نصب یک‌دست روی هاست لینوکسی

```bash
git clone <this-repo> && cd tg-media-bot
bash scripts/install-linux.sh   # Docker را نصب می‌کند، .env می‌سازد، compose بالا می‌آورد
```

## git / آپدیت از upstream

این مخزن روی تاریخچهٔ upstream ساخته شده است (یک commitِ «بازسازی deploy» روی
آخرین commitِ upstream). remoteٔ `upstream` به
[Borodutch/VideoDownloadBot](https://github.com/Borodutch/VideoDownloadBot) متصل است:

```bash
git pull --no-rebase --no-edit upstream main   # به‌روزرسانی کد بات
# بعد از merge:
cd bot && bun install && bun test
```

## تست

تست‌های خود بات (بدون توکن واقعی، با Bot API جعلی):

```bash
cd bot
bun install
bun test            # unit + e2e (ffmpeg و yt-dlp روی PATH لازم است)
```

CI در هر push اجرا می‌شود (`.github/workflows/ci.yml`).

## نکات عملی (کسب‌شده از راه‌اندازی)

- **بلاک IP توسط YouTube:** اگر هاست شما IP دیتاسنتر دارد، ممکن است YouTube
  درخواست‌ها را رد کند. راه‌حل‌های موجود در کد اصلی: `WARP_PROXY` (پراکسی WARP
  برای هاست‌های یوتیوب) و `COOKIES` (سیشن لگین‌شده).
- **`EGRESS_DENY is empty`** هنگام اجرای شخصی بی‌ضرر است (فقط برای هاست ابری
  توصیه شده).
- **سقف ۵۰MB:** بدون Bot API محلی، فایل‌های بزرگ‌تر از ۵۰MB ارسال نمی‌شوند
  (محدودیت API ابری تلگرام).
- **اعتبار my.telegram.org:** `api-id/api-hash` اشتباه با خطای
  `invalid api-id/api-hash` هنگام `getMe` در سرور محلی خود را نشان می‌دهد؛
  اعتبار درست با `{ok:true, ...}` پاسخ می‌دهد.

## کارهای بعدی (backlog)

- [ ] خروجی **MP3** (استخراج صدا)
- [ ] **متن‌خروجی**: لینک توییت/پست بدون ویدیو ← متن پست ارسال شود
- [ ] **whitelist** کاربرها
- [ ] پاسخ‌های **فارسی** در `i18n.ts`
- [ ] ترنسیپت گفتار (اختیاری)

## لایسنس

MIT — کد اصلی: Borodutch/VideoDownloadBot (MIT). تغییرات این مخزن هم MIT.
