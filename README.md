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
│   ├── .env                 # تنظیمات شما (توکن،…) — در git نیست
│   └── ...
├── deploy/                  # فایل‌های استقرار روی هاست لینوکسی
│   ├── docker-compose.yml   # بات + سرور Bot API محلی (ساده‌ترین راه)
│   ├── tg-media-bot.service # unit برای اجرای مستقیم بدون Docker
│   └── bot-api.Dockerfile   # (اختیاری) بیلد سرور Bot API خودتان
├── scripts/
│   ├── install-linux.sh     # نصب یکپارچه روی هاست لینوکسی
│   └── run-wsl-keepalive.ps1# (فقط ویندوز/WSL) نگه‌داشتن VM زنده
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

| جزء | نسخه | توضیح |
|---|---|---|
| [bun](https://bun.sh) | 1.1+ | ران‌تایم TypeScript |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | اخیر | روی PATH |
| ffmpeg | اخیر | روی PATH (برای merge/تامنیل) |
| Docker (اختیاری) | 24+ | فقط اگر Bot API محلی با کانتینر می‌خواهید |

## تنظیمات (bot/.env)

```bash
cd bot
cp ../.env.example .env
nano .env        # TOKEN را از @BotFather بگذارید
```

| متغیر | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|
| `TOKEN` | **بله** | — | توکن بات از BotFather |
| `BOT_API_URL` | خیر | API ابری (۵۰MB) | `http://127.0.0.1:8081` برای ۲GB |
| `YTDLP_UPDATE` | خیر | on | `off` = پین کردن نسخه yt-dlp |
| `ADMIN_ID` | خیر | — | اعلان خرابی لگین یوتیوب |
| `MAX_DOWNLOADS` | خیر | 8 | دانلودهای هم‌زمان |

## اجرا

### ۱) سریع — مستقیم روی هاست (بدون Docker)

```bash
cd bot
bun install
bun bot.ts
```

### ۲) ماندگار — systemd

```bash
sudo install -Dm644 deploy/tg-media-bot.service /etc/systemd/system/
# مسیرها را در unit مطابق سرور خودتان تنظیم کنید
sudo systemctl enable --now tg-media-bot
journalctl -u tg-media-bot -f
```

### ۳) کامل — Docker Compose (بات + Bot API محلی ۲GB)

```bash
cp .env.example .env  # TOKEN + TELEGRAM_API_ID + TELEGRAM_API_HASH
docker compose up -d
docker compose logs -f
```

برای Bot API محلی، **`TELEGRAM_API_ID` و `TELEGRAM_API_HASH`** لازم است:
از [my.telegram.org](https://my.telegram.org) ← *API development tools* بگیرید.

### ۴) نصب یک‌دست (اسکریپت)

```bash
bash scripts/install-linux.sh
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

## دیپلوی روی هاست لینوکسی

```bash
git clone <this-repo>
cd tg-media-bot
bash scripts/install-linux.sh   # bun + yt-dlp + ffmpeg را نصب می‌کند
```

سپس یکی از راه‌های «اجرا» بالا. روی سرور واقعی نیاز به هیچ keepalive‌ای نیست؛
systemd/Docker همه‌چیز را زنده نگه می‌دارند.

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
