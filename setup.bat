@echo off
echo ============================================================
echo  PSA Time Entry System - Setup Script
echo ============================================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is NOT installed!
    echo.
    echo Please install Node.js first:
    echo   https://nodejs.org/en/download  (LTS version recommended)
    echo.
    echo After installing, re-run this script.
    pause
    exit /b 1
)

echo [OK] Node.js found:
node --version
echo.

:: Install dependencies
echo [1/3] Installing npm packages...
npm install
if %errorlevel% neq 0 ( echo [ERROR] npm install failed. & pause & exit /b 1 )
echo.

:: Run Prisma migration
echo [2/3] Running Prisma database migration...
npx prisma migrate dev --name init
if %errorlevel% neq 0 ( echo [ERROR] Migration failed. & pause & exit /b 1 )
echo.

:: Seed database
echo [3/3] Seeding database with sample data...
node prisma/seed.js
if %errorlevel% neq 0 ( echo [ERROR] Seeding failed. & pause & exit /b 1 )
echo.

echo ============================================================
echo  Setup complete!
echo ============================================================
echo.
echo  To start the server, run:
echo    npm start
echo.
echo  Then open your browser to:
echo    http://localhost:3000
echo.
echo  Default login credentials:
echo    Admin:  admin / admin123
echo    User:   jsmith / user123
echo    User:   mjohnson / user123
echo.
echo  External API Key (for UiPath/Snowflake):
echo    psa-external-api-key-uipath-snowflake
echo.
pause
