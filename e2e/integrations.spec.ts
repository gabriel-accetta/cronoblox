import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/runs", (route) => route.fulfill({ json: { runs: [] } }));
});

test("opens installation from the hero, downloads a real plugin and restores focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Add to your AI", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Claude", exact: true })).toHaveAttribute("aria-selected", "true");
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download Claude plugin", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("cronoblox-claude-plugin.zip");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  const manifest = JSON.parse(strFromU8(files[".claude-plugin/plugin.json"]!));
  expect(manifest.name).toBe("cronoblox");
  const config = JSON.parse(strFromU8(files[".mcp.json"]!));
  expect(config.mcpServers.cronoblox.url).toMatch(/\/mcp$/);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("copies the MCP endpoint and a game-specific prompt without starting a paid run", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let runStarted = false;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/runs")) runStarted = true; });
  await page.goto("/");
  await page.getByLabel("ROBLOX GAME URL OR EXPERIENCE ID").fill("https://www.roblox.com/games/123");
  await page.getByRole("button", { name: "Use in ChatGPT", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy URL", exact: true }).click();
  const config = await (await page.request.get("/api/integrations")).json();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(config.endpoint);
  await dialog.getByRole("button", { name: "Copy starter prompt", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("https://www.roblox.com/games/123");
  expect(runStarted).toBe(false);
  await dialog.getByRole("tab", { name: "ChatGPT", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Other clients" })).toHaveAttribute("aria-selected", "true");
});

test("works on mobile and offers manual copy when clipboard access fails", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Use in ChatGPT", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Copy URL", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Copy URL text" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(375);
});
