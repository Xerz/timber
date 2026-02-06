import { test, expect } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");
const publicRoot = path.join(projectRoot, "public");
let server;
let baseUrl;

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
