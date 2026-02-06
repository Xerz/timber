import test from "node:test";
import assert from "node:assert/strict";
import {
  filterEnabledAvailable,
  buildProductMap,
  buildLaunchParams,
  buildCards,
  buildFallbackDesktopCard
} from "../src/model.js";
import stationProducts from "../fixtures/station_products.json" assert { type: "json" };
import productsFull from "../fixtures/products_full.json" assert { type: "json" };
import detailsDesktop from "../fixtures/product_details/pid-desktop.json" assert { type: "json" };

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
