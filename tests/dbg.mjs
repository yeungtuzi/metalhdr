import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const ctx = await chromium.launchPersistentContext("/tmp/mh-dbg-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1440, height: 900 }
});
const page = await ctx.newPage();
await page.goto("https://www.bilibili.com/video/BV1GJ411x7h7/", { waitUntil: "domcontentloaded", timeout: 60000 });
for (const t of [3000, 3000, 4000]) {
  await page.waitForTimeout(t);
  const d = await page.evaluate(() => ({
    attr: document.documentElement.dataset.metalhdr || "none",
    vw: document.querySelector("video")?.videoWidth,
    paused: document.querySelector("video")?.paused,
    frames: document.querySelectorAll("video").length,
    canvases: document.querySelectorAll("canvas.metalhdr-canvas").length,
    host: !!document.getElementById("metalhdr-root")
  }));
  console.log(JSON.stringify(d));
}
await ctx.close();
