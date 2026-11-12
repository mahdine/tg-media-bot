# Roadmap

Future work for the bot, in rough priority order. Items marked **[research]** are
grounded in research noted at the end of each entry.

## 1. Groups and channels

**Research (Telegram Bot Features, core.telegram.org/bots/features):**
- Bots added to groups run in **Privacy Mode** by default: they only see
  commands addressed to them (`/command@this_bot`), mentions, and replies to
  their messages. They always see service messages and all private-chat
  messages.
- A bot that is a **group admin** receives **all** messages, privacy mode
  on or off.
- A bot added to a **channel as admin** can post to it **on the channel's
  behalf** (messages appear as channel posts, "posted by @channel"), and
  receives every `channel_post` update — this is the mechanism for
  auto-posting downloaded media into a channel.
- `file_id` is tied to a single bot, so a test bot can't reuse production
  file_ids.

**Groups (done):** the bot now detects its standing per group and applies the
rule. `my_chat_member` (already subscribed) keeps an `admin` table (chat →
0/1) in step: **an admin group picks up every video link posted there; a
group the bot is only a member in answers links that mention it** (the
privacy-mode behavior). `requested()` takes the group's admin flag, so a bare
link is a request in an admin group as it is in a private chat, and a
mention in any group. The quality menu stays private-chat-only (in a group a
bare link downloads at best, or the user's `/menu` default for YouTube).
Documented in the README ("Using it in a group"). See `adminOf`/`adminSet`
in `bot.ts`, the `requested` admin parameter, and the e2e "a bare link in a
group is a request only while the bot is an admin there".

**Channels (bigger step, still open):**
1. Accept a `channel_post` in channels where the bot is admin: if the post
   is a link the bot handles, download and repost the result **to the same
   channel** (the bot's `chat_id` in the channel post gives the target).
2. This turns the bot into an auto-media-pipeline for a channel the user
   runs — the highest-value channel use for a personal bot.
3. Guard: only act on channels where the bot's status is `administrator`
   (from `my_chat_member`), and cap how many such channels are active.

**Verdict:** groups done (docs + admin detection + per-chat summon rule);
channel auto-posting is a distinct feature, reusing the same `handle()` path
with a `channel_post`-sourced `Dest`.

## 2. Welcome message (done)

A fresh private chat (< 10 min old) hears it on `/start`, in the user's
own language (their `/lang` choice over Telegram's detection): what the
bot turns links into, the quality menu for bare YouTube links, the group
summon rule, the file limit (`{mb}`, the local server's 2000 MB), and the
`/lang` pointer. Not on `/help`, and not on a campaign's `/start` (whose
own text goes out). A day-old chat gets the help only. See `welcome()` in
`bot.ts`, the `welcome` key in `i18n.ts`, and the e2e "fresh private chat
hears the welcome".

## 3. Language selection (done)

`/lang` offers the bot's nine languages on an inline board (two rows of
5 and 4, each named in itself); `/lang <code>` takes a choice at once.
The choice is stored in the `lang` table by user id, an explicit choice
wins over detection (a code the bot doesn't speak is not silently
English), and everything it says in that chat goes out in it — help,
quality menu, download statuses, the guest answer, the welcome. See
`LANGS`/`normalize`/`resolve` in `i18n.ts`, the `/lang` command and the
`l:<code>` tap in `bot.ts`, and the e2e "board is tapped into a choice".
A main-menu button for it is item 4.

## 4. Main menu (inline) (done)

- A persistent inline menu reachable from `/menu`:
  - **Quality** — the default for future YouTube links. A tap on Best / 720p
    / Audio / Transcript stores it (per user, `quality` table) and a bare
    YouTube link then downloads straight at it instead of offering its own
    quality menu.
  - **Language** (item 3) — re-opens the `/lang` board, changeable
    mid-conversation.
  - **About / help** (item 2).
- Implementation, as planned:
  - Callback data is short (`mq:<quality>`, `m:lang`, `m:about`); state
    lives in the database keyed by user, as the language does.
  - `answerCallbackQuery()` on every tap so the client stops spinning; the
    board's message is edited in place with the confirmation.
  - Per-user state, so group members can't change each other's quality.
- See `/menu` in `bot.ts` (`menuBoard`, the `mq:`/`m:` taps), the `quality`
  table, `qualityName`, and the e2e "bot: /menu shows the board" and "bot: a
  default set in /menu makes a bare YouTube link download at it".

## 5. Webhook (documented, not planned)

- The bot stays on **polling** — it is simple, has no public endpoint, and
  at this traffic it is the right choice.
- If it is ever needed (lower latency, running without a long-lived
  process), the path is: a public HTTPS endpoint (e.g. Cloudflare Tunnel in
  front of the same container) + `setWebhook`. Nothing in the bot code
  should need to change; grammy handles both transports.

## 6. Ideas from @uploadbot (done)

**Research:** @uploadbot is "a quick way to upload files to Telegram by
url", 500 MB per file, 1 GB per day, `/upgrade` for more. It's the same
category of bot as this one, with a freemium wall on volume.

**What was taken:**
- **Daily/monthly usage stats:** a `usage` table (day, user, MB, count),
  credited with each completed job's sent MB (the file that went out: the
  bot's floor, 1, for the stub's under-1 MB clip; 0 for a cached copy or a
  transcript), keyed to the user's UTC day. `/stats` (private only) shows
  today, this UTC month, all time, and the cap's line. See `statsOf`/
  `formatSize`/`dayKey` in `bot.ts` and the e2e "/stats counts a finished
  download".
- **A soft limit + /stats transparency:** `DAILY_MB` (MB per user per UTC
  day, 10 GB default, `0` for none). A download starts only while the
  user's MB today are under the cap (the new file's size isn't predicted);
  the refusal goes out in the user's language, and groups/channels aren't
  capped. See `parseDailyMb`/`capDecision` and the e2e "the day fills to
  the cap download by download".
- **`/upgrade` is not wanted** (personal bot, no monetization) — noted only
  to close the loop on the research.
- **Single-link UX:** @uploadbot's whole pitch is "paste a URL, get the
  file". This bot's UX stays at least as frictionless: the quality menu
  (item 7) is one tap from the link, and `/menu`'s default quality skips it
  entirely when you always want the same thing.

## 7. Quality menu (done) and progress (done)

Implemented and shipped: inline quality menu for bare YouTube links
(best / 720p / audio / transcript, private chats, non-summoned), real
download percentage from the file size, and a live `⏫ Uploading… N MB`
status during the send. Transcript output goes out as a plain text message.
