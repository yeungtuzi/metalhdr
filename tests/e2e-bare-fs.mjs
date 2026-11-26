import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const ctx = await chromium.launchPersistentContext("/tmp/mh-bare-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"],
  viewport: { width: 1000, height: 700 }
});
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:8900/demo/fs-test.html");
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const v = document.querySelector("video");
  v.muted = true;
  v.load();
  await v.play().catch(() => {});
});
await page.waitForTimeout(2500);

const snap = async (tag) => {
  const r = await page.evaluate(() => {
    const v = document.querySelector("video");
    const c = document.querySelector("canvas.metalhdr-canvas");
    const fs = document.fullscreenElement;
    return {
      fs: fs ? fs.tagName : null,
      canvas: !!c,
      videoOpacity: v ? getComputedStyle(v).opacity : null,
      vp: v ? { paused: v.paused, t: +v.currentTime.toFixed(2), rs: v.readyState, w: v.videoWidth, h: v.videoHeight, muted: v.muted } : null,
      attr: document.documentElement.dataset.metalhdr || "none",
      toast: document.getElementById("metalhdr-root")?.shadowRoot?.querySelector(".toast")?.textContent || ""
    };
  });
  console.log(tag, JSON.stringify(r));
  return r;
};

await snap("before   :");
await page.click("#fs");
await page.waitForTimeout(2000);
await snap("in-fs    :");
await page.screenshot({ path: "tests/bare-fs.png" });
await page.evaluate(() => document.exitFullscreen());
await page.waitForTimeout(3000);
await snap("after    :");
await ctx.close();
