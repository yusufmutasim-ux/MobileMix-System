@echo off
chcp 65001 >nul
title Mobile Mix
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js مش متسطب - نزله من https://nodejs.org ^(نسخة 22 أو أحدث^) & pause & exit /b)
if not exist node_modules (echo جاري تسطيب المتطلبات لأول مرة... & call npm install --omit=dev)
start "" http://localhost:3000
call npm start
pause
