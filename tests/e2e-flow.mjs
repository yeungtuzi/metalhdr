import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const ctx = await chromium.launchPersistentContext("/tmp/mh-ext-flow", {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1440, height: 900 }
});
const page = await ctx.newPage();
await page.goto("https://www.bilibili.com/video/BV1GJ411x7h7/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

const snap = async (tag) => {
  const r = await page.evaluate(() => {
    const host = document.getElementById("metalhdr-root");
    const panel = host?.shadowRoot?.querySelector(".panel");
    const v = document.querySelector("video");
    const c = document.querySelector("canvas.metalhdr-canvas");
    return {
      paused: v?.paused, opacity: v ? getComputedStyle(v).opacity : null,
      canvas: c ? [c.width, c.height] : null,
      status: (panel?.querySelector("[data-status]")?.innerText || "").replace(/\n/g, " | ")
    };
  });
  console.log(tag, JSON.stringify(r));
  return r;
};

const before = await snap("before-play:");
// 暂停态：视频必须可见，不能黑屏
console.log(before.opacity === "1" ? "✓ 暂停时原视频保持可见" : "✗ 暂停时被隐藏了");

await page.evaluate(() => { const v = document.querySelector("video"); v.muted = true; return v.play().catch(() => {}); });
await page.waitForTimeout(4000);
const after = await snap("after-play :");
console.log(after.opacity === "0" ? "✓ 首帧后原视频隐藏，改由 canvas 接管" : "✗ 仍在显示原视频");

await page.screenshot({ path: "tests/flow-after-play.png" });
await ctx.close();
