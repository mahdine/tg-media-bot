# tg-media-bot — Telegram video/audio/text downloader bot

A Telegram bot that takes a link from **YouTube, Instagram, X (Twitter),
TikTok** and dozens of other sites, downloads it with **yt-dlp**, and sends the
file back in the same Telegram chat (up to **2 GB** via a local Bot API server).
The core code is
[Borodutch/VideoDownloadBot](https://github.com/Borodutch/VideoDownloadBot)
(MIT), set up here for **self-hosting on a Linux box via Docker**.

> Original credit: [Borodutch/VideoDownloadBot](https://github.com/Borodutch/VideoDownloadBot) — MIT

---

## Repository layout

```
tg-media-bot/
├── bot/                     # core bot code (TypeScript / bun + grammy + yt-dlp)
│   ├── bot.ts               # the bot
│   ├── Dockerfile           # bot image
│   └── ...
├── deploy/
│   └── bot-api.Dockerfile   # (optional) build your own Bot API server
├── docker-compose.yml       # bot + local Bot API server (2GB)
├── scripts/
│   └── install-linux.sh     # one-shot install on a Linux host
├── .github/workflows/ci.yml # auto tests on every push
├── .env.example             # config template
├── README.md
└── ROADMAP.md               # researched future work
```

## Features

- Send a link → get the file back (video/audio/animation), type auto-detected
- Every site supported by [yt-dlp](https://github.com/yt-dlp/yt-dlp) (1000+)
- **Quality menu** for YouTube links (private chat, one tap): best video,
  720p, audio only, or transcript
- **Transcripts**: a YouTube link's subtitles (manual preferred over
  auto-generated, `en,far,fa,ar`) come back as text
- **No-media tweets**: an X/Twitter post without video/media returns the post
  text
- **Live progress**: real download percentage (file size of the picked
  formats) and the file size shown while uploading
- Uploads up to **2 GB** via a local Bot API server (`--local`)
- Cache: an already-downloaded link is returned instantly (SQLite), per
  quality
- Download queue, Telegram flood-control handling, works in groups and private
- yt-dlp auto-update (disable with `YTDLP_UPDATE=off`)
- Multilingual replies (`i18n.ts` — 9 languages), `/lang` to pick a language
- **Main menu** (`/menu`): set your default quality for links, change your
  language, or read the help — all inline, remembered per user
- **Groups**: make the bot a **group admin** and it picks up every video link
  posted there; as an ordinary member it only answers links that mention it
- `/stats` and a per-user **daily limit** (`DAILY_MB`, MB per UTC day, 10 GB
  default, `0` for none)
- Future work: see [ROADMAP.md](ROADMAP.md)

### Using it in a group

Add the bot to a group. Telegram's **privacy mode** means a bot that isn't an
admin only hears commands, mentions, and replies to its messages — so as an
ordinary member it downloads links only when they **mention it**
(`@yourbot_name`). **Make the bot an admin** (group → Administrators → add)
and it sees every message, so it picks up bare video links too. It learns each
group's standing from the membership updates, so the rule follows you if you
promote or demote it later. (A personal bot with no strangers: admin is the
convenient default; privacy mode in BotFather is the alternative.)

### The main menu (`/menu`)

`/menu` shows an inline board:

- **Best / 720p / Audio / Transcript** — sets your *default quality* for bare
  YouTube links. Once set, such a link downloads straight at that quality
  instead of offering the one-tap quality menu.
- **Language** — re-opens the `/lang` board, so you can switch language any
  time, not only at start.
- **About** — the help.

Choices are stored per user, so group members can't change each other's.


## Prerequisites

Only **Docker** (with the Compose plugin) is required — bun, yt-dlp and ffmpeg
are all installed inside the container images.

## Configuration (.env)

A single `.env` at the repo root configures **both services** (bot + Bot API
server):

```bash
cp .env.example .env
nano .env
```

| Variable | Required | Description |
|---|---|---|
| `TOKEN` | **yes** | bot token from @BotFather |
| `TELEGRAM_API_ID` | **yes** | from [my.telegram.org](https://my.telegram.org) → *API development tools* (for 2GB) |
| `TELEGRAM_API_HASH` | **yes** | same page |
| `YTDLP_UPDATE` | no | `off` = pin the installed yt-dlp (template default) |
| `MAX_DOWNLOADS` | no | concurrent downloads (default 8) |
| `DAILY_MB` | no | per-user daily cap in MB, per UTC day (default 10240, `0` for none) |
| `ADMIN_ID` | no | Telegram user id to alert if the YouTube login/cookies die |
| `DATA_DIR` / `STATS_PORT` / `STORAGE_CHAT` / `COOKIES` | no | see `.env.example` |

## Run

```bash
docker compose up -d --build
docker compose logs -f
```

Containers:
- `tg-media-bot` — the bot itself (polling + yt-dlp + ffmpeg)
- `tg-botapi` — local Bot API server with `--local` → uploads up to **2 GB**

Day-to-day management:

```bash
docker compose ps              # status
docker compose logs -f         # logs
docker compose down            # stop
git pull && docker compose up -d --build   # update
```

## One-shot install on a Linux host

```bash
git clone <this-repo> && cd tg-media-bot
bash scripts/install-linux.sh   # installs Docker, creates .env, runs compose up
```

## git / updating from upstream

This repo sits on the upstream history (one "deployment layout" commit on top of
the latest upstream commit). The `upstream` remote points to
[Borodutch/VideoDownloadBot](https://github.com/Borodutch/VideoDownloadBot):

```bash
git pull --no-rebase --no-edit upstream main   # update the bot code
# after merging:
cd bot && bun install && bun test
```

## Tests

The bot's own test suite (no real token, uses a fake Bot API):

```bash
cd bot
bun install
bun test            # unit + e2e (needs ffmpeg and yt-dlp on PATH)
```

CI runs on every push (`.github/workflows/ci.yml`).

## Practical notes (learned from bring-up)

- **YouTube IP blocking:** if your host has a datacenter IP, YouTube may refuse
  requests. Solutions already in the upstream code: `WARP_PROXY` (WARP proxy for
  YouTube-hosted servers) and `COOKIES` (a logged-in session).
- **`EGRESS_DENY is empty`** is harmless when self-hosting (it is only a
  recommendation for cloud hosts).
- **50 MB cap:** without a local Bot API server, files larger than 50 MB are not
  sent (Telegram cloud API limit).
- **my.telegram.org credentials:** a wrong `api-id/api-hash` shows up as
  `invalid api-id/api-hash` when the local server calls `getMe`; correct ones
  answer with `{ok:true, ...}`.

## Backlog

See [ROADMAP.md](ROADMAP.md) for the researched future work (groups and
channels, welcome message, language selection, main menu, webhook, ideas from
@uploadbot). Still open, in short:

- [ ] user **whitelist**
- [ ] speech-to-text transcription (optional)

## License

MIT — core code: Borodutch/VideoDownloadBot (MIT). Changes in this repo are also MIT.
