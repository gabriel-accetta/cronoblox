import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", use: { baseURL: "http://127.0.0.1:3017", trace: "on-first-retry" }, webServer: { command: "pnpm dev:web", url: "http://127.0.0.1:3017", reuseExistingServer: true }, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }] });
