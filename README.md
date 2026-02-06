# Drova Launcher MVP

## Что внутри
- AHK v2 скрипт с разделением по модулям.
- UI на HTML/CSS/JS, максимально близкий к плиткам сайта.
- Кроссплатформенные тесты бизнес‑логики на Node.js.

## Структура
- `launcher.ahk` — точка входа AHK.
- `lib/` — модули AHK (реестр, API, модель, кэш, UI).
- `ui/` — HTML/CSS/JS интерфейс.
- `src/` — JS модель для тестов.
- `tests/` — тесты `node --test`.
- `fixtures/` — фикстуры ответов API.

## Разработка на macOS
- UI превью: открыть `ui/index.html?mock=1` в браузере.
- Тесты: `npm test`.
- UI‑тесты: `npm run test:ui` (перед первым запуском: `npx playwright install`).

## Windows рантайм
- Установить AutoHotkey v2.
- Установить WebView2 Runtime.
- Подключить WebViewToo и настроить `lib/webview2.ahk`.
- Запуск: `launcher.ahk`.

## Примечания
- В `launcher.ahk` используются заголовки `X-Auth-Token`.
- Кэш изображений хранится в `cache/images`.
- CSS подключен из `https://drova.io/index.min.css`.
- Desktop‑карточка закрывает лаунчер без запуска exe.
