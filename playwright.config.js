import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /ui\.spec\.js/,
  timeout: 30_000,
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 720 }
  }
});
