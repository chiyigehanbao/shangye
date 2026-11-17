@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\puppeteer-core" goto havedep
echo [setup] Installing test dependency: puppeteer-core ...
call npm install --no-audit --no-fund
if errorlevel 1 goto depfail

:havedep
echo.
echo ============================================
echo   [1/3] Core unit tests
echo ============================================
node tests\core.test.js
if errorlevel 1 goto fail

echo.
echo ============================================
echo   [2/3] Backend auth / doc tests
echo ============================================
where python >nul 2>nul
if errorlevel 1 goto nopython
python tests\backend_auth.py
if errorlevel 1 goto fail
python tests\backend_doc.py
if errorlevel 1 goto fail
goto browser

:nopython
echo [skip] python not found - backend tests skipped.

:browser
echo.
echo ============================================
echo   [3/3] Browser functional tests
echo ============================================
node tests\ui.test.js
if errorlevel 1 goto fail

echo.
echo ============================================
echo   ALL TESTS PASSED
echo ============================================
pause
exit /b 0

:nonode
echo [ERROR] node not found. Install Node.js or add it to PATH.
pause
exit /b 1

:depfail
echo [ERROR] Failed to install dependencies. Check network.
pause
exit /b 1

:fail
echo.
echo ============================================
echo   TESTS FAILED (see output above)
echo ============================================
pause
exit /b 1
