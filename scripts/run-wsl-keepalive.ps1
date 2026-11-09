# Keep a WSL2 distro alive while no terminal window has it open.
# WSL2 idles out its VM (~2-4 min) when unused; the bot would die mid-download.
# Register (PowerShell, no admin needed):
#   schtasks /Create /F /SC MINUTE /MO 1 /TN "WslBotKeepalive" ^
#     /TR "powershell.exe -NoProfile -WindowStyle Hidden -File run-wsl-keepalive.ps1"
$distro = "Ubuntu-22.04"
wsl.exe -d $distro -- true 2>$null
exit 0
