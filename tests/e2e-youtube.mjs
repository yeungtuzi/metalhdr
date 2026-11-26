import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const ctx = await chromium.launchPersistentContext("/tmp/mh-yt-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"],
  viewport: { width: 1440, height: 900 }
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
await page.goto("https://www.youtube.com/watch?v=aqz-KE-bpKQ", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
await page.evaluate(async () => { const v = document.querySelector("video"); if (v) { v.muted = true; await v.play().catch(() => {}); } });
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const v = document.querySelector("video");
  const c = document.querySelector("canvas.metalhdr-canvas");
  const host = document.getElementById("metalhdr-root");
  const panel = host?.shadowRoot?.querySelector(".panel");
  return {
    url: location.href.slice(0, 60),
    vw: v?.videoWidth, vh: v?.videoHeight, paused: v?.paused,
    canvas: c ? [c.width, c.height] : null,
    hasHost: !!host,
    attr: document.documentElement.dataset.metalhdr || "none",
    status: (panel?.querySelector("[data-status]")?.innerText || "").replace(/\n/g, " | ")
  };
});
console.log(JSON.stringify(info, null, 2));
console.log("errors:", errs.slice(0, 3));
await page.screenshot({ path: "tests/youtube.png" });
await ctx.close();
