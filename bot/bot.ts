import { Database } from 'bun:sqlite'
import { type Api, Bot, Context, GrammyError, InputFile, type Transformer } from 'grammy'
import type { ApiResponse, InlineKeyboardButton, InputMediaVideo, Message } from 'grammy/types'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { egressProxy, proxyFreeEnv } from './egress'
import { DRAIN, pollWithHandover } from './handover'
import { type Code, type Key, LANGS, normalize, resolve, t } from './i18n'
import { type Promo, promos } from './promo'
import { scratch } from './scratch'

const env = process.env
const API = env.BOT_API_URL || 'https://api.telegram.org'
// A local Bot API server takes uploads up to 2000 MB, the cloud one 50 MB
const LIMIT = (API.includes('api.telegram.org') ? 50 : 2000) * 1024 * 1024
// The user's downloads per UTC day, in MB (10 GB by default, 0 or
// unset/empty = no cap); a download starts only while the user's MB today
// are under it (capDecision)
export const DAILY_MB = () => parseDailyMb(env.DAILY_MB)
const COOKIES = env.COOKIES || '/cookies.txt'
const DATA = env.DATA_DIR || './data'
// file:// paths only work with a local Bot API server
const SCRATCH = scratch(API.includes('api.telegram.org') ? '' : undefined)
const TMP = SCRATCH.dir
// Videos downloaded and sent at once (slots), long ones in up to 7 of them by
// default. With 4 (3 for long ones), the 3 long slots were all busy for
// 88-96% of a day's busiest 6 hours, and long videos waited up to about 3
// hours for one (#395). The sites that fill them, adult CDNs at 0.1-1.3 MB/s,
// are slow per connection (Eporner kept its speed in 5 downloads at once,
// #298), so more at once get more done.
const MAX_DOWNLOADS = Number(env.MAX_DOWNLOADS || 8)
// A minute, in ms, of the download time limits, of how old saved info may
// get, of how often a download's files are weighed and of the waits between
// self-update tries (bot.e2e.test.ts shortens it)
const MINUTE = Number(env.MINUTE_MS) || 60_000
// how long a stopped yt-dlp run gets before it's over (bot.e2e.test.ts halves it)
const GRACE = Number(env.GRACE_MS) || 5_000
// How long after a guest message was sent the bot may wait for yt-dlp to find
// a video before it answers (guest()). Telegram expires a guest query that
// has no answer ("query is too old") but doesn't say when; a guest-mode bot
// in production answers its long runs at 45 s
// (github.com/aspalagin/openclaw-telegram-guest-mode). In 48 h of job lines,
// 4 of 1,732 pages without a video took over 30 s to get and run their -J.
const GUEST_WAIT = Number(env.GUEST_WAIT_MS) || 30_000
// bot.e2e.test.ts sets GUEST_GATES to a folder: then that wait ends when the
// test lets it, as $GUEST_GATES/<the message's guest_query_id> appears
// (<guest_query_id>.held says it's waiting), instead of after GUEST_WAIT,
// so no test races that timer (deadline())
const GUEST_GATES = env.GUEST_GATES
// Set YTDLP_UPDATE=off to pin the installed yt-dlp (no startup/daily self-update)
const NO_UPDATE = env.YTDLP_UPDATE === 'off'
// Only formats whose every request goes through the proxy: yt-dlp's own HTTP
// (HLS, DASH, websockets) and ffmpeg's http(s), which yt-dlp hands the proxy
// to. rtmp, rtsp and mms would connect directly.
const PROTOCOLS = `[protocol~='^(https?|m3u8(_native)?|http_dash_segments(_generator)?|f4m|ism|websocket_frag)$']`
// ffmpeg's http input lets a response turn into rtp/udp/rtsp (an SDP or a
// playlist pointing there), which would skip the proxy: keep it to these.
// Local files (merger, thumbnail) already default to file,crypto,data.
const FFMPEG_PROTOCOLS = 'http,https,tls,tcp,httpproxy,crypto,data'
// tcp and tls stay listed for http(s), but some demuxers (IMF, from an XML
// response) open such URLs on their own, direct: only HLS and its segments
const FFMPEG_FORMATS = 'hls,mpegts,mov,matroska,aac,mp3,flv,ac3,eac3,webvtt'

export const YTDLP = [
  '--no-playlist',
  '--playlist-items', '1',
  '--no-warnings',
  '--js-runtimes', 'bun',
  '-f', `bv*${PROTOCOLS}+ba${PROTOCOLS}/b${PROTOCOLS}`,
  '--downloader-args',
  `ffmpeg_i:-protocol_whitelist ${FFMPEG_PROTOCOLS} -format_whitelist ${FFMPEG_FORMATS}`,
  // h264/aac plays inline on every Telegram client
  '-S', 'vcodec:h264,res:1080,acodec:m4a',
  '--merge-output-format', 'mp4',
]

// The quality a YouTube link is offered (a menu the user picks from). Off in
// tests (no E2E_PARENT_PID), where a bare YouTube link must download at once,
// so a bot run with E2E_PARENT_PID set skips the menu (menu(), below).
export type Quality = 'best' | '720' | 'audio' | 'transcript'
// Each quality's yt-dlp args: the format (and, for audio, the extraction),
// replacing YTDLP's -f/-S/merge. 'best' is the default (YTDLP as-is).
export const qualityArgs = (q: Quality) =>
  q === 'best'
    ? []
    : q === '720'
      ? ['-f', `bv*[height<=720]${PROTOCOLS}+ba${PROTOCOLS}/b[height<=720]${PROTOCOLS}`, '-S', 'vcodec:h264,res:720,acodec:m4a', '--merge-output-format', 'mp4']
      : q === 'audio'
        ? ['-f', `ba${PROTOCOLS}/b${PROTOCOLS}`, '-x', '--audio-format', 'm4a', '--audio-quality', '0']
        : ['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'en,far,fa,ar']
// A transcript's subtitle, chosen from what yt-dlp left on disk: a manual
// sub beats an auto one (yt-dlp names the auto ones -orig when both are
// written), and the languages in the --sub-langs list go in their order —
// YouTube throttles the auto-caption endpoints (an HTTP 429 on one fails the
// run, the others already written), so the best of what came through is the
// answer
export const pickSub = (names: string[]) => {
  const sub = names.filter((n) => n.endsWith('.vtt'))
  const manual = sub.filter((n) => !n.endsWith('-orig.vtt'))
  const pool = manual.length ? manual : sub
  if (!pool.length) return undefined
  const rank = (n: string): [number, string] => {
    // yt-dlp names the auto ones -orig: <title> [id].<lang>-orig.vtt
    const base = n.endsWith('-orig.vtt') ? n.slice(0, -'-orig.vtt'.length) : n.slice(0, -'.vtt'.length)
    // the language's first segment: fa, far, en, ar (an auto one's -orig and
    // any -alt form go with it)
    const lang = base.slice(base.lastIndexOf('.') + 1).split('-')[0]!
    const i = ['fa', 'far', 'en', 'ar'].indexOf(lang)
    return [i < 0 ? 4 : i, n]
  }
  return [...pool].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    return ra[0] - rb[0] || (ra[1] < rb[1] ? -1 : ra[1] > rb[1] ? 1 : 0)
  })[0]!
}
// What downloadProgress() reports: the bytes on disk now, of the total the
// picked formats say the file weighs (undefined when yt-dlp doesn't say)
export const downloadProgress = (have: number, total: number | undefined) =>
  total && total > 0 ? Math.min(100, Math.max(0, Math.round((have / total) * 100))) : undefined
// A YouTube link's video: a watch or short (a playlist, channel or live
// handle isn't a single video the user would ask to download)
export const youtubeVideo = (url: string) =>
  /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/\w+)|youtu\.be\/\w+)/.test(url)
// A WebVTT transcript, as plain text: the header, cue indexes and timestamps,
// the styling tags and the cue settings are dropped, what's left is the words
// (one per line). YouTube's auto captions say each sentence in the cue it
// starts, again in a 10 ms bridging cue, and again at the top of the next
// one's: three times, back to back. A sentence the speaker repeats for real
// comes seconds apart, in cues that carry other words between — so the
// collapse is the consecutive duplicate alone.
export const vttText = (vtt: string) => {
  const lines = vtt.split(/\r?\n/)
  // the file header (WEBVTT, Kind:, Language:) is the block before the first
  // blank line: drop it, then the cues follow
  let i = 0
  while (i < lines.length && lines[i]!.trim() !== '') i++
  i++ // and the blank line that ends it
  const out: string[] = []
  for (const raw of lines.slice(i)) {
    const line = raw.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim()
    if (!line) continue
    if (/^(NOTE|STYLE|REGION)/.test(line)) continue
    if (line.includes('-->')) continue
    if (/^(Align|Line|Position|Size|Vertical|::)/.test(line)) continue
    if (/^[\d.,:\s-]+$/.test(line)) continue // a timestamp or a bare cue index
    if (out[out.length - 1] === line) continue // the same sentence said again
    out.push(line)
  }
  return out.join('\n').trim()
}

type Kind = 'video' | 'animation' | 'audio' | 'document'
// text = a transcript (the quality 'transcript'): no file, the words sent in
// the video's place. file_id is '' (a transcript is never sent as a file)
type File = { kind: Kind; file_id: string; title: string; url: string; text?: string }
type Opts = Parameters<Context['api']['sendVideo']>[2] &
  Parameters<Context['api']['sendAudio']>[2]
// Where a file goes: a chat, replying to a message there, with a promo line
// or button if the user's experiment arm has one (promo.ts); sent = the id
// of the message that carried it; stale = a cached video that went out
// without a size, being downloaded again to replace it: that message and
// its file_id; who = the user who asked, whose jobs take turns with everyone
// else's (limit); uploading = its own job has begun the upload
type Dest = {
  chat: number | string
  reply?: number
  sent?: number
  promo?: Promo
  stale?: { message: number; file_id: string }
  who?: number
  uploading?: boolean
  quality?: Quality
  // The file's MB, set by job() just before it says "uploading": the status
  // shows the size, as the API reports no upload progress of its own
  uploadMb?: number
  // Told the download's percent (and MB) as it goes; handle() wires it to a
  // status edit. Read only, never edited once set.
  onProgress?: (pct: number | undefined, mb: number) => void
}
// Guest replies can't upload, so their files go through this chat first
// (the message is deleted right after, the file_id stays valid)
const STORAGE = env.STORAGE_CHAT || env.ADMIN_ID

// Thrown with the message to show; null = not a video, stay quiet in groups
export class Fail extends Error {
  constructor(public key: Key | null, why = key ?? 'not a video') {
    super(why)
  }
}

// News sites' extractors, which claim plain article URLs (not their video,
// live and embed pages)
const NEWS = /^(?!.*(video|live|embed)).*(article|news)|^(bbc|cnn|spiegel|voxmedia|lenta)$/i

// Whether a yt-dlp error means the page has no video rather than a video
// that failed: the generic extractor on any page (no such site, 403, nothing
// embedded) or a site saying so. Not getting or not parsing the page only
// counts from a news extractor (NYT, Spiegel, Vox on an article without
// media); on a video site it's a real failure. Crashes carry no [extractor]
// tag, so ies = the extractors that claim the link.
export function notVideo(why: string, ies: string[] = []) {
  if (/unsupported url|no video|no media|media blocks|\[generic\]/i.test(why))
    return true
  if (!/unable to (download webpage|extract|find)|extractor error has occurred/i.test(why))
    return false
  const tag = why.match(/^(?:ERROR: )?\[([^\]]+)\]/)?.[1]
  const by = tag ? [tag] : ies
  return by.length > 0 && by.every((ie) => NEWS.test(ie))
}

// A stream that hasn't started makes yt-dlp -J fail: YouTube's own reasons
// ("This live event will begin in 5 hours.", "Premieres in 3 hours") and
// other sites' extractor messages ("This livestream has not yet started").
// An offline channel ("The channel is not currently live") stays a failure:
// nothing says a stream is coming.
const UPCOMING = /live event will begin|: premieres?\b|(stream|event|broadcast|space)\b.* not (yet )?started|not started yet|event will start at|scheduled for/i

// 'upcoming' for a yt-dlp error saying the stream hasn't started, else null
export const unstarted = (why: string): Key | null =>
  UPCOMING.test(why) ? 'upcoming' : null

// What to say about a stream yt-dlp can't download yet, or null: live now,
// or announced and not started. A stream that just ended (post_live) is
// tried like a video.
export const unready = (v: any): Key | null =>
  v.is_live || v.live_status === 'is_live'
    ? 'live'
    : v.live_status === 'is_upcoming'
      ? 'upcoming'
      : null

// The video in what yt-dlp -J printed, or Fail(null) when there is none
export function picked(info: any) {
  // yt-dlp prints null when the page had nothing (a t.me text post)
  if (!info) throw new Fail(null, 'nothing extracted')
  // YouTube playlists, channels and feeds (WL, LL, history) would hand out
  // what the logged-in cookies can see; --no-playlist already reduces
  // watch?v=…&list=… to the video. Multi-video posts elsewhere stay.
  if (info._type === 'playlist' && /^youtube/i.test(info.extractor_key))
    throw new Fail(null, 'youtube playlist')
  // an article page without media is an empty playlist (BBC, CNN)
  if (info._type === 'playlist' && !info.entries?.[0])
    throw new Fail(null, 'empty playlist')
  return info.entries?.[0] ?? info
}

// A tweet with only text or pictures: shared everywhere, never worth an answer
const TWEET_NO_VIDEO = /\[twitter\].*no video could be found/i

// A status link on a real tweet/x host, and the post id in it
const TWEET_LINK = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/i

// The text of the post a no-media link points at, to send it as: the post's
// text with its author and link (and photo links when it has none), or null
// when the post is gone or unfetchable; undefined when the link isn't a no-
// media tweet, as a page yt-dlp says so about. (A deleted post, a private
// one, and one the API can't reach all come back null.)
export async function tweetText(url: string, why: string): Promise<string | null | undefined> {
  if (!TWEET_NO_VIDEO.test(why)) return undefined
  const m = url.match(TWEET_LINK)
  if (!m) return undefined
  try {
    const r = await fetch(`https://api.fxtwitter.com/${m[3]}/status/${m[4]}`, {
      signal: AbortSignal.timeout(20_000),
    })
    const j: any = (await r.json().catch(() => undefined))
    if (j?.code !== 200 || !j.tweet) return null
    const author = j.tweet.author?.screen_name
    let text = (j.tweet.text || '').trim()
    const photos = (j.tweet.media?.photos ?? [])
      .map((p: any) => p.url)
      .filter((u: any) => typeof u === 'string')
    if (!text && !photos.length) return null
    // Telegram's message length, the author, the link and the photos aside
    text = text.length > 3_900 ? text.slice(0, 3_900) + '…' : text
    const out = [text, author ? `@${author}` : '', `https://x.com/${author ?? 'i'}/status/${j.tweet.id}`, ...photos]
      .filter(Boolean)
      .join('\n')
    return out
  } catch {
    return null
  }
}

// A no-media post yt-dlp failed on: its text to send instead (null when the
// post is gone or unfetchable — then it hears tweetNotFound, as one who asked
// would a failure)
export class Tweet extends Fail {
  constructor(public text: string | null, why: string) {
    super(text ? null : 'tweetNotFound', why)
  }
}

// What to tell the chat about a failed link, null = nothing. "Not a video"
// only gets an answer from whoever asked the bot itself; a post that's gone
// is told the same way (a tweet whose text went out has already been answered).
export const answer = (key: Key | null, chat: string, called: boolean, why = '') =>
  TWEET_NO_VIDEO.test(why)
    ? key === 'tweetNotFound'
      ? chat === 'private' || called
        ? 'tweetNotFound'
        : null
      : null
    : key ?? (chat === 'private' || called ? 'failed' : null)

// What a guest message that doesn't mention the bot hears about a failed link
// before it has had an answer, null = nothing: what a group message would
// without a status up (guest()). That's not even the restart that dropped the
// link, whose page may have no video.
export const unasked = (key: Key | null, why = '') => {
  const told = answer(key, 'guest', false, why)
  return told === 'restarting' ? null : told
}

// Calls f in ms, when the answer to guest message id can't wait any longer
// (guest()), or with GUEST_GATES once the test lets it: never in the turn
// that sets it, so what that turn's own promises note comes first. Returns
// what calls it off.
export function deadline(id: string, ms: number, f: () => void) {
  if (!GUEST_GATES) {
    const timer = setTimeout(f, Math.max(0, ms))
    return () => clearTimeout(timer)
  }
  const gate = join(GUEST_GATES, id)
  let on = true
  const off = () => {
    on = false
    rmSync(`${gate}.held`, { force: true })
  }
  writeFileSync(`${gate}.held`, '')
  void (async () => {
    do await Bun.sleep(20)
    while (on && !existsSync(gate))
    if (!on) return
    off()
    f()
  })()
  return off
}

// Whether a chat hears that its link waits for a slot, or that a restart
// dropped it. Groups only do when they asked the bot itself: a burst of links
// there would become a burst of replies on top of the videos, and Telegram
// allows a group ~20 messages a minute (a 429 isn't retried).
export const tellQueued = (chat: string, called: boolean) => chat === 'private' || called

// t.me/s/<channel>/<post> is the channel's web preview, which yt-dlp reads
// as a list of the latest posts: the post itself is t.me/<channel>/<post>
const tme = (url: URL) => {
  if (/^(t|telegram)\.me$/i.test(url.hostname))
    url.pathname = url.pathname.replace(/^\/s\/([^/]+\/\d+)/, '/$1')
  return url
}

export function urls(msg: Message) {
  const text = msg.text ?? msg.caption ?? ''
  const found = (msg.entities ?? msg.caption_entities ?? []).flatMap((e) =>
    e.type === 'url'
      ? [text.slice(e.offset, e.offset + e.length)]
      : e.type === 'text_link'
        ? [e.url]
        : [],
  )
  return [
    ...new Set(
      found.flatMap((u) => {
        try {
          const url = tme(new URL(/^\w+:\/\//.test(u) ? u : `https://${u}`))
          return /^https?:$/.test(url.protocol) && isPublic(url.hostname)
            ? [url.href]
            : []
        } catch {
          return []
        }
      }),
    ),
  ]
}

// Called on by an @mention
export const summoned = (msg: Message, username: string) =>
  new RegExp(`@${username}\\b`, 'i').test(msg.text ?? msg.caption ?? '')

// The bot, as getMe has it, and whether a file (its file_unique_id) is the
// bot's: one it has sent
type Me = { id: number; username: string; mine: (file: string) => boolean }

// The bot's own message: a forward of one, one sent through it (inline), or
// one with a file the bot has sent. A forward that hides the sender's name,
// or a copy a client or another bot makes, comes as the sender's own message
// with nothing of the bot's left but the file, whose file_unique_id is the
// same in every chat. Its videos' captions have the link and the @mention
// that ask it for the video, so its video forwarded into another chat it's
// in would go out there twice.
export const own = (msg: Message, me: Me) => {
  const file = msg.video ?? msg.animation ?? msg.audio ?? msg.document
  return (
    msg.via_bot?.id === me.id ||
    (msg.forward_origin?.type === 'user' && msg.forward_origin.sender_user.id === me.id) ||
    (!!file && me.mine(file.file_unique_id))
  )
}

// Also the links in the message replied to when the bot is summoned. The
// bot's own messages ask for nothing, as the message or the one replied to.
export function links(msg: Message, me: Me) {
  if (own(msg, me)) return []
  const reply = summoned(msg, me.username) ? msg.reply_to_message : undefined
  const theirs = reply && reply.from?.id !== me.id && !own(reply, me) ? urls(reply) : []
  return [...new Set([...urls(msg), ...theirs])]
}

// Extractors that claim links without being a site's video extractor: the
// generic one takes any page, the others only refuse (Spotify, Netflix, …)
const NOT_SITES = new Set(['generic', 'DRM', 'Piracy', 'Liability'])

// Each link's own-site yt-dlp extractors. Decided from the URLs alone,
// nothing is fetched: --list-extractors prints each extractor with the URLs
// it matches below it.
export async function claims(urls: string[]) {
  const by = new Map<string, string[]>()
  if (!urls.length) return by
  const { out } = await check.run(() => ytdlp(['--list-extractors', '--', ...urls]))
  let ie = ''
  for (const line of out.split('\n'))
    if (!line.startsWith(' ')) ie = line.replace(/ \(CURRENTLY BROKEN\)$/, '')
    else if (!NOT_SITES.has(ie)) by.set(line.trim(), [...(by.get(line.trim()) ?? []), ie])
  return by
}

// The links a site's own extractor claims
export async function videos(urls: string[]) {
  const by = await claims(urls)
  return urls.filter((u) => by.has(u))
}

// What a message asks to download. In groups a link mentioned in passing
// (a bare domain, an article) isn't a request: unless the bot is summoned,
// only links to a site yt-dlp knows count. The same goes for a guest message
// (chat 'guest') in any chat, a private one too: Telegram calls the bot on a
// plain reply to one of its messages as well, mention or not.
export async function requested(
  msg: Message,
  me: Me,
  chat: string,
  video = videos,
) {
  const found = links(msg, me)
  return chat === 'private' || summoned(msg, me.username) || !found.length
    ? found
    : video(found)
}

// First line against links into the docker network: no IP literals (the URL
// parser normalizes 2130706433 and 0x7f.1 to 127.0.0.1), no dotless service
// names, no local-only TLDs. Redirects and public names that resolve inside
// are stopped by the egress proxy yt-dlp goes through (egress.ts).
function isPublic(host: string) {
  host = host.replace(/\.$/, '') // "name." is the same docker service
  return (
    host.includes('.') &&
    !host.startsWith('[') &&
    !/^[\d.]+$/.test(host) &&
    !/\.(localhost|local|internal|lan|home\.arpa)$/i.test(host)
  )
}

let proxy: Promise<string> | undefined
// YouTube blocks the server's own address (#415), so its hosts go out through
// Cloudflare WARP: WARP_PROXY is the videodownloadbot-warp service's HTTP proxy
// (host:port, wireproxy from the Dockerfile's warp stage)
export const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com|ytimg\.com)\.?$/i
const warp = (host: string) => (env.WARP_PROXY && YOUTUBE.test(host) ? env.WARP_PROXY : undefined)
// ponytail: in-process daily self-update; pin a version if nightly ever breaks
// The update swaps the binary out, so a run started meanwhile waits for it
// (else spawn fails with "Executable not found"); it takes seconds, and a
// hung one can't hold every download back for long. A run already going may
// still fail on the swap, as the one-file yt-dlp reads its modules from the
// binary's path while it imports them: the daily update swaps it while jobs
// run, and so does a retry after a failed first try (selfUpdate).
let updating: Promise<unknown> = Promise.resolve()
// One try at it: yt-dlp's exit code, or null when the time limit's SIGTERM
// stopped it (PyInstaller's bootloader hands that on to yt-dlp and then dies
// by it too). Another signal (an OOM kill) gives an exit code like any
// failure. cmd and limit differ only in tests.
export const updateOnce = (cmd = ['yt-dlp', '--update-to', 'nightly'], limit = 5 * 60_000) => {
  const p = Bun.spawn(cmd, {
    env: { ...process.env, ...SCRATCH.env },
    stdout: 'inherit',
    timeout: limit,
    killSignal: 'SIGTERM',
  })
  const tried = p.exited.then((code) => (p.signalCode === 'SIGTERM' ? null : code))
  updating = tried
  return tried
}

// The minutes from a failed self-update to its next try. GitHub refuses
// yt-dlp's version check (HTTP 403 "rate limit exceeded") once the address
// the bot shares has used up its hourly API limit, which renews within the
// hour, so the last retry comes just over an hour after the first try (#416).
const UPDATE_RETRIES = [1, 2, 4, 8, 16, 32]

// Updates yt-dlp to the newest nightly: run() is one try, resolving to
// yt-dlp's exit code (null when the time limit stopped it). A failed try goes
// again after each of waits (ms) in turn, until one works, and every failure
// leaves a log line. After one that ran out of time, only the last (longest)
// wait's try is left: a try that's running holds yt-dlp runs back (updating;
// at the start, polling), so that one held them for 5 minutes, and one right
// after might too. yt-dlp gives up on a server that doesn't answer within
// 20 s, so it takes a transfer that trickles or a stuck run. first = the
// first try's result; retries = the whole update, over once a try has worked
// or none is left. pause is Bun.sleep and log console.error but in tests.
export function selfUpdate(
  run: () => Promise<number | null>,
  waits = UPDATE_RETRIES.map((m) => m * MINUTE),
  pause: (ms: number) => Promise<unknown> = Bun.sleep,
  log: (line: string) => void = console.error,
) {
  const first = run()
  const retries = (async () => {
    let code = await first
    for (let i = 0; code !== 0; i++) {
      if (code === null) i = Math.max(i, waits.length - 1)
      const ms = waits[i]
      const next = ms === undefined ? 'next try tomorrow' : `retry ${i + 1}/${waits.length} in ${+(ms / 60_000).toFixed(1)} min`
      log(`yt-dlp update ${code === null ? 'timed out' : `failed (${code})`}, ${next}`)
      if (ms === undefined) return
      await pause(ms)
      code = await run()
    }
  })().catch(console.error)
  return { first, retries }
}

// yt-dlp ran out of time and was stopped
export class Timeout extends Error {}

// The yt-dlp runs going now, each with a way to end its whole group at once:
// an e2e bot whose test process is gone ends them as it exits (below)
const runs = new Set<() => void>()

// Runs yt-dlp, stopped after timeout ms or once signal aborts: then a Timeout
// or the abort's reason is thrown, unless yt-dlp still exits 0 and its output
// closes within 5 s of the stop
async function ytdlp(args: string[], timeout = 30 * 60_000, signal?: AbortSignal) {
  // a failed listen isn't kept: the next download tries again
  proxy ??= egressProxy(undefined, undefined, warp).catch((e) => {
    proxy = undefined
    throw e
  })
  await updating
  const via = await proxy
  // an abort while it waited (a self-update) won't come again
  signal?.throwIfAborted()
  // In a process group of its own: yt-dlp hands m3u8 and some HLS downloads
  // to ffmpeg, which inherits its pipes and goes on when yt-dlp alone is
  // stopped, so a stop stops the whole group
  const p = Bun.spawn(['yt-dlp', '--proxy', via, ...args], {
    env: { ...proxyFreeEnv(), ...SCRATCH.env },
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  })
  // the group, or yt-dlp alone if there's no group; none once the run is
  // over, whatever timer or abort comes late (its number could lead another
  // group by then)
  let over = false
  const kill = (sig: NodeJS.Signals) => {
    if (over) return
    try {
      process.kill(-p.pid, sig)
    } catch {
      p.kill(sig)
    }
  }
  const end = () => kill('SIGKILL')
  runs.add(end)
  // why the run was stopped, the first time: SIGTERM, and GRACE (5 s) later
  // the run is over, even if something still holds the pipes
  let stopped: Error | undefined
  const cutoff = Promise.withResolvers<void>()
  const timers: ReturnType<typeof setTimeout>[] = []
  const stop = (why: Error) => {
    if (stopped) return
    stopped = why
    kill('SIGTERM')
    timers.push(setTimeout(cutoff.resolve, GRACE))
  }
  timers.push(
    setTimeout(
      () => stop(new Timeout(`yt-dlp timed out after ${+(timeout / 60_000).toFixed(1)} min`)),
      timeout,
    ),
  )
  const abort = () => stop(signal!.reason)
  signal?.addEventListener('abort', abort)
  try {
    const run = await Promise.race([
      Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]),
      cutoff.promise,
    ])
    if (!run || (run[2] && stopped)) throw stopped
    const [out, err, code] = run
    if (code) throw new Error(err.trim().split('\n').pop() || `yt-dlp ${code}`)
    return { out, err }
  } finally {
    // Then whatever is left of a stopped run's group gets SIGKILL, whether
    // it holds the pipes or not (a merge's ffmpeg doesn't). While anything is
    // left no other group can have the number, and since pids are handed out
    // in turn, neither can one just after the last of it is gone
    if (stopped) kill('SIGKILL')
    over = true
    runs.delete(end)
    signal?.removeEventListener('abort', abort)
    for (const t of timers) clearTimeout(t)
  }
}

type Size = { width: number; height: number }

// The size a player shows a video stream at (ffprobe's stream entry): the
// coded size stretched by the sample aspect ratio, turned by the rotation
export function shown(s: any): Size | undefined {
  if (!(s?.width > 0 && s?.height > 0)) return
  // "0:1" or "N/A" = unknown, square pixels
  const [n, d] = String(s.sample_aspect_ratio).split(':').map(Number)
  const width = n > 0 && d > 0 ? Math.round((s.width * n) / d) : s.width
  const rotation = Number(
    s.side_data_list?.find((x: any) => x.rotation !== undefined)?.rotation ??
      s.tags?.rotate ??
      0,
  )
  return Math.abs(rotation) % 180 === 90
    ? { width: s.height, height: width }
    : { width, height: s.height }
}

// Telegram draws the player box from sendVideo's width/height and ignores the
// file's pixel aspect: they come from the file itself, since yt-dlp often has
// none (Instagram's progressive mp4s) or another format's
export async function probe(path: string) {
  const p = Bun.spawn(
    [
      'ffprobe', '-v', 'error', '-select_streams', 'V:0',
      '-show_entries', 'stream=width,height,sample_aspect_ratio:stream_side_data=rotation:stream_tags=rotate',
      '-of', 'json', path,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  )
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited])
  if (code) return
  try {
    return shown(JSON.parse(out).streams?.[0])
  } catch {
    return
  }
}

// The thumbnail's filter: square pixels first (ffmpeg has already applied
// the rotation), then within 320x320
export const THUMB = "scale='iw*sar':ih,scale=320:320:force_original_aspect_ratio=decrease"

// A new file rather than a cached file_id (a local file:// path is new too)
export const fresh = (f: string | InputFile) =>
  typeof f !== 'string' || f.startsWith('file:')

// Runs at most max fns at once, long ones at most maxLong of them, the rest
// wait their turn. who = whose fn (a user): one user's fns get at most
// max - 1 turns, and long ones maxLong - 1 (all of them when there's only
// one), so a burst of one user's links always leaves someone else a turn; a
// free turn goes to the first in line among those with the fewest running
// whose fn fits. Fns without a who share no such limit. A fn in line holds
// nothing.
export function limit(max: number, maxLong = max) {
  let running = 0
  let long = 0
  // each user's running fns: all of them and the long ones
  const per = new Map<unknown, { all: number; long: number }>()
  const mine = (who: unknown) => per.get(who) ?? { all: 0, long: 0 }
  const add = (who: unknown, isLong: boolean, n: number) => {
    running += n
    if (isLong) long += n
    const m = mine(who)
    const now = { all: m.all + n, long: m.long + (isLong ? n : 0) }
    if (now.all) per.set(who, now)
    else per.delete(who)
  }
  // one user's part of n turns
  const share = (n: number) => Math.max(1, n - 1)
  const fits = (who: unknown, isLong: boolean) => {
    const m = mine(who)
    return (
      running < max &&
      !(isLong && long >= maxLong) &&
      (who === undefined || (m.all < share(max) && !(isLong && m.long >= share(maxLong))))
    )
  }
  // Nothing in line fits: ended turns go to the ones that do (one ending can
  // let in two: one its user's part held back, and one more), so a new fn
  // that fits jumps nobody who could run
  const queue: { who: unknown; long: boolean; go: () => void; stop: (e: Error) => void }[] = []
  let closed: Error | undefined
  // Waits for a turn; the returned fn ends it
  const take = async (who?: unknown, isLong = false) => {
    if (closed && (isLong || !fits(who, isLong))) throw closed
    if (fits(who, isLong)) add(who, isLong, 1)
    else await new Promise<void>((go, stop) => queue.push({ who, long: isLong, go, stop })) // counted in by whoever hands over
    let done = false
    return () => {
      if (done) return
      done = true
      add(who, isLong, -1)
      for (;;) {
        let next = -1
        queue.forEach((w, i) => {
          if (fits(w.who, w.long) && (next < 0 || mine(w.who).all < mine(queue[next]!.who).all))
            next = i
        })
        if (next < 0) return
        const w = queue.splice(next, 1)[0]!
        add(w.who, w.long, 1)
        w.go()
      }
    }
  }
  return {
    take,
    async run<T>(fn: () => Promise<T>, who?: unknown) {
      const done = await take(who)
      try {
        return await fn()
      } finally {
        done()
      }
    },
    // whether a new fn of who's would have to wait (once closed, it fails or
    // starts at once)
    busy: (isLong = false, who?: unknown) => !closed && !fits(who, isLong),
    // the fns in line when a new one asks, other users' that wait only for
    // their own part included: long ones only count for a short one while
    // they could have a turn
    waiting: (isLong = false) =>
      queue.filter((w) => isLong || !w.long || long < maxLong).length,
    // How many of who's fns, long or short, have a turn or wait in line for
    // one: with none, a new fn of theirs that has to wait waits for other
    // users' fns alone. Fns without a who share no part and count none.
    own: (who: unknown) =>
      who === undefined ? 0 : mine(who).all + queue.filter((w) => w.who === who).length,
    // Fails the fns still waiting with e, and later ones that would have to
    // wait or are long (a restart has time for a short one); running ones go on
    close(e: Error) {
      closed = e
      for (const w of queue.splice(0)) w.stop(e)
    },
  }
}

// What yt-dlp says the formats it picked weigh (video and audio, or the one),
// undefined for one it doesn't say
type Weighed = { filesize?: number | null; filesize_approx?: number | null }
export const sizes = (v: Weighed & { requested_formats?: Weighed[] }) =>
  (v.requested_formats ?? [v]).map((f) => f.filesize || f.filesize_approx || undefined)

// Long videos: over 10 minutes. One that doesn't say how long it is counts as
// long too (an HLS/DASH stream or a file of unknown length can take 20-40
// minutes), unless it's from Instagram or an X post, whose reels and GIFs
// usually don't say and come in seconds, or yt-dlp says what all of it weighs
// and that's 100 MB at most (typically under 2 minutes). X is the Twitter key
// alone: TwitterBroadcast and TwitterSpaces are long HLS replays.
export const LONG = 10 * 60
export const SMALL = 100 * 2 ** 20
const QUICK = /^(Instagram\w*|Twitter)$/
export const isLong = (
  v: Parameters<typeof sizes>[0] & { duration?: number | null; extractor_key?: string },
) => {
  if (v.duration && v.duration > 0) return v.duration > LONG
  if (QUICK.test(v.extractor_key ?? '')) return false
  const s = sizes(v)
  return s.includes(undefined) || s.reduce<number>((all, n) => all + n!, 0) > SMALL
}

// The minutes a job may spend downloading: 45 for a long video, else 30. Some
// sites (adult CDNs) serve one connection at about 1-1.3 MB/s, where the
// biggest file a local Bot API takes (2000 MB) can need about 35 minutes, and
// a flat 30 cut off about 8 downloads a day, mostly from such sites (#298).
// With two or more slots long videos leave short ones a slot, so the longer
// limit mostly holds up other long ones.
export const downloadMinutes = (long: boolean) => (long ? 45 : 30)

// yt-dlp's saved info over a minute old: its media links may have expired
// while the job waited its turn
export const stale = (age: number) => age > MINUTE
// Whether a download from stale saved info that failed gets another try that
// reads the page again, in the time the job has left: when over a minute is
// (none is, after a timeout)
export const reread = (age: number, left: number) => stale(age) && left > MINUTE

// Whether the page read again picks the file(s) the failed try got part of.
// yt-dlp's --continue goes on from whatever file has the name it's about to
// write, a .part by its bytes (an HTTP Range request) and a .ytdl by its
// fragment index, without asking which format that came from, and one
// format's name is the extension alone (v.mp4.part): another format's bytes
// or fragments would be appended to the first one's. The same pick is of the
// same video (a multi-video post's first one may change) and has formats with
// the same ids and encodings: yt-dlp numbers the formats a site gives no id
// of their own (0, 1, … in its order, hls-N), so an id alone could name
// another file. Each format also has the same exact size, or where yt-dlp
// doesn't know it, the same link. On a site yt-dlp has an extractor for,
// that's up to the query, where signatures that change with every read
// usually go: the video's id is the site's, and its format ids and encodings
// tell its files apart. A page it reads with its generic extractor (GENERIC)
// is another matter: the id comes from the page's address, and a <video>
// there has a format with nothing but its index, ext and protocol, so its
// whole link is all that tells another clip apart, the query too (a page may
// pick its clip by it: /stream?clip=…). A link whose host or path changes
// between the reads (a CDN that answers from another server, a signature in
// the path), or on a generic page its query, starts over: safe, but slower.
// A link that stays the same while the file behind it changes can't be told.
const ENCODING = ['format_id', 'ext', 'protocol', 'width', 'height', 'tbr', 'vcodec', 'acodec']
// yt-dlp's generic extractor and the embeds it finds on pages, whose video id
// isn't a site's own: it's the page's (the HTML5 and quoted-HTML ones, by
// _generic_id), the file's name without its extension and query (WordPress
// players, Camtasia) or a page widget's (Elementor), and their formats may
// have nothing but a link (yt-dlp 2026.08.19)
const GENERIC =
  /^(Generic|HTML5MediaEmbed|QuotedHTML|ElementorEmbed|WordpressPlaylistEmbed|WordpressMiniAudioPlayerEmbed|CamtasiaEmbed)$/
// a link without its #fragment, and its query unless whole
const link = (url: unknown, whole: boolean) =>
  typeof url === 'string' ? url.split(whole ? '#' : /[?#]/)[0] : null
const files = (v: any) => {
  const whole = GENERIC.test(v.extractor_key)
  return [
    v.extractor_key,
    v.id,
    (v.requested_formats ?? [v]).map((f: any) => [
      ...ENCODING.map((k) => f[k] ?? null),
      f.filesize || link(f.url, whole),
    ]),
  ]
}
// Whether yt-dlp downloads a pick from its saved info: a video, not a
// playlist (one a multi-video post's -J may have as its first entry)
const isVideo = (v: any) => (v._type ?? 'video') === 'video'
// What a download from saved info gets: the video picked, alone. yt-dlp loads
// saved info without its entries (--clean-info-json), so from a multi-video
// post's -J (a playlist of its first video, --playlist-items 1) it would have
// nothing to download but the page, which it reads again itself and goes on
// in, --continue, from whatever that picks. A pick that's a playlist goes as
// -J printed it (json): its page is read again either way.
export const saved = (v: any, json: string) => (isVideo(v) ? JSON.stringify(v) : json)
// so the same pick is a video, judged as it's downloaded
export const samePick = (a: any, b: any) =>
  isVideo(a) && isVideo(b) && JSON.stringify(files(a)) === JSON.stringify(files(b))

// The key a video's file is cached under, whatever link led to it: the
// video's own (site and id) plus the quality it was downloaded as. 'best' is
// the plain download (qualityArgs('best') is empty), so it gets no suffix —
// a 720p or audio copy must not go out where the best one was asked for, and
// a transcript is never cached (its File has no file_id)
export const cacheKey = (v: any, quality?: Quality) =>
  `${v.extractor_key}:${v.id}${quality && quality !== 'best' ? ':' + quality : ''}`

// The slots for downloading and sending videos. Long ones (20-40 min each on
// some sites) take at most MAX_DOWNLOADS - 1 of them (with one slot, that
// one), so long downloads never hold every slot; one user's get one fewer
// when there are more (limit), so another user's long video doesn't wait for
// theirs either. The whole download and upload holds a slot:
// a link flood can't fork unbounded yt-dlp runs or pile finished files up in
// TMP while uploads crawl
const slots = limit(MAX_DOWNLOADS, Math.max(1, MAX_DOWNLOADS - 1))
// yt-dlp -J, which tells a job's lane, runs before it takes a slot
const meta = limit(MAX_DOWNLOADS)
// The links of a group or guest message that doesn't mention the bot are
// checked one yt-dlp run per message (requested()), and a job whose -J fails
// without an extractor's tag checks its link (claims()): a flood of them
// queues instead of forking a process each. A guest message's wait here
// counts against the time its answer may wait (GUEST_WAIT).
const check = limit(2)

// The signal of a progress message, which isn't worth a flood wait. grammY's
// Node typings have an AbortSignal of their own, which a real one fits.
type Signal = NonNullable<Parameters<Api['sendMessage']>[3]>
export const PROGRESS = new AbortController().signal as unknown as Signal

// Telegram's flood control: a 429 says how many seconds until the chat takes
// messages again (parameters.retry_after, 3-40 s in busy groups). The request
// waits that long and goes again, up to retries times and max seconds in all,
// so a burst of links in a group delays the videos instead of losing them.
// Every 429 starts or extends the chat's flood, the one that ends a request's
// retries too. While the chat is in a flood, its requests line up and go one
// at a time: let through together, all but one would hit the limit again and
// use up their retries. Each has the turn through its own retries and passes
// it on when it's done, or once it's been gap seconds in flight: an upload
// can take minutes, and the chat's other requests (and their download slots)
// mustn't wait for it. A PROGRESS request's 429 comes back at once, and the
// chat's line still waits the flood out. getUpdates has grammY's own wait,
// and a chat action would be stale by then. flooded(chat) = whether the chat
// is in a flood or has a line.
export function floodWait(retries = 5, max = 120, gap = 1) {
  // chats in a flood: until when, the end of its line, and the requests in it
  type Flood = { until: number; last: Promise<void>; size: number }
  const floods = new Map<string | symbol, Flood>()
  const over = (f: Flood) => f.until <= Date.now() && !f.size
  const forget = (chat: string | symbol, f: Flood) => {
    if (floods.get(chat) === f && over(f)) floods.delete(chat)
  }
  // the chat's flood lasts s seconds more at least
  const hold = (chat: string | symbol, s: number) => {
    const f = floods.get(chat) ?? { until: 0, last: Promise.resolve(), size: 0 }
    f.until = Math.max(f.until, Date.now() + s * 1000)
    floods.set(chat, f)
    void Bun.sleep(f.until - Date.now()).then(() => forget(chat, f))
  }
  // waits for a turn in the chat's line; returns what passes it on
  const line = async (chat: string | symbol, f: Flood) => {
    const ahead = f.last
    let next = () => {}
    f.last = new Promise<void>((go) => (next = go))
    f.size++
    await ahead
    return () => {
      f.size--
      next()
      forget(chat, f)
    }
  }
  const wait: Transformer = async (prev, method, payload, signal) => {
    if (method === 'getUpdates' || method === 'sendChatAction')
      return prev(method, payload, signal)
    const id = (payload as { chat_id?: number | string } | undefined)?.chat_id
    // a request without a chat (to an inline message) waits on its own
    const chat = id === undefined ? Symbol() : String(id)
    // the seconds a 429 asks to wait, unless it's longer than max
    const after = (res: ApiResponse<unknown>) => {
      const s = res.ok || res.error_code !== 429 ? undefined : res.parameters?.retry_after
      return s === undefined || s > max ? undefined : s
    }
    if (signal === PROGRESS) {
      const res = await prev(method, payload, signal)
      const s = after(res)
      if (s !== undefined) hold(chat, s)
      return res
    }
    let tries = 0
    let waited = 0
    // passes the chat's turn on, while this request has it
    let pass: (() => void) | undefined
    try {
      for (;;) {
        const f = floods.get(chat)
        if (f && !over(f)) {
          pass ??= await line(chat, f)
          // another 429 may push the wait out while this one sleeps
          while (f.until > Date.now()) await Bun.sleep(f.until - Date.now())
        }
        const mine = pass
        const slow = mine
          ? setTimeout(() => {
              if (pass !== mine) return
              pass = undefined
              mine()
            }, gap * 1000)
          : undefined
        const res = await prev(method, payload, signal).finally(() => clearTimeout(slow))
        const s = after(res)
        if (s !== undefined) hold(chat, s)
        if (s === undefined || (waited += s) > max || ++tries > retries) return res
        console.error('flood', method, `retry after ${s}`, `${tries}/${retries}`)
      }
    } finally {
      pass?.()
    }
  }
  return Object.assign(wait, {
    flooded: (chat: number | string) => {
      const f = floods.get(String(chat))
      return !!f && !over(f)
    },
  })
}

// A progress status isn't worth a flood wait: waiting it out would hold the
// job's download slot and use up the chat's messages ahead of the video. It's
// skipped while the chat is in a flood, and a 429 on it only starts one.
// show(signal) shows it.
export async function progress(flooded: boolean, show: (signal: Signal) => Promise<unknown>) {
  if (flooded) return
  await show(PROGRESS).catch((e) => {
    if (!(e instanceof GrammyError && e.error_code === 429)) throw e
  })
}

// Deletes a message the bot sent to STORAGE (a guest upload sits in the
// admin's DM until then): through a flood wait floodWait gives up on (over
// its max) and network or server errors, tries times in all. What it still
// can't delete is logged, not thrown. pause is Bun.sleep but in tests.
export async function unsend(
  del: () => Promise<unknown>,
  tries = 6,
  pause: (ms: number) => Promise<unknown> = Bun.sleep,
) {
  for (let i = 1; ; i++) {
    try {
      return void (await del())
    } catch (e) {
      const g = e instanceof GrammyError ? e : undefined
      if ((g && g.error_code !== 429 && g.error_code < 500) || i >= tries)
        return console.error('delete failed', (e as Error).message)
      console.error('delete retry', i, (e as Error).message)
      await pause((g?.parameters.retry_after ?? 5 * 2 ** i) * 1000)
    }
  }
}

// Sends a file to dest.chat as kind; returns the kind it went as, its file_id
// and the message. kept hears the file_unique_id of every file that goes out.
export const sender = (api: Api, kept: (file: string) => void = () => {}) =>
  async function send(
    dest: Dest,
    kind: Kind,
    file: () => string | InputFile,
    opts: Opts,
  ): Promise<[Kind, string, Message]> {
    const { chat } = dest
    let m: Message
    try {
      m =
        kind === 'video'
          ? await api.sendVideo(chat, file(), opts)
          : kind === 'animation'
            ? await api.sendAnimation(chat, file(), opts)
            : kind === 'audio'
              ? await api.sendAudio(chat, file(), opts)
              : await api.sendDocument(chat, file(), opts)
    } catch (e) {
      // a fresh file Telegram won't take as media still goes as a file; a
      // cached file_id doesn't (a local file:// path is fresh). A 429 is no
      // reason to: it's about the chat, not the file, and floodWait has
      // already waited it out as long as it should.
      if (
        kind === 'document' ||
        !fresh(file()) ||
        (e instanceof GrammyError && e.error_code === 429)
      )
        throw e
      m = await api.sendDocument(chat, file(), opts)
    }
    const media = m.video ?? m.animation ?? m.audio ?? m.document
    dest.sent = m.message_id
    if (!media) throw new Error('no file in sent message')
    kept(media.file_unique_id)
    const sent = m.video
      ? 'video'
      : m.animation
        ? 'animation'
        : m.audio
          ? 'audio'
          : 'document'
    return [sent, media.file_id, m]
  }

// The live cookie jar sits on the data volume, so the session cookies Google
// rotates survive restarts. COOKIES only seeds it, again whenever it changes.
const JAR = join(DATA, 'cookies.txt')
const SEED = join(DATA, 'cookies.seed.txt')

async function seedJar() {
  if (!existsSync(COOKIES)) return
  const seed = await Bun.file(COOKIES).text()
  if (existsSync(SEED) && (await Bun.file(SEED).text()) === seed) return
  await Bun.write(JAR, seed)
  await Bun.write(SEED, seed)
}

// yt-dlp gets a private copy (parallel runs would clobber one file)...
const taken = new Map<string, number>()
async function jar(dir: string) {
  if (!existsSync(JAR)) return []
  taken.set(dir, (await stat(JAR)).mtimeMs)
  await copyFile(JAR, join(dir, 'cookies.txt'))
  // the job folder may be readable by the Bot API server (scratch.ts), the session isn't
  await chmod(join(dir, 'cookies.txt'), 0o600)
  return ['--cookies', join(dir, 'cookies.txt')]
}

// ...and its refreshed cookies go back, unless YouTube dropped the login or
// another run saved newer ones meanwhile
async function saveJar(dir: string) {
  const since = taken.get(dir)
  taken.delete(dir)
  const copy = join(dir, 'cookies.txt')
  if (!existsSync(copy) || !(await Bun.file(copy).text()).includes('\tLOGIN_INFO\t'))
    return
  if (since !== undefined && (await stat(JAR)).mtimeMs !== since) return
  await copyFile(copy, `${JAR}.new`)
  await rename(`${JAR}.new`, JAR)
}

// First-seen chat and user ids, for stats.borodutch.com (served on STATS_PORT
// inside the Docker network only, no domain): totals and new ones per UTC day,
// plus the audience: chats by type and by days since their last update, and
// private chats that blocked the bot (counts only, never ids)
export const WINDOWS = [7, 30, 90, 180] as const
export function census(db: Database) {
  const tables = ['chats', 'users'] as const
  for (const t of tables)
    db.run(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY, created INTEGER NOT NULL)`)
  for (const col of ['seen INTEGER', 'type TEXT', 'gone INTEGER NOT NULL DEFAULT 0'])
    try {
      db.run(`ALTER TABLE chats ADD COLUMN ${col}`)
    } catch {} // already there
  const chat = db.query(
    `INSERT INTO chats (id, created, seen, type) VALUES (?1, unixepoch(), unixepoch(), ?2)
     ON CONFLICT (id) DO UPDATE SET seen = excluded.seen, type = coalesce(excluded.type, type), gone = 0`,
  )
  const user = db.query('INSERT OR IGNORE INTO users VALUES (?, unixepoch())')
  const member = db.query(
    `INSERT INTO chats (id, created, type, gone) VALUES (?1, unixepoch(), 'private', ?2)
     ON CONFLICT (id) DO UPDATE SET gone = excluded.gone`,
  )
  const daily = (t: string) =>
    db
      .query(`SELECT date(created, 'unixepoch') AS date, count(*) AS count FROM ${t} GROUP BY 1 ORDER BY 1`)
      .all() as { date: string; count: number }[]
  const total = (t: string) =>
    (db.query(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n
  const recent = WINDOWS.map(
    (d) => `sum(gone = 0 AND unixepoch() - coalesce(seen, created) < ${d * 86400}) AS d${d}`,
  ).join(', ')
  const audience = () =>
    Object.fromEntries(
      (
        db
          .query(
            `SELECT coalesce(type, CASE WHEN id > 0 THEN 'private' WHEN id < -1000000000000
               THEN 'supergroup_or_channel' ELSE 'group' END) AS kind,
             count(*) AS ever, sum(gone) AS unreachable, ${recent}
             FROM chats GROUP BY 1`,
          )
          .all() as ({ kind: string } & Record<string, number>)[]
      ).map(({ kind, ...n }) => [kind, n]),
    )
  return {
    // a chat's last activity: any update from it except the bot's own membership changes
    seen(chatId?: number, userId?: number, type?: string) {
      if (chatId !== undefined) chat.run(chatId, type ?? null)
      if (userId !== undefined) user.run(userId)
    },
    // a private chat blocked (kicked) or unblocked the bot
    member(chatId: number, status: string) {
      member.run(chatId, status === 'kicked' ? 1 : 0)
    },
    stats: () => ({
      chatCount: total('chats'),
      userCount: total('users'),
      chatDaily: daily('chats'),
      userDaily: daily('users'),
      audience: audience(),
    }),
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Seconds since t, for the job log
const elapsed = (t: number) => ((Date.now() - t) / 1000).toFixed(1)

// The media in a job's dir, downloaded so far or done (yt-dlp names it all
// v.*): each file's name and bytes
async function media(dir: string) {
  const files: { name: string; bytes: number }[] = []
  for (const name of await readdir(dir).catch(() => []))
    if (name.startsWith('v.'))
      files.push({ name, bytes: (await stat(join(dir, name)).catch(() => undefined))?.size ?? 0 })
  return files
}

// MB of media in a job's dir, not counting the v.temp.* a merge or fixup
// writes from the rest
export async function onDisk(dir: string) {
  let bytes = 0
  for (const f of await media(dir)) if (!f.name.startsWith('v.temp.')) bytes += f.bytes
  return Math.round(bytes / 2 ** 20)
}

// Bytes of the biggest media file in a job's dir, a merge's or fixup's
// v.temp.* too (it becomes the video)
export const biggest = async (dir: string) =>
  (await media(dir)).reduce((max, f) => Math.max(max, f.bytes), 0)

// Deletes the media in a job's dir: whatever a failed download left
export async function drop(dir: string) {
  for (const f of await media(dir)) await rm(join(dir, f.name), { recursive: true, force: true })
}

// How a job that threw e ends in the job log: fail:<what the chat was told>,
// timeout (the download ran out of time) or error
export const outcome = (e: unknown) =>
  e instanceof Fail ? `fail:${e.key ?? 'quiet'}` : e instanceof Timeout ? 'timeout' : 'error'

// The UTC day a usage row is keyed by (YYYY-MM-DD): the day a user's cap
// counts in, and the day /stats' "today" is
export const dayKey = (now = new Date()) => now.toISOString().slice(0, 10)

// The daily cap from DAILY_MB (per user per UTC day, in MB): 10 GB by
// default, no cap for 0 or an unset/empty value
export const parseDailyMb = (v: string | undefined): number | undefined => {
  if (v === undefined) return 10 * 1024
  const n = Number(v)
  return v !== '' && Number.isFinite(n) && n > 0 ? n : undefined
}

// Whether a download for a user at mb MB used today may not start: only once
// the used MB has reached the cap (the new file's size isn't predicted)
export const capDecision = (cap: number | undefined, mb: number) =>
  cap !== undefined && mb >= cap

// MB, human: whole MB under a gigabyte, one decimal of a gigabyte from there
export const formatSize = (mb: number) =>
  mb < 1024 ? `${mb} MB` : `${+(mb / 1024).toFixed(1)} GB`

// One user's downloads, from the usage table: today (dayKey's day), this UTC
// month and all time, each as count and MB
export type Stats = {
  today: { n: number; mb: number }
  month: { n: number; mb: number }
  all: { n: number; mb: number }
}
export const statsOf = (rows: { day: string; n: number; mb: number }[], now = new Date()): Stats => {
  const day = now.toISOString().slice(0, 10)
  const month = now.toISOString().slice(0, 7) + '-01'
  const zero = { n: 0, mb: 0 }
  const out: Stats = { today: { ...zero }, month: { ...zero }, all: { ...zero } }
  for (const { day: d, n, mb } of rows) {
    out.all.n += n
    out.all.mb += mb
    if (d >= month) {
      out.month.n += n
      out.month.mb += mb
      if (d === day) {
        out.today.n += n
        out.today.mb += mb
      }
    }
  }
  return out
}

function main() {
  const db = new Database(join(DATA, 'bot.sqlite'), { create: true })
  // During a deploy's handover the old container, still polling, writes to
  // this file on nearly every update (census): the tables set up below wait
  // up to 10 s for its write lock (a new one, like sent, needs it) rather
  // than stop this container's start. After them a lock fails at once, as
  // before.
  db.run('PRAGMA busy_timeout = 10000')
  db.run(
    'CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, kind TEXT NOT NULL, file_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL)',
  )
  // The cache's statements, like sent's below: past the start, one that meets
  // another process's lock on the file fails at once (a deploy's old
  // container writes files, sized and sent as its last jobs finish). It's
  // logged and comes to undefined, which costs a request at most a download:
  // a read that fails is a miss, and a write that fails once the file is out
  // leaves the chat its file.
  const cache = <T>(what: string, statement: () => T) => {
    try {
      return statement()
    } catch (e) {
      console.error('cache', what, (e as Error).message)
    }
  }
  const row = db.query<File, [string]>('SELECT * FROM files WHERE key = ?')
  const get = (key: string) => cache('get', () => row.get(key))
  const put = (key: string, f: File) =>
    cache('put', () =>
      db.query('INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?, ?)').run(key, f.kind, f.file_id, f.title, f.url),
    )
  // file_ids uploaded with the file's own size (#281), or whose one refresh
  // was tried; older videos may have gone out without a size. A table of its
  // own: a container still running the old code keeps writing files.
  db.run('CREATE TABLE IF NOT EXISTS sized (file_id TEXT PRIMARY KEY)')
  // true the first time only (not when it can't be written: the refresh
  // waits for another time)
  const settle = (fileId: string) =>
    cache('settle', () => db.query('INSERT OR IGNORE INTO sized VALUES (?)').run(fileId).changes > 0)
  // every link cached with the old file gets the new one
  const swap = (old: string, f: File) =>
    cache('swap', () =>
      db.query('UPDATE files SET kind = ?, file_id = ? WHERE file_id = ?').run(f.kind, f.file_id, old),
    )
  const forget = (f: File) =>
    cache('forget', () => db.query('DELETE FROM files WHERE file_id = ?').run(f.file_id))
  // The files it has sent, by file_unique_id: a copy of one is its own
  // message (own()). A video cached before this table joins it the next time
  // it goes out; until then a copy of it counts as anyone's. A table of its
  // own, as sized. A failed write or read only lets a copy through.
  db.run('CREATE TABLE IF NOT EXISTS sent (file TEXT PRIMARY KEY)')
  const keep = (file: string) => {
    try {
      db.query('INSERT OR IGNORE INTO sent VALUES (?)').run(file)
    } catch (e) {
      console.error(e)
    }
  }
  const mine = (file: string) => {
    try {
      return !!db.query('SELECT 1 FROM sent WHERE file = ?').get(file)
    } catch (e) {
      console.error(e)
      return false
    }
  }
  const people = census(db)
  // The language each user picked (/lang), by user id. An explicit choice
  // wins over Telegram's detection (resolve). A write or read that meets
  // another process's lock (a deploy's handover) fails at once, as the
  // cache's do: it costs a reply its detection, nothing more
  db.run('CREATE TABLE IF NOT EXISTS lang (user INTEGER PRIMARY KEY, code TEXT NOT NULL)')
  const langRow = db.query<{ code: string | null }, [number]>('SELECT code FROM lang WHERE user = ?')
  const langOf = (user?: number | null) =>
    user ? (cache('lang', () => langRow.get(user)?.code ?? null) ?? null) : null
  const pickLang = (user: number, code: Code) => {
    try {
      db.query('INSERT OR REPLACE INTO lang VALUES (?, ?)').run(user, code)
    } catch (e) {
      console.error('lang', (e as Error).message)
    }
  }
  // The language a reply in ctx goes out in: the user's stored choice, else
  // what Telegram detected, else English
  const langOfCtx = (ctx: Context) => resolve(ctx.from?.language_code, langOf(ctx.from?.id))
  // Each user's downloads per UTC day: the count, and the MB of the files
  // that went out (a cached copy or a transcript has none). A write or read
  // that meets another process's lock (a deploy's handover) fails at once,
  // as the cache's do: it costs a job its row, nothing more (a failed read
  // fails the cap open: the download may start)
  db.run('CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, user INTEGER NOT NULL, mb INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user))')
  const usageUp = db.query(
    'INSERT INTO usage (day, user, mb, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (day, user) DO UPDATE SET mb = usage.mb + excluded.mb, n = usage.n + 1',
  )
  const usageUsed = (user: number, day: string) =>
    cache('usage', () => (db.query('SELECT mb FROM usage WHERE user = ? AND day = ?').get(user, day) as { mb: number } | null)?.mb ?? 0) ?? 0
  const usageRows = (user: number) =>
    cache('usageRows', () => db.query('SELECT day, n, mb FROM usage WHERE user = ?').all(user) as { day: string; n: number; mb: number }[]) ?? []
  // a completed job's MB, credited to its user's day: 0 for a group or a
  // channel (dest.who not a positive user id) and for a cached copy or a
  // transcript (no file went out); a lock failure is logged, not thrown
  const usageRecord = (user: number, mb: number) => {
    if (!(user > 0)) return
    try {
      usageUp.run(dayKey(), user, Math.max(0, Math.round(mb)))
    } catch (e) {
      console.error('usage', (e as Error).message)
    }
  }
  // the /stats answer: the user's numbers, and the cap's line (what's left
  // of the day, or that there is no cap)
  const statsText = (code: Code, s: Stats) => {
    const cap = DAILY_MB()
    const left = cap === undefined ? undefined : Math.max(0, cap - s.today.mb)
    return t(code, 'stats')
      .replaceAll('{tn}', String(s.today.n))
      .replaceAll('{ts}', formatSize(s.today.mb))
      .replaceAll('{mn}', String(s.month.n))
      .replaceAll('{ms}', formatSize(s.month.mb))
      .replaceAll('{an}', String(s.all.n))
      .replaceAll('{as}', formatSize(s.all.mb))
      .replaceAll('{cap}', left === undefined ? t(code, 'noCap') : t(code, 'capLeft').replaceAll('{left}', String(left)).replaceAll('{cap}', String(cap)))
  }

  Bun.serve({
    port: Number(env.STATS_PORT || 8080),
    fetch: (req) =>
      new URL(req.url).pathname === '/stats'
        ? Response.json(people.stats())
        : new Response('Not found', { status: 404 }),
  })

  const promo = promos(db)
  db.run('PRAGMA busy_timeout = 0')
  const bot = new Bot(env.TOKEN!, {
    client: { apiRoot: API, timeoutSeconds: 3600 },
  })
  // every request, ctx.api's too (grammY copies the bot's transformers)
  const flood = floodWait()
  bot.api.config.use(flood)
  const jobs = new Map<string, Promise<File>>()
  // The other requests for a link whose job runs follow its statuses: tell =
  // each one's, key = the job's last
  const watching = new Map<string, { key?: Key; tell: Set<(key: Key) => void> }>()
  // The requests running now, each with a way to tell its chat that the exit
  // cuts it off
  const open = new Set<() => void>()
  // Set by the exit's cut: from then on no job begins an upload (job())
  let exiting = false
  // Set once a deploy's drain has begun: from then on a guest message that
  // doesn't mention the bot isn't answered just because its time is up (guest())
  let draining = false
  // Handlers run detached; counted so a deploy lets the running ones finish
  let running = 0
  const track = (p: Promise<unknown>) => {
    running++
    return p.finally(() => running--)
  }
  // The help text goes out detached too: in a flood wait a reply can take
  // minutes, and updates are handled one at a time
  const help = (ctx: Context) =>
    void track(ctx.reply(t(langOfCtx(ctx), 'help')).catch(console.error))

  const send = sender(bot.api, keep)

  const options = (dest: Dest, f: Pick<File, 'title' | 'url'>): Opts => ({
    caption:
      `<a href="${esc(f.url)}">${esc([...f.title].slice(0, 200).join(''))}</a>\n@${bot.botInfo.username}` +
      (dest.promo?.format === 'caption'
        ? `\n\n<a href="${esc(dest.promo.url)}">${esc(dest.promo.text)}</a>`
        : ''),
    reply_markup:
      dest.promo?.format === 'button'
        ? { inline_keyboard: [[{ text: dest.promo.text, url: dest.promo.url }]] }
        : undefined,
    parse_mode: 'HTML',
    supports_streaming: true,
    disable_notification: !dest.reply,
    reply_parameters: dest.reply
      ? { message_id: dest.reply, allow_sending_without_reply: true }
      : undefined,
  })

  // false = the cached file_id is dead, download again; other errors (flood
  // wait, blocked bot, no media rights) keep the cache and propagate. A video
  // cached before #281 that Telegram has without a size (it shows squeezed)
  // goes to unsized with its message, once per file_id.
  async function resend(dest: Dest, f: File, unsized?: (id: number) => void) {
    try {
      const [, , m] = await send(dest, f.kind, () => f.file_id, options(dest, f))
      if (unsized && m.video && !(m.video.width && m.video.height) && settle(f.file_id))
        unsized(m.message_id)
      return true
    } catch (e) {
      if (!(e instanceof GrammyError && e.error_code === 400 && /file/i.test(e.description)))
        throw e
      console.error('resend', f.url, e.description)
      forget(f)
      return false
    }
  }

  async function download(
    dest: Dest,
    url: string,
    status: (key: Key) => Promise<void>,
  ): Promise<File> {
    if (dest.reply)
      void bot.api.sendChatAction(dest.chat, 'upload_video').catch(() => {})
    // One line per job, for where the time goes (in seconds): the wait for a
    // yt-dlp -J turn and the run, the wait for a slot, how many jobs were
    // in line and how many of the user's own had a slot or were in line
    // (with none, a wait was behind other people's links alone), the
    // download (a failed one too, with the MB it got), and probe, thumbnail
    // and upload together
    const log: Record<string, string | number> = { host: new URL(url).hostname }
    const start = Date.now()
    let result = 'ok'
    try {
      const f = await job(dest, url, status, log)
      // only an upload times it
      if (!log.up) result = 'cached'
      return f
    } catch (e) {
      result = outcome(e)
      throw e
    } finally {
      log.total = elapsed(start)
      console.log('job', result, Object.entries(log).map(([k, v]) => `${k}=${v}`).join(' '))
      // the completed download's MB (dest.uploadMb, the file that went out:
      // 0 for a cached copy or a transcript) counts toward the user's day
      if (result === 'ok' || result === 'cached') usageRecord(dest.who ?? 0, dest.uploadMb ?? 0)
    }
  }

  async function job(
    dest: Dest,
    url: string,
    status: (key: Key) => Promise<void>,
    log: Record<string, string | number>,
  ): Promise<File> {
    const dir = await mkdtemp(join(TMP, 'job-'))
    let free = () => {}
    // a link that has to wait for a -J turn or a slot would otherwise look
    // ignored: it hears it's queued, once
    let queued = false
    const wait = async (busy: boolean) => {
      if (!busy || queued) return
      queued = true
      await status('queued').catch(() => {})
    }
    try {
      await SCRATCH.open(dir)
      const quality = dest.quality
      // the best is the link's own download (its cache key has no suffix), so
      // it's the plain job line; the others carry their quality
      if (quality && quality !== 'best') log.q = quality
      const base = quality ? [...YTDLP, ...qualityArgs(quality)] : YTDLP
      let args = [...base, ...(await jar(dir))]
      let json: string
      const asked = Date.now()
      await wait(meta.busy(false, dest.who))
      try {
        json = (
          await meta.run(async () => {
            log.metaq = elapsed(asked)
            const t = Date.now()
            try {
              return await ytdlp([...args, '-J', url], 5 * 60_000)
            } finally {
              log.meta = elapsed(t)
            }
          }, dest.who)
        ).out
      } catch (e) {
        // a restart (meta.close) isn't the link's fault
        if (e instanceof Fail) throw e
        const why = String((e as Error).message)
        const soon = unstarted(why)
        if (soon) throw new Fail(soon, why)
        // a no-media tweet keeps its post's text, which goes out in its place
        // (handle(), guest()); only a real status link can be looked up
        const text = await tweetText(url, why)
        if (text !== undefined) throw new Tweet(text, why)
        // an untagged error needs the extractors that claim the link
        const ies = /^(ERROR: )?\[/.test(why)
          ? []
          : ((await claims([url]).catch(() => undefined))?.get(url) ?? [])
        throw new Fail(notVideo(why, ies) ? null : 'failed', why)
      }
      const extracted = Date.now()
      // The video and the key it's cached under: the page read again may
      // pick another one (again())
      let v = picked(JSON.parse(json))
      let id = cacheKey(v, quality)
      // The video may be cached under another link, or get cached by another
      // job while this one waits; a refresh wants a new upload, not another
      // cached copy
      const fromCache = async (key: string) => {
        const hit = get(key)
        if (hit && !dest.stale && (await resend(dest, hit))) {
          // the link's key is the best's alone: a 720p or audio copy is
          // cached under its own quality key, and must not go out where the
          // best was asked for
          if (!quality || quality === 'best') put(url, hit)
          return hit
        }
      }
      // What a video the page picks goes through before it's downloaded: a
      // stream yt-dlp can't download yet fails, a refresh stops quietly
      // unless it's the video it replaces, a copy cached under its key goes
      // out and is returned, and one yt-dlp says is too big fails. A
      // refresh's download takes the old copy's place in the chat and under
      // every key cached with it (swap), so it has to be the video whose key
      // has that copy: the page may lead to another one now, at the first
      // read or when read again (a multi-video post whose first one has
      // changed), and the old copy stays, as it does when the key can't be
      // read.
      const vet = async (pick: any) => {
        const stream = unready(pick)
        if (stream) throw new Fail(stream, `${stream} stream`)
        if (dest.stale && get(cacheKey(pick, quality))?.file_id !== dest.stale.file_id)
          throw new Fail(null, 'another video')
        const hit = await fromCache(cacheKey(pick, quality))
        if (hit) return hit
        const size = sizes(pick).reduce<number>((all, n) => all + (n ?? 0), 0)
        if (size > LIMIT) throw new Fail('tooBig')
      }
      const hit = await vet(v)
      if (hit) return hit

      const long = isLong(v)
      log.lane = long ? 'long' : 'short'
      log.ahead = slots.waiting(long)
      log.own = slots.own(dest.who)
      log.dur = v.duration ? Math.round(v.duration) : '?'
      await wait(slots.busy(long, dest.who))
      const waited = Date.now()
      free = await slots.take(dest.who, long)
      log.wait = elapsed(waited)
      const sent = await fromCache(id)
      if (sent) return sent
      // another run may have saved newer cookies while this one waited
      if (taken.has(dir) && (await stat(JAR)).mtimeMs !== taken.get(dir))
        args = [...base, ...(await jar(dir))]

      await status('downloading')
      await Bun.write(join(dir, 'info.json'), saved(v, json))
      // yt-dlp holds a download to --max-filesize only by its Content-Length,
      // so an HLS or DASH one of unknown size (a stream recording) would grow
      // until the time limit, many GB into TMP. Every 5 s the job's files are
      // weighed, and once one of them is over LIMIT the download stops: that
      // file alone can't be sent. (Their sum would stop a merge that's fine:
      // the parts and the merged copy are on disk together.) It's the
      // download as it comes that's judged, as by --max-filesize: an MPEG-TS
      // one just over LIMIT, which the remux into MP4 would shrink a few %
      // under it, stops too.
      const big = new AbortController()
      // How far the download is, for the chat's status: the picked formats'
      // total size (the transcript has no file), and the callback that tells
      // it (handle() wires it to a status edit; undefined elsewhere)
      const total = quality === 'transcript' ? undefined : sizes(v).reduce<number>((all, n) => all + (n ?? 0), 0) || undefined
      const report = dest.onProgress ?? (() => {})
      const weigh = setInterval(async () => {
        const b = await biggest(dir)
        if (b > LIMIT)
          big.abort(new Fail('tooBig', `a file over ${LIMIT >> 20} MB`))
        else report(downloadProgress(b, total), Math.round(b / 2 ** 20))
      }, MINUTE / 12)
      const grab = (source: string[], timeout: number) =>
        ytdlp(
          [
            ...args,
            ...source,
            '-o', join(dir, 'v.%(ext)s'),
            '--max-filesize', String(LIMIT),
            '--print', 'after_move:filepath',
          ],
          timeout,
          big.signal,
        )
      const fetched = Date.now()
      const age = fetched - extracted
      const budget = downloadMinutes(long) * MINUTE
      // The page read again in left ms, then downloaded from like the first
      // time. It's read apart from the download to see what it picks: the
      // failed try's files are left to resume only for the same pick, and
      // deleted first for another (samePick). --no-continue would be no way
      // out: a fragment download (HLS, DASH) starts over then, but appended
      // to a .part with bytes in it, which yt-dlp has opened in append mode.
      // Another video picked this time (a multi-video post whose first one
      // has changed, or a link that leads to another one now) gets the
      // checks the first one got (vet: a cached copy of it goes out instead
      // of a download, and a refresh stops), then becomes the job's video:
      // it goes out with its own title, length and kind, and is cached under
      // its own key, never the first one's.
      const again = async (left: number) => {
        const reading = Date.now()
        const page = (await ytdlp([...args, '-J', url], left)).out
        const pick = picked(JSON.parse(page))
        const same = samePick(v, pick)
        log[same ? 'kept' : 'dropped'] = await onDisk(dir)
        if (!same) await drop(dir)
        if (cacheKey(pick, quality) !== id) {
          log.other = 1
          const hit = await vet(pick)
          if (hit) return hit
          v = pick
          id = cacheKey(pick, quality)
        }
        await Bun.write(join(dir, 'info.json'), saved(pick, page))
        return grab(['--load-info-json', join(dir, 'info.json')], left - (Date.now() - reading))
      }
      const got = await grab(
        [
          '--load-info-json', join(dir, 'info.json'),
          // a fragment lost to an expired link fails it (and it reads the page
          // again) rather than leave a gap in the video
          ...(stale(age) ? ['--abort-on-unavailable-fragments'] : []),
        ],
        budget,
      )
        .catch((e) => {
          // too big: the page read again has the same video
          if (big.signal.aborted) throw big.signal.reason
          const left = budget - (Date.now() - fetched)
          if (!reread(age, left)) throw e
          log.reread = 1
          return again(left)
        })
        .catch(async (e) => {
          // a transcript whose run failed on one throttled language (YouTube
          // answers its auto-caption endpoint with a 429) still has the
          // languages it got before the 429, written to the dir
          if (quality === 'transcript') {
            const sub = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.vtt'))
            const vtt = pickSub(sub)
            if (vtt) {
              log.subs = sub.length
              const text = vttText((await Bun.file(join(dir, vtt)).text()).trim())
              if (text) {
                const file: File = { kind: 'document', file_id: '', title: v.title || 'Transcript', url: v.webpage_url || url, text }
                return file
              }
            }
          }
          // how far a failed download got, for the site's speed
          log.dl = elapsed(fetched)
          log.mb = await onDisk(dir)
          throw e
        })
        .finally(() => clearInterval(weigh))
      log.dl = elapsed(fetched)
      // the page read again picked another video, which went out from the cache
      if ('file_id' in got) return got
      // The transcript: a video with no file, the subtitles written instead.
      // yt-dlp names them after the video's title, not the -o template, so
      // every .vtt in the dir is scanned; pickSub orders them (a manual sub
      // wins, then the --sub-langs order). Sent as plain text (vttText) in
      // the video's place, split to the message length, and not cached (the
      // files table holds media file_ids, not text).
      if (quality === 'transcript') {
        const sub = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.vtt'))
        const vtt = pickSub(sub)
        if (!vtt) throw new Fail('failed', 'no transcript for this video')
        log.subs = sub.length
        const text = vttText((await Bun.file(join(dir, vtt)).text()).trim())
        if (!text) throw new Fail('failed', 'no transcript for this video')
        return { kind: 'document', file_id: '', title: v.title || 'Transcript', url: v.webpage_url || url, text }
      }
      const { out, err } = got
      const path = out.trim().split('\n').pop()
      // --print implies --quiet, so a file over --max-filesize is skipped
      // with exit 0 and no output at all
      if (!path || !existsSync(path)) {
        log.mb = await onDisk(dir)
        throw new Fail(err.trim() ? 'failed' : 'tooBig', err)
      }
      const bytes = (await stat(path)).size
      log.mb = Math.round(bytes / 2 ** 20)
      if (bytes > LIMIT) throw new Fail('tooBig')

      // the upload's line shows the size (the API reports no progress)
      dest.uploadMb = Math.max(1, Math.round(bytes / 2 ** 20))
      const sending = Date.now()
      await status('uploading')
      await SCRATCH.open(path, true)
      const audio = quality === 'audio' || v.vcodec === 'none'
      const thumb = join(dir, 'thumb.jpg')
      const box = audio ? undefined : await probe(path)
      if (!audio)
        await Bun.spawn([
          'ffmpeg', '-v', 'error', '-y',
          '-ss', String(Math.min(1, (v.duration ?? 0) / 2)),
          '-i', path,
          '-frames:v', '1',
          '-vf', THUMB,
          thumb,
        ]).exited
      const f = { title: v.title || 'Video', url: v.webpage_url || url }
      // Past the exit's cut the job's chats have heard to send the link
      // again, or hear it now (a guest reply, a request that came after the
      // cut): an upload begun now would go out next to that, finished by a
      // local Bot API server after the exit, and a refresh would leave both
      // videos. Once the upload has begun (before the cut), the cut leaves
      // the job's request alone (cutOff).
      if (exiting) throw new Fail('restarting')
      dest.uploading = true
      const [kind, file_id] = await send(
        dest,
        audio ? 'audio' : 'video',
        () => SCRATCH.local(path) ?? new InputFile(path),
        {
          ...options(dest, f),
          width: box?.width ?? v.width ?? undefined,
          height: box?.height ?? v.height ?? undefined,
          duration: v.duration ? Math.round(v.duration) : undefined,
          thumbnail: existsSync(thumb) ? new InputFile(thumb) : undefined,
          title: audio ? f.title : undefined,
          performer: audio ? v.uploader : undefined,
        },
      )
      log.up = elapsed(sending)
      const file = { ...f, kind, file_id }
      settle(file_id)
      put(id, file)
      // the link's key, as the file it led to, is the best's alone (a 720p or
      // an audio download is under its own key)
      if (!quality || quality === 'best') put(url, file)
      return file
    } finally {
      await saveJar(dir).catch(console.error)
      // the slot is held until the files are gone; a failed rm is logged, and
      // the job keeps its own result
      await rm(dir, { recursive: true, force: true }).catch(console.error).finally(free)
    }
  }

  // The link's key in the running jobs: suffixed with the quality, because a
  // 720p or an audio job is a different download from the link's own (a best)
  // one, and its file must not go out where the best was asked for, nor the
  // best's cached copy where the 720p was asked. The link's own file (best,
  // or no quality) stays under the link alone.
  const jobKey = (url: string, quality?: Quality) =>
    quality && quality !== 'best' ? `${url}:${quality}` : url
  // Puts the file into dest.chat: from the cache, from a running job for the
  // same link and quality, or downloaded now. status(key, true) is that
  // running job's status: shown only where a queued one would be. A quality
  // that isn't the link's own (best) doesn't read the link's cache — that's
  // the best's file — and isn't answered by the link's job.
  async function deliver(
    dest: Dest,
    url: string,
    status: (key: Key, follow?: boolean) => Promise<void>,
  ): Promise<File> {
    const key = jobKey(url, dest.quality)
    const cached = key === url ? get(url) : undefined
    if (cached && (await resend(dest, cached, (message) => (dest.stale = { message, file_id: cached.file_id }))))
      return dest.stale ? refresh(dest, url, cached) : cached
    const job = jobs.get(key)
    if (job) {
      const f = await follow(key, job, status)
      if (!(await resend(dest, f))) throw new Fail('failed')
      return f
    }
    const watch = { key: undefined as Key | undefined, tell: new Set<(key: Key) => void>() }
    watching.set(key, watch)
    const fresh = download(dest, url, (k) => {
      watch.key = k
      for (const tell of watch.tell) tell(k)
      return status(k)
    }).finally(() => {
      jobs.delete(key)
      watching.delete(key)
    })
    jobs.set(key, fresh)
    return fresh
  }

  // Waits for the job of another request for the link, this one's status
  // following the job's: the job's status so far at once, then each new one
  async function follow(
    key: string,
    job: Promise<File>,
    status: (key: Key, follow?: boolean) => Promise<void>,
  ): Promise<File> {
    const watch = watching.get(key)
    let told = Promise.resolve()
    const tell = (k: Key) => {
      told = told.then(() => status(k, true)).catch(() => {})
    }
    if (watch?.key) tell(watch.key)
    watch?.tell.add(tell)
    try {
      return await job
    } finally {
      watch?.tell.delete(tell)
      // the status is up before the caller edits or deletes it
      await told
    }
  }

  // The unsized video already went out: a fresh download replaces it, and if
  // that fails the old one stays, cached as before (and not tried again)
  async function refresh(dest: Dest, url: string, old: File) {
    console.error('refresh unsized', url)
    try {
      const f = await download(dest, url, async () => {})
      swap(old.file_id, f)
      const stale = dest.stale!.message
      void unsend(() => bot.api.deleteMessage(dest.chat, stale))
      return f
    } catch (e) {
      console.error('refresh failed', url, (e as Error).message)
      return old
    } finally {
      dest.stale = undefined
    }
  }

  // The quality a YouTube link is offered. The bot answers a bare YouTube
  // video link with a menu (best / 720p / audio / transcript) instead of
  // downloading at once, unless it was summoned (the user named it, so the
  // link is what they want) or another link in the same message made it not
  // the sole thing asked. Off in a bot run with E2E_PARENT_PID (tests, where
  // a bare link must download at once), unless E2E_MENU turns it back on for
  // a menu test.
  const offerMenu = (ctx: Context, url: string, wanted: string[]) =>
    (!env.E2E_PARENT_PID || env.E2E_MENU) &&
    ctx.chat!.type === 'private' &&
    wanted.length === 1 &&
    youtubeVideo(url) &&
    !summoned(ctx.msg!, ctx.me.username)
  // A menu up now, by chat + message: the link it offers, and the video's id
  // in the button's data too (a tap's message may not keep its reply, as a
  // local Bot API server's callback doesn't). A menu that no one taps drops
  // off by itself (30 min).
  const menuLinks = new Map<string, string>()
  const menuKey = (ctx: Context) => `${ctx.chat!.id}:${ctx.msg!.message_id}`
  const answerMenu = (ctx: Context, url: string) => {
    const key = menuKey(ctx)
    const lang = langOfCtx(ctx)
    menuLinks.set(key, url)
    // a menu that no one taps drops off by itself (30 min); unref'd so it
    // never holds an exiting bot's event loop
    setTimeout(() => {
      if (menuLinks.get(key) === url) menuLinks.delete(key)
    }, 30 * 60_000).unref()
    // the video's id, in the button's data (the URL itself would pass
    // Telegram's 64-byte callback limit; an id doesn't): a tap whose message
    // lost its reply reads the link back from it
    const vid = /(?:\?v=|\/shorts\/)(\w+)/.exec(url)?.[1]
    const suffix = vid ? `:${vid}` : ''
    const board: InlineKeyboardButton[][] = [
      [
        { text: t(lang, 'qBest'), callback_data: `q:best${suffix}` },
        { text: t(lang, 'q720'), callback_data: `q:720${suffix}` },
      ],
      [
        { text: t(lang, 'qAudio'), callback_data: `q:audio${suffix}` },
        { text: t(lang, 'qTranscript'), callback_data: `q:transcript${suffix}` },
      ],
    ]
    void track(
      ctx
        .reply(t(lang, 'qualityMenu'), {
          reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true },
          reply_markup: { inline_keyboard: board },
        })
        .catch(() => {
          menuLinks.delete(key)
          console.error('menu failed', url)
        }),
    )
  }
  // A menu button's tap: the quality, and the video's id the button was for
  // (a menu offered for a URL without a plain id sends none), or undefined
  // when the callback is not the bot's menu (another bot's, or the user's own)
  const qualityTap = (data: string): { q: Quality; id?: string } | undefined => {
    const m = /^q:(best|720|audio|transcript)(?::(\w+))?$/.exec(data)
    return m ? { q: m[1] as Quality, id: m[2] } : undefined
  }

  async function handle(ctx: Context, url: string, quality?: Quality) {
    const lang = langOfCtx(ctx)
    let statusId: number | undefined
    // text overrides the key's line (the upload's size)
    const show = async (key: Key, follow = false, signal?: Signal, text?: string) => {
      if (
        !statusId &&
        (follow || key === 'queued' || key === 'restarting') &&
        !tellQueued(ctx.chat!.type, summoned(ctx.msg!, ctx.me.username))
      )
        return
      const line = text ?? t(lang, key)
      if (statusId)
        await ctx.api
          .editMessageText(ctx.chat!.id, statusId, line, undefined, signal)
          .catch(() => {})
      else
        statusId = (
          await ctx.reply(
            line,
            {
              reply_parameters: {
                message_id: ctx.msg!.message_id,
                allow_sending_without_reply: true,
              },
            },
            signal,
          )
        ).message_id
    }
    // Status calls go one at a time, each after the one before it (the exit's
    // notice too); once the exit cuts the request off, the chat keeps that
    let shown = Promise.resolve()
    const then = <T>(call: () => Promise<T>) => {
      const p = shown.then(call)
      shown = p.then(() => {}, () => {})
      return p
    }
    let cut = false
    let lastProgress = ''
    let progressing = true
    // progress isn't worth a flood wait; the answer to a failure still waits
    // its turn
    const status = (key: Key, follow = false) => {
      // past the download (the upload begins, or the exit restarts), the
      // percent no longer applies: the last one stays up until the video goes
      if (key === 'uploading' || key === 'restarting') progressing = false
      // the API reports no upload progress, so the upload's line shows the
      // size, as the download's shows its percent
      const text =
        key === 'uploading' && dest.uploadMb !== undefined
          ? `${t(lang, 'uploading')} ${dest.uploadMb} MB`
          : undefined
      return then(() =>
        cut ? Promise.resolve() : progress(flood.flooded(ctx.chat!.id), (signal) => show(key, follow, signal, text)),
      )
    }
    // The download's live percent, from the job's weigh (job() reads
    // dest.onProgress): it overwrites the "Downloading…" status until the
    // video goes out. A flood skips a tick (progress), the last one stays up.
    const sayProgress = (pct: number | undefined, mb: number) => {
      if (!progressing || (pct === undefined && mb === 0)) return
      const text = pct !== undefined ? `${t(lang, 'downloading')} ${pct}% (${mb} MB)` : `${t(lang, 'downloading')} ${mb} MB`
      if (text === lastProgress) return
      lastProgress = text
      void then(() =>
        cut
          ? Promise.resolve()
          : progress(flood.flooded(ctx.chat!.id), async (signal) => {
              if (statusId) {
                await ctx.api.editMessageText(ctx.chat!.id, statusId, text, undefined, signal).catch(() => {})
              } else {
                statusId = (
                  await ctx.reply(text, { reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true } }, signal)
                ).message_id
              }
            }),
      ).catch(() => {})
    }
    const d = ctx.from
      ? promo.decide(ctx.from.id, ctx.chat!.type, lang)
      : null
    const dest: Dest = {
      chat: ctx.chat!.id,
      reply: ctx.msg!.message_id,
      promo: d?.promo,
      // anonymous admins and channel posts all come from one bot user
      who: ctx.msg!.sender_chat?.id ?? ctx.from?.id,
      // progress edits are for real chats: the e2e's fake API and stubs need
      // none of them, and they'd change the calls the tests count
      onProgress: env.E2E_PARENT_PID ? undefined : sayProgress,
      quality,
    }
    // The exit cuts off a request whose job hasn't begun its upload (past
    // the cut none begins one: job()), "⏫" or not. A request that has ended
    // (its final status or delete on its way), whose chat has its file (a
    // refresh may still run) or whose own job has begun the upload (a local
    // Bot API server finishes one by path after the exit) is left alone. One
    // following another request's job is cut: its own copy goes out only
    // after that job's.
    let ended = false
    const cutOff = () => {
      if (ended || dest.sent || dest.uploading) return
      cut = true
      void then(() =>
        progress(flood.flooded(ctx.chat!.id), (signal) => show('restarting', false, signal)),
      ).catch(() => {})
    }
    open.add(cutOff)
    // A final text answer (a transcript, a no-media tweet's text), split to
    // the 4 096-char message limit on line breaks: the status is gone first,
    // the first part replies to the link, the rest follow it
    const sendText = async (text: string) => {
      if (cut) return
      if (statusId) await ctx.api.deleteMessage(ctx.chat!.id, statusId).catch(() => {})
      statusId = undefined
      const parts: string[] = []
      let cur = ''
      for (const line of text.split('\n')) {
        if (cur.length + line.length + 1 > 4_090 && cur) {
          parts.push(cur)
          cur = line
        } else cur = cur ? cur + '\n' + line : line
        if (line.length > 4_090) {
          // one line longer than the limit (a tweet's, not a transcript's)
          for (let i = 0; i < line.length; i += 4_090) parts.push(line.slice(i, i + 4_090))
          cur = ''
        }
      }
      if (cur) parts.push(cur)
      for (let i = 0; i < parts.length; i++)
        await ctx.api.sendMessage(ctx.chat!.id, parts[i], {
          reply_parameters:
            i === 0
              ? { message_id: ctx.msg!.message_id, allow_sending_without_reply: true }
              : undefined,
        })
    }
    try {
      // the daily cap: once the user's MB today have reached it, no download
      // starts (the file's own size isn't predicted — the day is used up); a
      // group or a channel (dest.who not a positive user id) isn't capped
      const cap = DAILY_MB()
      const who = dest.who
      const capped = cap !== undefined && who !== undefined && who > 0 && capDecision(cap, usageUsed(who, dayKey()))
      if (capped) {
        ended = true
        await then(() =>
          show('limit', false, undefined, t(lang, 'limit').replaceAll('{mb}', String(cap))),
        )
        return
      }
      const f = await deliver(dest, url, status)
      ended = true
      promo.record(d)
      if (ctx.from && ctx.chat!.type === 'private') promo.used(ctx.from.id)
      // a status still on its way is up before it goes, the exit's notice too
      await shown
      // The transcript is the job's answer as text, not a file: it goes out
      // in the video's place (a final answer, so it waits out a flood, like a
      // tweet's text), after the status that showed the download
      if (f.text) {
        const text = f.text
        await then(() => sendText(text)).catch(() => {})
        return
      }
      if (statusId)
        await ctx.api.deleteMessage(ctx.chat!.id, statusId).catch(() => {})
    } catch (e) {
      ended = true
      console.error('failed', url, (e as Error).message)
      // A no-media tweet's text goes out in the video's place: a final answer,
      // so it waits out a flood (the api's floodWait), not skipped as progress
      if (e instanceof Tweet && e.text) {
        const text = e.text
        await then(() => sendText(text)).catch(() => {})
        return
      }
      const key = answer(
        e instanceof Fail ? e.key : 'failed',
        ctx.chat!.type,
        summoned(ctx.msg!, ctx.me.username),
        (e as Error).message,
      )
      if (key) await then(() => (cut ? Promise.resolve() : show(key))).catch(() => {})
      // nothing to say (a tweet without a video), but a status may be up (it
      // waited for a -J turn): it goes, as on success
      else
        await then(async () => {
          if (!cut && statusId) await ctx.api.deleteMessage(ctx.chat!.id, statusId)
        }).catch(() => {})
    } finally {
      open.delete(cutOff)
    }
  }

  // Guest mode: the bot gets one reply in a chat it isn't in, the answer to
  // the guest message. It goes out with a status text, which is edited as the
  // job goes on and into the video when it's ready.
  async function guest(ctx: Context) {
    const msg = ctx.guestMessage!
    const lang = langOfCtx(ctx)
    const me = { ...ctx.me, mine }
    const called = summoned(msg, me.username)
    // Telegram calls it on a plain reply to one of its messages too, so as
    // in a group a link in one that doesn't mention the bot only counts on a
    // site yt-dlp knows (and gets its answer once -J has found a video
    // there, below). One that asks for nothing ("thanks") gets the help only
    // if it mentions the bot; its own message forwarded or copied here,
    // mention and all, gets nothing either.
    const url = (await requested(msg, me, 'guest'))[0]
    if (!url && (own(msg, me) || !called)) return
    // Shows key in the reply after the texts before it: the first one posts
    // the reply (the answer), the others edit it, unless key is the one asked
    // for last (Telegram refuses an edit that changes nothing; a progress
    // edit a flood dropped counts too, harmless as statuses only move on).
    // Resolves to the reply's id, undefined when the answer failed.
    let reply: Promise<string | undefined> | undefined
    let shown: Key | undefined
    const say = (key: Key, signal?: Signal) => {
      if (reply && key === shown) return reply
      shown = key
      return (reply = reply
        ? reply.then(async (id) => {
            if (id) await ctx.api.editMessageTextInline(id, t(lang, key), undefined, signal).catch(() => {})
            return id
          })
        : ctx
            .answerGuestQuery({
              type: 'article',
              id: 'status',
              title: ctx.me.first_name,
              input_message_content: { message_text: t(lang, key) },
            })
            .then(
              (m) => m.inline_message_id,
              (e) => void console.error('guest answer failed', url, (e as Error).message),
            ))
    }
    // The same, with the text itself (a no-media tweet's post, sent in the
    // video's place): it always goes out, even when it equals what's shown
    const sayText = (text: string) => {
      if (reply)
        return reply.then(async (id) => {
          if (id) await ctx.api.editMessageTextInline(id, text).catch(() => {})
          return id
        })
      return (reply = ctx
        .answerGuestQuery({
          type: 'article',
          id: 'status',
          title: ctx.me.first_name,
          input_message_content: { message_text: text },
        })
        .then(
          (m) => m.inline_message_id,
          (e) => void console.error('guest answer failed', url, (e as Error).message),
        ))
    }
    // How much longer the answer to one that doesn't mention the bot may wait
    // for -J, in ms (below)
    const left = () => msg.date * 1000 + GUEST_WAIT - Date.now()
    // Answered at once: a mention; one with no time left to wait (handled
    // late, as after an outage), unless a deploy's drain has begun (then its
    // time being up doesn't answer it, below); one whose link the bot has a
    // copy of, so a video's (deliver() sends that copy, or downloads the
    // video again first when the copy went out without its size; should the
    // copy be gone and the page have no video any more, it hears the
    // failure). A copy whose row another process's lock keeps from being
    // read counts as none (get()). When that answer fails (the query is too
    // old by now), nobody would see the video: there's no job.
    if ((called || (left() <= 0 && !draining) || (url && get(url))) && !(await say(url ? 'downloading' : 'help'))) return
    if (!url) return
    if (!STORAGE) {
      if (reply) await say('failed')
      return
    }
    const dest: Dest = { chat: STORAGE, who: ctx.from?.id }
    // Otherwise it has no answer while its link waits for a -J turn or a
    // slot, as in a group: it's answered "Downloading…" once -J has found a
    // video and the download begins. A page without one gets no answer at
    // all, nor does a tweet without a video; a link that fails for real
    // hears what a group would (unasked()).
    // The answer can't wait for -J longer than Telegram keeps the query,
    // though: GUEST_WAIT after the message was sent it goes out with where
    // the job is ("In the queue" once it has had to wait for a -J turn or a
    // slot, even while it then reads the page, as a mention shows it;
    // "Downloading…" otherwise), and then a page without a video hears so,
    // as a mention would. Not once a deploy's drain has begun: the exit
    // could leave a page without a video showing "Downloading…" for good.
    let last: Key = 'downloading'
    const late = reply
      ? undefined
      : deadline(msg.guest_query_id!, left(), () => {
          if (!reply && !draining) void say(last)
        })
    // The job doesn't wait for the reply: the answer goes through a flood
    // wait (it's the one chance to post), which mustn't hold a slot, and an
    // edit after it waits for it. Progress isn't worth a flood wait, as in
    // handle(). Past the exit's cut no job begins an upload (job()), so one
    // with no answer yet stays without, as a group's request the cut found:
    // its "Downloading…" could only lead to "send the link again", or stay
    // up for good.
    const status = async (key: Key) => {
      if (!reply && key === 'queued') last = key
      else if (reply || !exiting) void say(key, PROGRESS)
    }
    try {
      const f = await deliver(dest, url, status)
      late?.()
      const id = await (reply ?? say('downloading'))
      if (!id) return
      const { caption, parse_mode } = options(dest, f)!
      await ctx.api.editMessageMediaInline(id, {
        type: f.kind,
        media: f.file_id,
        caption,
        parse_mode,
      } as InputMediaVideo)
    } catch (e) {
      late?.()
      console.error('guest failed', url, (e as Error).message)
      // A no-media tweet's text goes out in the video's place
      if (e instanceof Tweet && e.text) {
        await sayText(e.text).catch(() => {})
        return
      }
      const key = e instanceof Fail ? e.key : 'failed'
      // once answered it hears what went wrong, as a mention does
      const told = reply ? key || 'failed' : unasked(key, (e as Error).message)
      if (told) await say(told)
    } finally {
      // detached: a long flood wait mustn't hold the handler (and a deploy's drain)
      const sent = dest.sent
      if (sent) void unsend(() => bot.api.deleteMessage(dest.chat, sent))
    }
  }

  bot.use((ctx, next) => {
    try {
      const m = ctx.myChatMember
      if (m && m.chat.type === 'private') people.member(m.chat.id, m.new_chat_member.status)
      else if (!m) people.seen(ctx.chat?.id, ctx.from?.id, ctx.chat?.type)
    } catch (e) {
      console.error(e) // a stats write never blocks a download
    }
    return next()
  })
  const created = db.query<{ created: number }, [number]>('SELECT created FROM chats WHERE id = ?')
  // The welcome a fresh private chat hears on /start: what the bot does and
  // how, in the user's own language (their stored choice, else detection)
  const welcome = (ctx: Context) => {
    const createdAt = ctx.chat?.type === 'private' ? created.get(ctx.chat.id)?.created : undefined
    // only a fresh private chat (the census above has just created it)
    if (createdAt === undefined || Date.now() / 1000 - createdAt >= 600) return
    void track(
      ctx
        .reply(t(langOfCtx(ctx), 'welcome').replaceAll('{mb}', String(LIMIT >> 20)))
        .catch(console.error),
    )
  }
  bot.command(['start', 'help'], (ctx) => {
    // first: nothing the stats below run into can cost the help
    help(ctx)
    // a /start from another bot's campaign link (promo.ts); the census above has just added a new chat
    if (ctx.chat.type === 'private' && ctx.from && ctx.match)
      promo.arrived(ctx.from.id, ctx.match, () => Date.now() / 1000 - (created.get(ctx.chat.id)?.created ?? 0) < 600)
    // the welcome: a /start (not a /help, whose payload is a command; nor a
    // campaign's, whose payload is the campaign code and whose own text goes
    // out) in a fresh private chat
    else if (!/^\/help(@\w+)?\b/i.test(ctx.msg?.text ?? '')) welcome(ctx)
  })
  // /stats: the user's own downloads (today, this UTC month, all time) and
  // the daily cap's line. Private chats only: in a group it would say about
  // one member what the whole group could read
  bot.command('stats', (ctx) => {
    if (ctx.chat.type !== 'private' || !ctx.from) return
    void track(ctx.reply(statsText(langOfCtx(ctx), statsOf(usageRows(ctx.from.id)))).catch(console.error))
  })
  // /lang: the board of the bot's languages; /lang <code> takes it at once
  bot.command('lang', (ctx) => {
    const code = normalize(ctx.match?.trim() ?? '')
    if (code) {
      if (ctx.from) pickLang(ctx.from.id, code)
      return void track(ctx.reply(t(code, 'langSet')).catch(console.error))
    }
    const lang = langOfCtx(ctx)
    // Telegram allows 8 buttons in a row: two rows of 5 and 4
    const board = {
      inline_keyboard: [
        LANGS.slice(0, 5),
        LANGS.slice(5),
      ].map((row) => row.map(([c, name]) => ({ text: name, callback_data: `l:${c}` }))),
    }
    void track(ctx.reply(t(lang, 'langOffer'), { reply_markup: board }).catch(console.error))
  })
  bot.on('message', (ctx) => {
    const me = { ...ctx.me, mine }
    // its own videos forwarded or copied to it get no answer, not even the help
    if (own(ctx.msg, me)) return
    const found = links(ctx.msg, me)
    // handlers run detached so one long download doesn't block the next update;
    // a throw that gets past handle()'s own catch is logged, as unhandled it
    // would end the bot
    void track(
      requested(ctx.msg, me, ctx.chat.type).then((wanted) => {
        // a bare YouTube video link (private, not summoned) offers the quality
        // menu instead of downloading at once: the user taps best / 720p /
        // audio / transcript
        if (wanted.length === 1 && offerMenu(ctx, wanted[0], wanted)) {
          answerMenu(ctx, wanted[0])
          return
        }
        wanted.forEach((url) => void track(handle(ctx, url).catch(console.error)))
      }),
    )
    if (!found.length && ctx.chat.type === 'private') help(ctx)
  })
  // A tap on the quality menu: the quality, and the link the menu was for.
  // The link is looked up by the menu's reply (the link's message, keyed in
  // menuLinks), then by the video's id the button carries (a callback's
  // message may not keep its reply, as a local Bot API server's doesn't);
  // either becomes the message the download's status replies to (a fresh
  // Context on it, as the tap's own is a callback, not a message)
  bot.on('callback_query', (ctx) => {
    const data = ctx.callbackQuery.data
    const tap = data ? qualityTap(data) : undefined
    const menu = ctx.callbackQuery.message
    // a tap on /lang's board: the language it names, or undefined when the
    // callback is not one of those (the quality menu's are the q: ones)
    const named = data ? LANGS.find(([c]) => data === `l:${c}`)?.[0] : undefined
    if (named) {
      if (ctx.from) pickLang(ctx.from.id, named)
      const say = t(named, 'langSet')
      void track(
        ctx
          .answerCallbackQuery()
          .then(async () => {
            const message = ctx.callbackQuery.message
            if (message) await ctx.api.editMessageText(ctx.chat!.id, message.message_id, say)
            else if (ctx.chat) await ctx.reply(say)
          })
          .catch(console.error),
      )
      return
    }
    if (!tap || !menu) return
    const src = menu.reply_to_message
    let url = src ? menuLinks.get(`${ctx.chat!.id}:${src.message_id}`) : undefined
    if (!url && src) url = urls(src).find((u) => youtubeVideo(u))
    if (!url && tap.id) url = `https://www.youtube.com/watch?v=${tap.id}`
    if (!url) return
    void track(
      ctx
        .answerCallbackQuery()
        .then(async () => {
          if (src) menuLinks.delete(`${ctx.chat!.id}:${src.message_id}`)
          // the menu's buttons are spent; take the menu down
          await ctx.api.deleteMessage(ctx.chat!.id, menu.message_id).catch(() => {})
          // a fresh Context on the link's message; the button's id stands in
          // when the callback came without its reply (the menu's own message)
          const msg =
            src ??
            ({ message_id: menu.message_id, chat: menu.chat, from: ctx.from, text: url, entities: [] } as any)
          const fresh = new Context({ update_id: 0, message: msg } as any, bot.api, ctx.me)
          void track(handle(fresh, url, tap.q).catch(console.error))
        })
        .catch(() => {}),
    )
  })
  bot.on('guest_message', (ctx) => void track(guest(ctx).catch(console.error)))
  bot.on('my_chat_member', (ctx) => {
    const was = ctx.myChatMember.old_chat_member.status
    const now = ctx.myChatMember.new_chat_member.status
    if (ctx.chat.type === 'private' && now === 'kicked') promo.blocked(ctx.from.id)
    if (
      ctx.chat.type !== 'private' &&
      (was === 'left' || was === 'kicked') &&
      (now === 'member' || now === 'administrator')
    )
      help(ctx)
  })
  bot.catch((e) => console.error(e.error))

  if (!NO_UPDATE) setInterval(() => selfUpdate(updateOnce), 24 * 3600_000)
  void promo.refresh()
  setInterval(promo.refresh, 5 * 60_000)
  setInterval(promo.flush, 60_000)

  // Keeps the YouTube session in use so it doesn't go stale; Watch Later only
  // opens when logged in. If Google kills the session anyway, tell ADMIN_ID.
  async function keepalive() {
    if (!existsSync(JAR)) return
    const dir = await mkdtemp(join(TMP, 'keepalive-'))
    try {
      await ytdlp([
        ...(await jar(dir)),
        '--js-runtimes', 'bun', '--flat-playlist', '-I', '1', '-J',
        'https://www.youtube.com/playlist?list=WL',
      ])
      await saveJar(dir)
    } catch (e) {
      const why = `YouTube cookies look logged out, refresh COOKIES: ${(e as Error).message}`
      console.error(why)
      if (env.ADMIN_ID)
        await bot.api.sendMessage(env.ADMIN_ID, `⚠️ ${why}`).catch(console.error)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  // Polling and the shared cookie jar's keepalive run only on the container
  // holding the polling lock; bot.stop() confirms the fetched updates. They
  // begin once the first self-update try is over, while a failed one's
  // retries go on (yt-dlp runs wait for a try, not for the pauses between).
  return (NO_UPDATE ? Promise.resolve() : selfUpdate(updateOnce).first).then(() =>
    pollWithHandover(
      () => {
        setInterval(keepalive, 6 * 3600_000)
        void keepalive()
        return bot.start({
          allowed_updates: ['message', 'guest_message', 'my_chat_member', 'callback_query'],
          onStart: (me) => console.log(`@${me.username} up, uploads ≤ ${LIMIT >> 20} MB`),
        })
      },
      () => bot.stop(),
      async () => {
        // the links still waiting for a yt-dlp -J turn or a slot won't get
        // one here (the new container polls by now), nor will a long video
        // (it couldn't finish before the exit): they hear so rather than stay
        // "in the queue". A short one that finds a free turn still goes.
        console.log(`draining ${running}`)
        draining = true
        meta.close(new Fail('restarting'))
        slots.close(new Fail('restarting'))
        // the jobs still running 2 s before the exit won't finish: their
        // chats hear so the same way, rather than keep "Downloading…", and
        // from then on no upload begins
        // (CUT_MS moves the cut: bot.e2e.test.ts cuts at once, reading the
        // "cut" line, and ends the drain itself)
        const exit = setTimeout(
          () => {
            exiting = true
            console.log(`cut ${open.size}`)
            open.forEach((cut) => cut())
          },
          Number(env.CUT_MS ?? DRAIN - 2_000),
        )
        while (running) await Bun.sleep(100)
        clearTimeout(exit)
        await promo.flush()
      },
    ),
  )
}

if (import.meta.main) {
  // An e2e bot exits once its test process is gone, and its yt-dlp runs'
  // groups go with it: a test run killed outright (a SIGKILL, a worker's time
  // limit) can't stop its bots, and one left behind would poll its fake Bot
  // API's port for good, which a later test's fake may get (#460).
  // E2E_PARENT_PID is that process's pid (bot.e2e.test.ts); once it's gone,
  // the bot is another process's child (launchd's, init's or a subreaper's).
  // Production sets no E2E_PARENT_PID, and nothing watches (nor for 1 or less:
  // a container's PID 1 bot has the parent 0)
  const parent = Number(env.E2E_PARENT_PID)
  if (parent > 1)
    setInterval(() => {
      if (process.ppid === parent) return
      runs.forEach((end) => end())
      console.error(`E2E_PARENT_PID ${parent} is gone (the parent is ${process.ppid} now), exiting`)
      process.exit(1)
    }, 1000).unref()
  if (!env.EGRESS_DENY?.trim())
    console.warn("EGRESS_DENY is empty: the host's own public addresses are reachable")
  await SCRATCH.start()
  await mkdir(DATA, { recursive: true })
  await seedJar()
  await main()
}
