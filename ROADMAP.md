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

**Recommendation:**
- **Groups (small step):** the bot already half-supports groups (it is
  summoned there). To make group use first-class:
  1. Document in the README: add the bot to the group, **make it an admin**
     (otherwise privacy mode means it only hears mentions), or disable
     privacy mode in BotFather.
  2. Add a per-chat "summons required" setting: in groups where the bot is
     *not* an admin, require the summon (`@danloadr_bot`) so it stays out of
     the way; when it *is* an admin it can pick up bare links (detect via
     the `my_chat_member` update, which is already subscribed).
  3. Keep the quality menu **private-chat-only** (it is); in groups, default
     to best quality and let a `/quality@bot` command or a menu (item 4)
     override per chat.
- **Channels (bigger step, do later):**
  1. Accept a `channel_post` in channels where the bot is admin: if the post
     is a link the bot handles, download and repost the result **to the same
     channel** (the bot's `chat_id` in the channel post gives the target).
  2. This turns the bot into an auto-media-pipeline for a channel the user
     runs — the highest-value channel use for a personal bot.
  3. Guard: only act on channels where the bot's status is `administrator`
     (from `my_chat_member`), and cap how many such channels are active.

**Verdict:** groups are a near-term win (docs + admin detection + per-chat
summon rule); channel auto-posting is a distinct feature to build after the
menu system, reusing the same `handle()` path with a `channel_post`-sourced
`Dest`.

## 2. Welcome message

- On `/start` (and on the first link in a fresh private chat), send a short
  feature list in the user's language:
  - links it handles (YouTube, Instagram, X/Twitter, TikTok, …),
  - the quality menu (best / 720p / audio / transcript for YouTube),
  - how to summon it in groups (`@danloadr_bot`),
  - file size limit (2 GB with the local Bot API server).
- Reuse the existing help text as the body; add the feature bullets. The bot
  already sends help when a non-link private message arrives, so the welcome
  is mostly a better `/start` answer.

## 3. Language selection

- The bot already detects `from.language_code` per message (with an `en`
  fallback). Add:
  1. A `/lang` command (and a menu button, item 4) that offers the 8
     supported languages.
  2. Store the choice in the existing SQLite database (a `users` table or a
     column): explicit choice wins over detection; detection only fills the
     gap when nothing is stored.
  3. Apply it to everything the bot says in that chat (help, statuses,
     menu, errors).

## 4. Main menu (inline)

- A persistent inline menu (the quality menu already shows the mechanism)
  reachable from `/menu`:
  - **Quality** (default for future downloads; YouTube today),
  - **Language** (item 3 — changeable mid-conversation, not just at start),
  - **About / help** (item 2).
- Implementation notes:
  - Callback data stays short (`m:lang`, `m:quality`, …) and state lives in
    the database keyed by chat, as the quality menu keeps its link in an
    in-memory map.
  - `answerCallbackQuery()` on every tap so the client stops spinning.
  - The menu button is per-chat state, so group members can't change each
    other's quality.

## 5. Webhook (documented, not planned)

- The bot stays on **polling** — it is simple, has no public endpoint, and
  at this traffic it is the right choice.
- If it is ever needed (lower latency, running without a long-lived
  process), the path is: a public HTTPS endpoint (e.g. Cloudflare Tunnel in
  front of the same container) + `setWebhook`. Nothing in the bot code
  should need to change; grammy handles both transports.

## 6. Ideas from @uploadbot

**Research:** @uploadbot is "a quick way to upload files to Telegram by
url", 500 MB per file, 1 GB per day, `/upgrade` for more. It is the same
category of bot as this one, with a freemium wall on volume.

**What to take:**
- **Daily/monthly usage stats:** the bot already tracks downloads in SQLite
  (`census`/`promo`). A `/stats` command showing this user's downloads this
  month is a cheap, useful addition.
- **A soft limit + /stats transparency:** personal use needs no paywall,
  but an explicit per-day cap (configurable, e.g. 10 GB) protects the
  server if the bot ever runs in a group with strangers. Show the cap in
  `/stats`.
- **`/upgrade` is not wanted** (personal bot, no monetization) — noted only
  to close the loop on the research.
- **Single-link UX:** @uploadbot's whole pitch is "paste a URL, get the
  file". Keep this bot's UX at least as frictionless; the quality menu
  (item 1 in the current build) must stay one tap from the link, not a
  menu maze.

## 7. Quality menu (done) and progress (done)

Implemented and shipped: inline quality menu for bare YouTube links
(best / 720p / audio / transcript, private chats, non-summoned), real
download percentage from the file size, and a live `⏫ Uploading… N MB`
status during the send. Transcript output goes out as a plain text message.
