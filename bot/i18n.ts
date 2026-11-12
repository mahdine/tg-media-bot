const strings = {
  en: {
    help: "😎 Send me a link to a video, and I'll send the video back.\n\nWorks in groups too: add me to a group, and I'll download every video link posted there.",
    downloading: '⏬ Downloading…',
    queued: "⏳ In the queue: I'm busy with other videos and will start on this one as soon as I can…",
    restarting: "🔄 I'm restarting for an update, so this download was cancelled. Please send the link again in a minute.",
    uploading: '⏫ Uploading…',
    failed: "😱 I couldn't download this video.",
    tooBig: '😱 This video is too large for Telegram.',
    live: "📡 This is a live stream, so I can't download it yet. Try sending me the recording once the stream has ended.",
    upcoming: "⏳ This stream hasn't started yet, so there's nothing to download. Try sending me the recording once it has ended.",
    tweetNotFound: "😕 I couldn't find that post — it may have been deleted, or it's private.",
    qualityMenu: '🎬 What should I do with this video?',
    qBest: '🎬 Best video',
    q720: '📱 720p',
    qAudio: '🎵 Audio only',
    qTranscript: '📝 Transcript',
    welcome:
      "👋 I turn links into files: send me a link to a video or a post, and I'll send the file back here — YouTube, Instagram, X, TikTok and over 1,000 other sites, files up to {mb} MB.\n\nA bare YouTube link gets a quality menu first: best video, 720p, audio only or a transcript.\n\nIn groups, add me and make me an admin so I see every link; otherwise I download only the links that mention me.\n\nPrefer another language? /lang",
    langOffer: '🌐 Pick the language I speak to you in:',
    langSet: '✅ I will speak to you in English from now on.',
  },
  ru: {
    help: '😎 Пришлите мне ссылку на видео, и я пришлю само видео.\n\nВ группах тоже работаю: добавьте меня в группу, и я буду скачивать все видео по ссылкам, которые там отправляют.',
    downloading: '⏬ Скачиваю…',
    queued: '⏳ В очереди: сейчас я скачиваю другие видео, а за ваше возьмусь, как только смогу…',
    restarting: '🔄 Я перезапускаюсь для обновления, поэтому эта загрузка отменена. Пришлите ссылку ещё раз через минуту.',
    uploading: '⏫ Загружаю…',
    failed: '😱 Не получилось скачать это видео.',
    tooBig: '😱 Это видео слишком большое для Telegram.',
    live: '📡 Это прямая трансляция, поэтому пока я не могу её скачать. Пришлите мне запись, когда трансляция закончится.',
    upcoming: '⏳ Эта трансляция ещё не началась, поэтому скачивать пока нечего. Пришлите мне запись, когда она закончится.',
    tweetNotFound: '😕 Я не нашёл этот пост — возможно, он удалён или закрыт.',
    qualityMenu: '🎬 Что мне сделать с этим видео?',
    qBest: '🎬 Лучшее видео',
    q720: '📱 720p',
    qAudio: '🎵 Только аудио',
    qTranscript: '📝 Транскрипт',
    welcome:
      '👋 Я превращаю ссылки в файлы: пришлите мне ссылку на видео или пост — я пришлю файл обратно сюда. YouTube, Instagram, X, TikTok и ещё более 1000 сайтов; файлы до {mb} МБ.\n\nДля ссылки на YouTube я сначала покажу меню качества: лучшее видео, 720p, только звук или текст.\n\nВ группах добавьте меня и сделайте админом, чтобы я видел все ссылки; иначе скачиваю только ссылки, где меня упоминают.\n\nХотите другой язык? /lang',
    langOffer: '🌐 Выберите язык, на котором я с вами общаюсь:',
    langSet: '✅ Теперь я буду говорить с вами по-русски.',
  },
  es: {
    help: '😎 Envíame un enlace a un vídeo y te enviaré el vídeo.\n\nTambién funciono en grupos: añádeme a un grupo y descargaré todos los vídeos cuyos enlaces se publiquen allí.',
    downloading: '⏬ Descargando…',
    queued: '⏳ En cola: ahora estoy descargando otros vídeos y empezaré con este en cuanto pueda…',
    restarting: '🔄 Me estoy reiniciando para actualizarme, así que he cancelado esta descarga. Vuelve a enviarme el enlace dentro de un minuto.',
    uploading: '⏫ Subiendo…',
    failed: '😱 No pude descargar este vídeo.',
    tooBig: '😱 Este vídeo es demasiado grande para Telegram.',
    live: '📡 Es una transmisión en directo, así que todavía no puedo descargarla. Envíame la grabación cuando haya terminado.',
    upcoming: '⏳ Esta transmisión aún no ha empezado, así que no hay nada que descargar. Envíame la grabación cuando haya terminado.',
    tweetNotFound: '😕 No encontré esa publicación: puede estar eliminada o ser privada.',
    qualityMenu: '🎬 ¿Qué hago con este vídeo?',
    qBest: '🎬 Mejor vídeo',
    q720: '📱 720p',
    qAudio: '🎵 Solo audio',
    qTranscript: '📝 Transcripción',
    welcome:
      '👋 Convierto enlaces en archivos: envíame un enlace a un vídeo o a una publicación y te enviaré el archivo de vuelta aquí — YouTube, Instagram, X, TikTok y más de 1.000 sitios, archivos de hasta {mb} MB.\n\nUn enlace de YouTube a secas recibe primero el menú de calidad: mejor vídeo, 720p, solo audio o transcripción.\n\nEn grupos, añádenme y hazme administrador para que vea todos los enlaces; si no, solo descargo los enlaces donde me mencionan.\n\n¿Prefieres otro idioma? /lang',
    langOffer: '🌐 Elige el idioma en el que te hablo:',
    langSet: '✅ A partir de ahora te hablaré en español.',
  },
  'pt-br': {
    help: '😎 Me mande o link de um vídeo e eu te envio o vídeo.\n\nTambém funciono em grupos: me adicione a um grupo e vou baixar todos os vídeos cujos links forem enviados lá.',
    downloading: '⏬ Baixando…',
    queued: '⏳ Na fila: estou baixando outros vídeos agora e começo este assim que puder…',
    restarting: '🔄 Estou reiniciando para uma atualização, então este download foi cancelado. Me mande o link de novo daqui a um minuto.',
    uploading: '⏫ Enviando…',
    failed: '😱 Não consegui baixar este vídeo.',
    tooBig: '😱 Este vídeo é grande demais para o Telegram.',
    live: '📡 Esta é uma transmissão ao vivo, então ainda não consigo baixá-la. Me mande a gravação quando ela terminar.',
    upcoming: '⏳ Esta transmissão ainda não começou, então não há nada para baixar. Me mande a gravação quando ela terminar.',
    tweetNotFound: '😕 Não encontrei essa publicação: ela pode ter sido apagada ou ser privada.',
    qualityMenu: '🎬 O que faço com este vídeo?',
    qBest: '🎬 Melhor vídeo',
    q720: '📱 720p',
    qAudio: '🎵 Só áudio',
    qTranscript: '📝 Transcrição',
    welcome:
      '👋 Eu transformo links em arquivos: me mande um link de um vídeo ou de uma publicação e eu te envio o arquivo de volta aqui — YouTube, Instagram, X, TikTok e mais de 1.000 sites, arquivos de até {mb} MB.\n\nUm link de YouTube a seco recebe primeiro o menu de qualidade: melhor vídeo, 720p, só áudio ou transcrição.\n\nEm grupos, me adicione e me torne administrador para que eu veja todos os links; caso contrário, só baixo os links que me mencionam.\n\nPrefere outro idioma? /lang',
    langOffer: '🌐 Escolha o idioma em que eu falo com você:',
    langSet: '✅ A partir de agora vou falar com você em português (Brasil).',
  },
  pt: {
    help: '😎 Envia-me a ligação de um vídeo e eu envio-te o vídeo.\n\nTambém funciono em grupos: adiciona-me a um grupo e vou descarregar todos os vídeos cujas ligações forem partilhadas lá.',
    downloading: '⏬ A descarregar…',
    queued: '⏳ Na fila: estou a descarregar outros vídeos e começo este assim que puder…',
    restarting: '🔄 Estou a reiniciar para uma atualização, por isso esta transferência foi cancelada. Envia-me a ligação outra vez daqui a um minuto.',
    uploading: '⏫ A enviar…',
    failed: '😱 Não consegui descarregar este vídeo.',
    tooBig: '😱 Este vídeo é demasiado grande para o Telegram.',
    live: '📡 Isto é uma transmissão em direto, por isso ainda não a consigo descarregar. Envia-me a gravação quando tiver terminado.',
    upcoming: '⏳ Esta transmissão ainda não começou, por isso não há nada para descarregar. Envia-me a gravação quando tiver terminado.',
    tweetNotFound: '😕 Não encontrei essa publicação: pode ter sido apagada ou é privada.',
    qualityMenu: '🎬 O que faço com este vídeo?',
    qBest: '🎬 Melhor vídeo',
    q720: '📱 720p',
    qAudio: '🎵 Só áudio',
    qTranscript: '📝 Transcrição',
    welcome:
      '👋 Eu transformo ligações em ficheiros: envia-me a ligação de um vídeo ou de uma publicação e eu envio-te o ficheiro de volta aqui — YouTube, Instagram, X, TikTok e mais de 1.000 sites, ficheiros até {mb} MB.\n\nUma ligação de YouTube a secas recebe primeiro o menu da qualidade: melhor vídeo, 720p, só áudio ou transcrição.\n\nEm grupos, adiciona-me e torna-me administrador para que eu veja todas as ligações; caso contrário, só descarrego as ligações onde me mencionam.\n\nPrefere outro idioma? /lang',
    langOffer: '🌐 Escolhe o idioma em que eu falo contigo:',
    langSet: '✅ A partir de agora vou falar contigo em português.',
  },
  ja: {
    help: '😎 動画のリンクを送ってください。動画にしてお返しします。\n\nグループでも使えます：私をグループに追加すると、投稿された動画リンクをすべてダウンロードします。',
    downloading: '⏬ ダウンロード中…',
    queued: '⏳ 順番待ち中です。ほかの動画をダウンロードしているので、できるだけ早くこの動画に取りかかります…',
    restarting: '🔄 アップデートのために再起動しているので、このダウンロードはキャンセルされました。1分ほどしてから、もう一度リンクを送ってください。',
    uploading: '⏫ アップロード中…',
    failed: '😱 この動画をダウンロードできませんでした。',
    tooBig: '😱 この動画はTelegramに送るには大きすぎます。',
    live: '📡 これはライブ配信なので、まだダウンロードできません。配信が終わったら、アーカイブを送ってください。',
    upcoming: '⏳ この配信はまだ始まっていないので、ダウンロードできるものがありません。配信が終わったら、アーカイブを送ってください。',
    tweetNotFound: '😕 その投稿を見つけられませんでした。削除されたか、非公開の可能性があります。',
    qualityMenu: '🎬 この動画はどうしますか？',
    qBest: '🎬 最高画質',
    q720: '📱 720p',
    qAudio: '🎵 音声のみ',
    qTranscript: '📝 文字起こし',
    welcome:
      '👋 リンクをファイルに変えます：動画や投稿のリンクを送ってください。ファイルをお返しします — YouTube、Instagram、X、TikTok、1,000以上のサイトに対応し、{mb} MB までのファイルを扱います。\n\nYouTube のリンクだけを送ると、まず品質のメニューが出ます：最高画質、720p、音声のみ、文字起こし。\n\nグループでは、私を追加して管理者にするとすべてのリンクが見えます。そうでない場合は、メンションのあるリンクだけダウンロードします。\n\n別の言語がよいですか？ /lang を使ってください。',
    langOffer: '🌐 私の返信の言語を選んでください:',
    langSet: '✅ 今後は日本語でお答えします。',
  },
  zh: {
    help: '😎 给我发送视频链接，我会把视频发回给你。\n\n也可以在群组中使用：把我加入群组，我会下载群里发的所有视频链接。',
    downloading: '⏬ 正在下载…',
    queued: '⏳ 排队中：我正在下载其他视频，会尽快开始处理这个视频…',
    restarting: '🔄 我正在重启以进行更新，所以这次下载已取消。请过一分钟再把链接发给我。',
    uploading: '⏫ 正在上传…',
    failed: '😱 无法下载这个视频。',
    tooBig: '😱 这个视频太大，无法发送到 Telegram。',
    live: '📡 这是正在进行的直播，所以暂时无法下载。直播结束后，请把回放发给我。',
    upcoming: '⏳ 这个直播还没有开始，所以没有可下载的内容。直播结束后，请把回放发给我。',
    tweetNotFound: '😕 找不到这条帖子——可能已被删除，或是私密的。',
    qualityMenu: '🎬 这个视频怎么处理？',
    qBest: '🎬 最佳画质',
    q720: '📱 720p',
    qAudio: '🎵 仅音频',
    qTranscript: '📝 文字记录',
    welcome:
      '👋 我把链接变成文件：把视频或帖子的链接发给我，我会把文件发回这里 — 支持 YouTube、Instagram、X、TikTok 和 1000 多个网站，文件最大 {mb} MB。\n\n只发一个 YouTube 链接时，我会先给你质量菜单：最佳画质、720p、仅音频、文字记录。\n\n在群组里，把我加进来并设为管理员，我就能看到所有链接；否则只有提到我的链接才会被下载。\n\n想用其他语言？发送 /lang。',
    langOffer: '🌐 选择我用什么语言回复你:',
    langSet: '✅ 从现在开始我将用中文回复你。',
  },
  ar: {
    help: '😎 أرسل لي رابط فيديو وسأرسل لك الفيديو نفسه.\n\nأعمل في المجموعات أيضًا: أضفني إلى مجموعة وسأنزّل كل فيديو يُنشر رابطه هناك.',
    downloading: '⏬ جارٍ التنزيل…',
    queued: '⏳ في قائمة الانتظار: أنزّل فيديوهات أخرى الآن، وسأبدأ بهذا الفيديو في أقرب وقت ممكن…',
    restarting: '🔄 أُعيد التشغيل الآن من أجل تحديث، لذا أُلغي هذا التنزيل. أرسل لي الرابط مرة أخرى بعد دقيقة.',
    uploading: '⏫ جارٍ الرفع…',
    failed: '😱 لم أتمكن من تنزيل هذا الفيديو.',
    tooBig: '😱 هذا الفيديو كبير جدًا بالنسبة لتيليجرام.',
    live: '📡 هذا بث مباشر، لذا لا يمكنني تنزيله بعد. أرسل لي التسجيل بعد انتهاء البث.',
    upcoming: '⏳ هذا البث لم يبدأ بعد، لذا لا يوجد ما يمكن تنزيله. أرسل لي التسجيل بعد انتهائه.',
    tweetNotFound: '😕 لم أجد هذه المنشورة — قد تكون محذوفة أو خاصة.',
    qualityMenu: '🎬 ماذا أفعل بهذا الفيديو؟',
    qBest: '🎬 أفضل فيديو',
    q720: '📱 720p',
    qAudio: '🎵 صوت فقط',
    qTranscript: '📝 نص الفيديو',
    welcome:
      '👋 أحوّل الروابط إلى ملفات: أرسل لي رابط فيديو أو منشور وسأرسل لك الملف هنا — يوتيوب، إنستغرام، إكس، تيك توك وأكثر من 1000 موقع، وملفات حتى {mb} م.ب.\n\nإذا أرسلت رابط يوتيوب وحده، أقدّم لك أولاً قائمة الجودة: أفضل فيديو، 720p، صوت فقط، أو نص الفيديو.\n\nفي المجموعات، أضفني واجعلني مشرفًا لأرى كل الروابط؛ وإلا أنزّل فقط الروابط التي تذكرني.\n\nتفضّل لغة أخرى؟ /lang',
    langOffer: '🌐 اختر اللغة التي أتكلم بها معك:',
    langSet: '✅ سأتكلم معك باللغة العربية من الآن فصاعدًا.',
  },
  fa: {
    help: '😎 لینک یک ویدیو را برایم بفرست تا خود ویدیو را برایت بفرستم.\n\nدر گروه‌ها هم کار می‌کنم: من را به گروه اضافه کن تا همه ویدیوهایی را که لینکشان آنجا فرستاده می‌شود دانلود کنم.',
    downloading: '⏬ در حال دانلود…',
    queued: '⏳ در صف: الان دارم ویدیوهای دیگری را دانلود می‌کنم و هر چه زودتر سراغ این یکی می‌روم…',
    restarting: '🔄 برای به‌روزرسانی دارم دوباره راه‌اندازی می‌شوم، برای همین این دانلود لغو شد. یک دقیقه دیگر دوباره لینک را بفرست.',
    uploading: '⏫ در حال آپلود…',
    failed: '😱 نتوانستم این ویدیو را دانلود کنم.',
    tooBig: '😱 این ویدیو برای تلگرام خیلی بزرگ است.',
    live: '📡 این یک پخش زنده است، برای همین هنوز نمی‌توانم دانلودش کنم. وقتی پخش تمام شد، ضبط آن را برایم بفرست.',
    upcoming: '⏳ این پخش هنوز شروع نشده، برای همین چیزی برای دانلود نیست. وقتی تمام شد، ضبط آن را برایم بفرست.',
    tweetNotFound: '😕 نتونستم این پست را پیدا کنم — احتمالا حذف شده یا خصوصی است.',
    qualityMenu: '🎬 با این ویدیو چه کار کنم؟',
    qBest: '🎬 بهترین کیفیت',
    q720: '📱 720p',
    qAudio: '🎵 فقط صوت',
    qTranscript: '📝 متن ویدیو',
    welcome:
      '👋 من لینک‌ها را فایل می‌کنم: لینک یک ویدیو یا پست را بفرست تا فایلش را همین‌جا برایت بفرستم — یوتیوب، اینستاگرام، ایکس، تیک‌تاک و بیش از ۱۰۰۰ سایت دیگر؛ تا {mb} مگابایت.\n\nبرای لینک خالی یوتیوب اول منوی کیفیت می‌دهم: بهترین کیفیت، ۷۲۰p، فقط صدا، یا متن ویدیو.\n\nدر گروه‌ها، من را اضافه کن و ادمین کن تا همه لینک‌ها را ببینم؛ وگرنه فقط لینک‌هایی را که منشن می‌کنی دانلود می‌کنم.\n\nزبان دیگری ترجیح می‌دهی؟ /lang',
    langOffer: '🌐 انتخاب کن به چه زبانی باهات حرف بزنم:',
    langSet: '✅ از این به بعد به فارسی باهات حرف می‌زنم.',
  },
}

export type Key = keyof typeof strings.en
export type Code = keyof typeof strings

// The languages the bot speaks, in the /lang board's order, each with the
// name it goes by in itself (a button's text)
export const LANGS: [Code, string][] = [
  ['en', 'English'],
  ['ru', 'Русский'],
  ['es', 'Español'],
  ['pt-br', 'Português (Brasil)'],
  ['pt', 'Português'],
  ['ja', '日本語'],
  ['zh', '中文'],
  ['ar', 'العربية'],
  ['fa', 'فارسی'],
]

// Telegram sends IETF codes like "en", "pt-br", "zh-hans"; plain "pt" means
// Portugal. A code the bot speaks (its locale), or undefined when it doesn't:
// a /lang choice of one must not silently become English
export function normalize(code: string): Code | undefined {
  code = code.trim().toLowerCase()
  if (code in strings) return code as Code
  const base = code.split('-')[0]
  return base in strings ? (base as Code) : undefined
}
// Detection's normalization: a code the bot doesn't speak still gets an
// answer (in English), as a user's Telegram is not its mistake
export function lang(code = 'en'): Code {
  return normalize(code) ?? 'en'
}
// The language a reply goes out in: the user's stored choice (/lang) wins,
// then what Telegram detected, then English
export const resolve = (detected: string | undefined, stored?: string | null): Code =>
  stored && stored in strings ? (stored as Code) : lang(detected)

export const t = (code: string | undefined, key: Key) => strings[lang(code)][key]
