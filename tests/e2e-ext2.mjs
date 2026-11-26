import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const ctx = await chromium.launchPersistentContext("/tmp/mh-ext-profile", {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
         "--autoplay-policy=no-user-gesture-required"],
  viewport: { width: 1440, height: 900 }
});
const page = await ctx.newPage();
await page.goto("https://www.bilibili.com/video/BV1GJ411x7h7/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
await page.evaluate(() => { const v = document.querySelector("video"); if (v) { v.muted = true; v.play().catch(() => {}); } });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const ctrl = MetalHDR?.app?.state?.controller;
  const v = document.querySelector("video");
  return {
    hasNamespace: typeof MetalHDR !== "undefined",
    ctrlVideo: ctrl ? { same: ctrl.video === v, paused: ctrl.video.paused, w: ctrl.video.videoWidth, h: ctrl.video.videoHeight, t: ctrl.video.currentTime } : null,
    pageVideo: v ? { paused: v.paused, t: v.currentTime, opacity: getComputedStyle(v).opacity } : null,
    status: ctrl?.getStatus?.() || null
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "tests/ext-bilibili2.png" });
await ctx.close();
