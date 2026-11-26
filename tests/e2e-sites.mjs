import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");

const check = async (url, label) => {
  const ctx = await chromium.launchPersistentContext("/tmp/mh-s-" + Date.now() + Math.random(), {
    executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
    args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"],
    viewport: { width: 1440, height: 900 }
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(async () => { const v = document.querySelector("video"); if (v) { v.muted = true; await v.play().catch(() => {}); } });
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => ({
    canvas: !!document.querySelector("canvas.metalhdr-canvas"),
    opacity: (() => { const v = document.querySelector("video"); return v ? getComputedStyle(v).opacity : null; })(),
    attr: document.documentElement.dataset.metalhdr || "none"
  }));
  console.log(label, JSON.stringify(r));
  await ctx.close();
};

await check("https://www.youtube.com/watch?v=aqz-KE-bpKQ", "SDR YouTube:");
await check("https://www.youtube.com/watch?v=LXb3EKWsInQ", "HDR YouTube:");
