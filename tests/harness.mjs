import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const userjs = readFileSync(new URL("../dist/metalhdr.user.js", import.meta.url), "utf8");
const browser = await chromium.launch({
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false,
  ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", "--autoplay-policy=no-user-gesture-required", "--window-size=1400,900"]
});
const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
await page.goto("http://127.0.0.1:8899/index.html");
await page.waitForTimeout(1200);
await page.evaluate(userjs);
await page.waitForTimeout(1500);

const apply = async (patch) => {
  await page.evaluate((p) => {
    const s = MetalHDR.core.load();
    MetalHDR.app.setSettings({ ...s, ...p });
  }, patch);
  await page.waitForTimeout(1200);
};

const status = () => page.evaluate(() => {
  const host = document.getElementById("metalhdr-root");
  const panel = host?.shadowRoot?.querySelector(".panel");
  return panel?.querySelector("[data-status]")?.innerText || "";
});

await apply({ quality: "high", strength: 0.62 });
console.log("HQ:", (await status()).replace(/\n/g, " | "));
await page.screenshot({ path: "tests/hq-62.png", clip: { x: 40, y: 40, width: 1280, height: 720 } });

await apply({ strength: 0 });
await page.screenshot({ path: "tests/hq-0.png", clip: { x: 40, y: 40, width: 1280, height: 720 } });

await apply({ quality: "low", strength: 0.62 });
console.log("LQ:", (await status()).replace(/\n/g, " | "));
await page.screenshot({ path: "tests/lq-62.png", clip: { x: 40, y: 40, width: 1280, height: 720 } });

console.log("errors:", errs.slice(0, 5));
await browser.close();
