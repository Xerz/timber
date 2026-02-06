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
const detailsDesktop = JSON.parse(
  fs.readFileSync(path.join(fixturesRoot, "product_details", "pid-desktop.json"), "utf8")
);

test("filterEnabledAvailable filters by enabled && available", () => {
  const result = filterEnabledAvailable(stationProducts);
  assert.equal(result.length, 1);
  assert.equal(result[0].productId, "pid-desktop");
});

test("buildLaunchParams prefers overrides then defaults", () => {
  const launch = buildLaunchParams(detailsDesktop);
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
  const enabled = [{ productId: "p1", enabled: true, available: true, title: "Fallback" }];
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
    defaultGamePath: "C:\\\\Default.exe",
    workPath: "C:\\\\Work",
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
    { productId: "p1", enabled: true, available: true, title: "FromItem" },
    { productId: "p2", enabled: true, available: true }
  ];
  const map = buildProductMap([]);
  const cards = buildCards(enabled, map);
  assert.equal(cards[0].title, "FromItem");
  assert.equal(cards[1].title, "Игра");
});
