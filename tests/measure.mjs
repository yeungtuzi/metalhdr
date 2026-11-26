import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const url = process.argv[2] || "http://127.0.0.1:8900/demo/measure.html";
const ctx = await chromium.launchPersistentContext("/tmp/mh-m-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
         "--autoplay-policy=no-user-gesture-required"],
  viewport: { width: 1200, height: 800 }
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
await page.goto(url);
await page.waitForTimeout(2500);
await page.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.load(); await v.play().catch(() => {}); });
await page.waitForTimeout(5000);
const attr = await page.evaluate(() => document.documentElement.dataset.metalhdr || "none");
console.log(attr);
console.log("errors:", errs.slice(0, 4));
await page.screenshot({ path: "tests/measure.png" });
await ctx.close();
