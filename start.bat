@echo off
rem Open OPTCG Deck Buyer through http://127.0.0.1 so card images from the
rem game folder can also be drawn into the exported image (file:// cannot).
rem Serves the parent folder because the game lives at ..\Builds_Windows.
rem Keep the port fixed: browser data (decks, sellers) is stored per port.

setlocal
set PORT=8730
for %%I in ("%~dp0.") do set APPDIR=%%~nxI
set URL=http://127.0.0.1:%PORT%/%APPDIR%/index.html
cd /d "%~dp0.."

where python >nul 2>nul && (set PY=python) || (set PY=py)

if not defined NOBROWSER start "" /b cmd /c "timeout /t 1 /nobreak >nul & start "" "%URL%""

echo OPTCG Deck Buyer: %URL%
echo Close this window to stop.
echo.
%PY% -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo Could not start the server. If the app is already open in another window, just use the browser.
  echo Otherwise install Python from https://www.python.org/ and try again.
  pause
)
