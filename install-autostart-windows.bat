@echo off
chcp 65001 >nul
rem Makes Mobile Mix start automatically (minimized) every time Windows starts.
set "DIR=%~dp0"
set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MobileMix.bat"
(
  echo @echo off
  echo cd /d "%DIR%"
  echo start "Mobile Mix" /min cmd /c "npm start"
) > "%TARGET%"
echo.
echo تم ✅ — Mobile Mix هيشتغل لوحده مع كل تشغيل للويندوز.
echo للإلغاء: امسح الملف ده:
echo %TARGET%
echo.
pause
