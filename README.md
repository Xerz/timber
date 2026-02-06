# Drova Launcher (Tauri)

## Что внутри
- Tauri 2 (Rust backend + web UI) вместо AHK.
- UI в `src/` (HTML/CSS/JS), стили сайта подключаются с `https://drova.io/index.min.css`.
- Кроссплатформенные тесты (node + Playwright).

## Структура
- `src/` — UI.
- `src-tauri/` — Tauri backend (Rust).
- `public/` — mock‑данные для UI‑тестов.
- `fixtures/` — фикстуры JSON для unit тестов модели.
- `tests/` — тесты `node --test` и Playwright.

## Разработка на macOS
- UI превью (без Tauri): открыть `src/index.html?mock=1` через простой сервер.
- Тесты логики: `npm test`.
- UI‑тесты: `npm run test:ui` (перед первым запуском: `npx playwright install`).
- Для запуска Tauri на macOS нужны переменные окружения `DROVA_STATION_UUID` и `DROVA_AUTH_TOKEN`.
- Удобно задать их через `.env` (см. `.env.example`).

## Windows рантайм
- Установить Rust и Tauri prerequisites.
- `npm install`
- `npm run tauri dev`

## Примечания
- Для API используется заголовок `X-Auth-Token`.
- Desktop‑карточка закрывает лаунчер без запуска exe.
- Кэш картинок хранится во временной директории `drova-launcher/images`.
