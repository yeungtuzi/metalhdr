import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const ctx = await chromium.launchPersistentContext("/tmp/mh-zc-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"],
  viewport: { width: 1200, height: 800 }
});
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem("metalhdr:settings", JSON.stringify({ zeroCopy: true, quality: "high" }));
});
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
await page.goto("http://127.0.0.1:8900/demo/measure.html");
await page.waitForTimeout(2000);
await page.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.load(); await v.play().catch(() => {}); });
await page.waitForTimeout(5000);
console.log(await page.evaluate(() => document.documentElement.dataset.metalhdr || "none"));
await page.screenshot({ path: "tests/zc.png", clip: { x: 120, y: 130, width: 960, height: 540 } });
console.log("errors:", errs.slice(0, 3));
await ctx.close();
