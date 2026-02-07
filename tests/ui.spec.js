import { test, expect } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");
const publicRoot = path.join(projectRoot, "public");
let server;
let baseUrl;

async function addTauriStub(page, options = {}) {
  const {
    cards = [],
    loadError = null,
    launchError = null,
    stationDetails = {
      name: "Тестовый сервер",
      description: "<p>Описание</p>",
      hardware: {
        ram_bytes: 34359738368,
        processor: { version: "AMD Ryzen 5 1600 Six-Core Processor" },
        graphic: [{ name: "NVIDIA GeForce RTX 3060", ram_bytes: 12884901888 }]
      }
    }
  } = options;
  await page.addInitScript(({ cards, loadError, launchError, stationDetails }) => {
    window.__TAURI_TEST_DISABLE_AUTO_INIT = true;
    window.__invokeCalls = [];
    window.__statusCallback = null;
    window.__emitStatus = (payload) => {
      if (window.__statusCallback) {
        window.__statusCallback({ payload });
      }
    };
    window.__TAURI__ = {
      core: {
        invoke: (cmd, args) => {
          window.__invokeCalls.push({ cmd, args });
          if (cmd === "load_cards") {
            if (loadError) return Promise.reject(new Error(loadError));
            return Promise.resolve(cards);
          }
          if (cmd === "load_station_details") {
            return Promise.resolve(stationDetails);
          }
          if (cmd === "launch_game") {
            if (launchError) return Promise.reject(new Error(launchError));
            return Promise.resolve(null);
          }
          return Promise.reject(new Error(`Unknown command: ${cmd}`));
        }
      },
      event: {
        listen: (event, cb) => {
          if (event === "status") {
            window.__statusCallback = cb;
          }
          return Promise.resolve(() => {});
        }
      }
    };
  }, { cards, loadError, launchError, stationDetails });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  if (ext === ".json") return "application/json";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function resolvePath(requestPath) {
  const safePath = decodeURIComponent((requestPath || "/").split("?")[0]);
  if (safePath === "/" || safePath === "/index.html") {
    return path.join(srcRoot, "index.html");
  }
  if (safePath === "/mock-data.json") {
    return path.join(publicRoot, "mock-data.json");
  }
  if (safePath.startsWith("/assets/")) {
    return path.join(srcRoot, safePath);
  }
  return path.join(srcRoot, safePath);
}

function isSafe(filePath, root) {
  const normalized = path.normalize(filePath);
  return normalized.startsWith(root);
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const filePath = resolvePath(req.url);
    const root = filePath.includes(`${path.sep}public${path.sep}`) ? publicRoot : srcRoot;

    if (!isSafe(filePath, root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": getContentType(filePath) });
      res.end(data);
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
});

test("renders tiles from mock data", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html?mock=1`);
  await page.waitForSelector(".gameList__item");
  const count = await page.locator(".gameList__item").count();
  expect(count).toBeGreaterThan(0);
});

test("hover changes tile style", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html?mock=1`);
  const card = page.locator(".gameList__item").first();
  await card.waitFor();

  const before = await card.evaluate(el => getComputedStyle(el).transform);
  await card.hover();
  const after = await card.evaluate(el => getComputedStyle(el).transform);

  expect(after).not.toBe(before);
});

test("click marks tile as launching", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html?mock=1`);
  const card = page.locator(".gameList__item").first();
  await card.click();
  await expect(card).toHaveClass(/is-launching/);
});

test("broken image falls back to placeholder", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html?mock=1`);
  const broken = page.locator('.gameList__item[data-product-id="broken"]');
  await broken.waitFor();
  await expect(broken).toHaveClass(/card--placeholder/, { timeout: 5000 });
});

test("status shows retry on data load failure", async ({ page }) => {
  await page.route("**/mock-data.json", route => route.abort());
  await page.goto(`${baseUrl}/index.html?mock=1`);
  const status = page.locator("#status");
  await expect(status).not.toHaveClass(/is-hidden/);
  await expect(page.locator("#retryBtn")).toBeVisible();
});

test("tauri mode renders cards from invoke", async ({ page }) => {
  await addTauriStub(page, {
    cards: [
      { productId: "a", title: "A", imageUrl: "", alt: "", requiredAccount: "", isFree: false },
      { productId: "b", title: "B", imageUrl: "", alt: "", requiredAccount: "", isFree: true }
    ]
  });
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => typeof window.__resetLauncher === "function");
  await page.evaluate(() => window.__resetLauncher());
  await page.waitForSelector(".gameList__item");
  await expect(page.locator(".gameList__item")).toHaveCount(2);
});

test("tauri status event updates progress text", async ({ page }) => {
  await addTauriStub(page, { cards: [] });
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => typeof window.__resetLauncher === "function");
  await page.evaluate(() => window.__resetLauncher());
  await page.waitForFunction(() => typeof window.__emitStatus === "function");
  await page.evaluate(() => window.__emitStatus({ text: "Загружаем…", current: 1, total: 3 }));
  await expect(page.locator("#progressText")).toHaveText(" — Загружаем… 1/3");
});

test("tauri load_cards error shows retry and fallback", async ({ page }) => {
  await addTauriStub(page, { loadError: "fail" });
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => typeof window.__resetLauncher === "function");
  await page.evaluate(() => window.__resetLauncher());
  await expect(page.locator("#retryBtn")).toBeVisible();
  await expect(page.locator('.gameList__item[data-product-id="desktop"]')).toHaveCount(1);
});

test("tauri launch_game error clears launching and shows status", async ({ page }) => {
  await addTauriStub(page, {
    cards: [{ productId: "a", title: "A", imageUrl: "", alt: "", requiredAccount: "", isFree: false }],
    launchError: "boom"
  });
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => typeof window.__resetLauncher === "function");
  await page.evaluate(() => window.__resetLauncher());
  const card = page.locator(".gameList__item").first();
  await card.click();
  await expect(page.locator("#statusText")).toHaveText("Ошибка запуска");
  await expect(card).not.toHaveClass(/is-launching/);
});
