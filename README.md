# Drova Launcher (Tauri)

## Что внутри
- Tauri 2 (Rust backend + web UI).
- UI в `src/` и локальная копия стилей сайта (`src/index.min.css` + `src/styles.css`).
- Карточки игр + шапка сервера с модальными окнами описания и характеристик.
- Тесты: `node --test` и Playwright.

## Структура
- `src/` — UI (HTML/CSS/JS).
- `src-tauri/` — Tauri backend (Rust).
- `public/` — mock‑данные для режима `?mock=1`.
- `fixtures/` — фикстуры JSON для unit тестов модели.
- `tests/` — тесты `node --test` и Playwright.

## Разработка на macOS
- UI превью: запустить любой статический сервер и открыть `index.html?mock=1` (берёт `public/mock-data.json`).
- Тесты логики: `npm test`.
- UI‑тесты: `npm run test:ui` (перед первым запуском: `npx playwright install`).
- Для запуска Tauri на macOS нужны `DROVA_STATION_UUID` и `DROVA_AUTH_TOKEN` (можно в `.env`).
- Опционально: `DROVA_IMAGE_CACHE=1` включает кэш картинок (temp `drova-launcher/images`, TTL 24ч).

## Windows рантайм
- Установить Rust и Tauri prerequisites.
- `npm install`
- `npm run tauri dev`

## Примечания
- Авторизация API: `X-Auth-Token` используется только для списка игр (station products).
- Desktop‑карточка закрывает лаунчер без запуска exe; остальные игры запускаются без закрытия окна.
