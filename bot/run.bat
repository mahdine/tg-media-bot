@echo off
REM ============================================================
REM  Run the Telegram video downloader bot
REM  1) Put your bot token in .env  (the TOKEN= line)
REM  2) Double-click this file
REM  All tools (bun, yt-dlp, ffmpeg) come from the local
REM  bin\ folder - nothing else is needed on your system.
REM ============================================================
setlocal
cd /d "%~dp0"
set "PATH=%~dp0bin;%PATH%"

echo Starting bot...
bin\bun.exe bot.ts
pause
