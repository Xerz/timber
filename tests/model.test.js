import test from "node:test";
import assert from "node:assert/strict";
import {
  filterEnabledAvailable,
  buildProductMap,
  buildLaunchParams,
  buildCards,
  buildFallbackDesktopCard
} from "../src/model.js";
import fs from "node:fs";
import path from "node:path";

const fixturesRoot = path.resolve(process.cwd(), "fixtures");
const stationProducts = JSON.parse(
  fs.readFileSync(path.join(fixturesRoot, "station_products.json"), "utf8")
);
const productsFull = JSON.parse(
  fs.readFileSync(path.join(fixturesRoot, "products_full.json"), "utf8")
);

test("filterEnabledAvailable filters by enabled && ready", () => {
  const result = filterEnabledAvailable(stationProducts);
  assert.equal(result.length, 1);
  assert.equal(result[0].product_id, "pid-desktop");
});

test("buildLaunchParams uses station product fields", () => {
  const launch = buildLaunchParams(stationProducts[0]);
  assert.equal(launch.exePath, "C:\\Program Files (x86)\\Steam\\Steam.exe");
  assert.equal(launch.workDir, "C:\\Program Files (x86)\\Steam");
  assert.equal(launch.args, "-language russian");
});

test("buildCards maps display fields", () => {
  const enabled = filterEnabledAvailable(stationProducts);
  const map = buildProductMap(productsFull);
  const cards = buildCards(enabled, map);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "Рабочий стол");
  assert.equal(cards[0].isFree, true);
});

test("buildFallbackDesktopCard returns desktop", () => {
  const card = buildFallbackDesktopCard();
  assert.equal(card.productId, "desktop");
  assert.equal(card.isFree, true);
});

test("buildCards trims alt to 100 chars and maps badges", () => {
  const longText = "a".repeat(120);
  const enabled = [{ product_id: "p1", enabled: true, verified: "READY", title: "Fallback" }];
  const map = buildProductMap([{
    productId: "p1",
    displayName: "Game Name",
    descriptionRu: longText,
    requiredAccount: "Steam",
    noLicenseRequred: true,
    cardPicture: "https://example.com/a.jpg"
  }]);
  const cards = buildCards(enabled, map);
  assert.equal(cards[0].title, "Game Name");
  assert.equal(cards[0].alt.length, 100);
  assert.equal(cards[0].requiredAccount, "Steam");
  assert.equal(cards[0].isFree, true);
});

test("buildLaunchParams prefers overrides", () => {
  const details = {
    gamePath: "C:\\\\Game.exe",
    game_path: "C:\\\\GameSnake.exe",
    defaultGamePath: "C:\\\\Default.exe",
    workPath: "C:\\\\Work",
    work_path: "C:\\\\WorkSnake",
    defaultWorkPath: "C:\\\\DefaultWork",
    args: "-custom",
    defaultArgs: "-default"
  };
  const launch = buildLaunchParams(details);
  assert.equal(launch.exePath, "C:\\\\Game.exe");
  assert.equal(launch.workDir, "C:\\\\Work");
  assert.equal(launch.args, "-custom");
});

test("buildCards falls back to item title or default", () => {
  const enabled = [
    { product_id: "p1", enabled: true, verified: "READY", title: "FromItem" },
    { product_id: "p2", enabled: true, verified: "READY" }
  ];
  const map = buildProductMap([]);
  const cards = buildCards(enabled, map);
  assert.equal(cards[0].title, "FromItem");
  assert.equal(cards[1].title, "Игра");
});

test("filterEnabledAvailable respects verified flag", () => {
  const items = [
    { product_id: "p1", enabled: true, verified: "NOT_READY" },
    { product_id: "p2", enabled: true }
  ];
  const result = filterEnabledAvailable(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].product_id, "p2");
});
