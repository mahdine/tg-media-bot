// live-smoke.ts — run the deployed bot's real code path against a real URL
// and send the result into the owner's private chat. Run INSIDE the bot
// container (it needs the same env: TOKEN, BOT_API_URL) and the owner's
// chat id:
//
//   docker exec -e LIVE_CHAT_ID=<owner id> tg-media-bot sh -c \
//     "cp /app/scripts/live-smoke.ts /tmp/ && cd /app && bun /tmp/live-smoke.ts"
//
// (LIVE_CHAT_ID: the owner's row in the bot's users table, /data/bot.sqlite.)
// Optional LIVE_URL overrides the default ("Me at the zoo", 19s).
// Prints one OK/FAIL line per check and ends with SMOKE: ALL PASS or
// SMOKE: HAS FAILURES.
//
// The import resolves against the container layout (/app/bot.ts) first, then
// the repo layout (scripts/../bot/bot.ts), so the same file runs either way.
import { spawn } from 'bun'

const _bot = await (async () => {
  const candidates = ['/app/bot.ts', Bun.file(import.meta.resolve('../bot/bot.ts')).path]
  for (const p of candidates) {
    try { return await import(p) } catch { /* try the next */ }
  }
  throw new Error('cannot find bot.ts')
})()
const { qualityArgs, pickSub, vttText, youtubeVideo } = _bot

const API = process.env.BOT_API_URL || 'http://bot-api:8081'
const TOKEN = process.env.TOKEN!
const CHAT = process.env.LIVE_CHAT_ID! // owner's private chat id, from the bot's users table
const URL = process.env.LIVE_URL || 'https://www.youtube.com/watch?v=jNQXAC9IVRw' // 19s

const api = async (method: string, body?: any) => {
  const r = await fetch(`${API}/bot${TOKEN}/${method}`, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined)
  return r.json()
}

const ytdlp = (args: string[], dir: string) => new Promise<{ code: number; err: string }>((resolve, reject) => {
  const proc = spawn({ cmd: ['yt-dlp', ...args, URL], cwd: dir, stdout: 'pipe', stderr: 'pipe' })
  let err = ''
  proc.stderr!.text().then((t) => (err = t)).catch(() => {})
  proc.exited.then((code) => resolve({ code, err })).catch(reject)
})

const results: string[] = []
const ok = (name: string, v: unknown) => results.push(`OK   ${name}: ${JSON.stringify(v).slice(0, 200)}`)
const bad = (name: string, v: unknown) => results.push(`FAIL ${name}: ${JSON.stringify(v).slice(0, 300)}`)

try {
  // 1) the token works against the local Bot API server (the 2GB path)
  const me = await api('getMe')
  me.ok ? ok('getMe', `${me.result.username} (local server, uploads 2GB)`) : bad('getMe', me)

  const dir = '/tmp/live'
  await Bun.$`rm -rf ${dir} && mkdir -p ${dir}`

  // 2) real download with the bot's own 720 args, then a REAL sendVideo to the owner's chat
  youtubeVideo(URL) ? ok('youtubeVideo', 'recognized as a YouTube URL') : bad('youtubeVideo', URL)
  const dl = await ytdlp(qualityArgs('720'), dir)
  dl.code === 0 ? ok('yt-dlp 720', 'exit 0') : bad('yt-dlp 720', dl.err.slice(0, 200))
  const vids = (await Bun.$`ls ${dir}/*.mp4 2>/dev/null`.text()).trim().split('\n').filter(Boolean)
  if (vids.length) {
    const p = vids[0]!
    const size = await Bun.file(p).size
    ok('downloaded', `${p.split('/').pop()} (${(size / 1048576).toFixed(1)} MB)`)
    const buf = await Bun.file(p).arrayBuffer()
    const fd = new FormData()
    fd.append('chat_id', String(CHAT))
    fd.append('caption', '🎬 live smoke: 720p, the bot\'s own args, sent over the local 2GB Bot API')
    fd.append('video', new File([buf], 'live-test.mp4'))
    const sv = await fetch(`${API}/bot${TOKEN}/sendVideo`, { method: 'POST', body: fd }).then((r) => r.json())
    sv.ok ? ok('sendVideo (2GB path)', `message_id=${sv.result.message_id}`) : bad('sendVideo', sv)
  } else bad('downloaded', 'no .mp4 on disk')

  // 3) real transcript with the bot's own args + pickSub + vttText, then a REAL sendMessage
  const tdir = '/tmp/livet'
  await Bun.$`rm -rf ${tdir} && mkdir -p ${tdir}`
  const tt = await ytdlp(qualityArgs('transcript'), tdir)
  const vttNames = (await Bun.$`ls ${tdir}/*.vtt 2>/dev/null`.text()).trim().split('\n').map((s) => s.split('/').pop()!).filter(Boolean)
  const pick = pickSub(vttNames)
  pick ? ok('yt-dlp transcript', `exit ${tt.code}, vtt=${pick}`) : bad('yt-dlp transcript', `exit ${tt.code} ${tt.err.slice(0, 200)} vtt=${vttNames}`)
  if (pick) {
    const text = vttText(await Bun.file(`${tdir}/${pick}`).text())
    const lines = text.split('\n')
    let dup = 0
    for (let i = 1; i < lines.length; i++) if (lines[i] === lines[i - 1]) dup++
    ok('vttText', `${lines.length} lines, ${dup} consecutive dupes, first: "${lines[0]!.slice(0, 60)}"`)
    const sm = await api('sendMessage', { chat_id: Number(CHAT), text: `📝 live smoke transcript (${pick})\n\n${text.slice(0, 1200)}` })
    sm.ok ? ok('sendMessage transcript', `message_id=${sm.result.message_id}`) : bad('sendMessage', sm)
  }
} catch (e) {
  bad('exception', String(e).slice(0, 300))
}
console.log(results.join('\n'))
console.log(results.some((r) => r.startsWith('FAIL')) ? 'SMOKE: HAS FAILURES' : 'SMOKE: ALL PASS')
