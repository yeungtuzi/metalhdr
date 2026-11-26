import { chromium } from "playwright-core";
import { resolve } from "node:path";
const ext = resolve("dist/metalhdr-extension");
const ctx = await chromium.launchPersistentContext("/tmp/mh-fs-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
         "--window-size=1600,1000"],
  viewport: { width: 1500, height: 900 }
});
const page = await ctx.newPage();
await page.goto("https://www.bilibili.com/video/BV1GJ411x7h7/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(7000);
await page.evaluate(() => { const v = document.querySelector("video"); v.muted = true; return v.play().catch(() => {}); });
await page.waitForTimeout(2500);

const state = async (tag) => {
  const r = await page.evaluate(() => {
    const v = document.querySelector("video");
    const c = document.querySelector("canvas.metalhdr-canvas");
    const fs = document.fullscreenElement;
    const vr = v?.getBoundingClientRect();
    const cr = c?.getBoundingClientRect();
    return {
      fs: fs ? fs.tagName + "." + String(fs.className || "").slice(0, 30) : null,
      canvas: c ? { w: c.width, h: c.height, rect: cr && [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)] } : null,
      video: vr && [Math.round(vr.x), Math.round(vr.y), Math.round(vr.width), Math.round(vr.height)],
      videoOpacity: v ? getComputedStyle(v).opacity : null,
      inFs: fs && c ? fs.contains(c) : null,
      attr: document.documentElement.dataset.metalhdr || "none"
    };
  });
  console.log(tag, JSON.stringify(r));
  return r;
};

await state("before-fs:");
const clicked = await page.evaluate(() => {
  const btn = document.querySelector(".bpx-player-ctrl-full");
  if (btn) { btn.click(); return btn.className; }
  return null;
});
console.log("clicked:", clicked);
await page.waitForTimeout(2500);
const fsState = await state("in-fs    :");
await page.screenshot({ path: "tests/fs.png" });

await page.keyboard.press("Escape");
await page.waitForTimeout(2500);
await state("after-fs :");
console.log("手写对比 canvas/video rect 是否一致:", JSON.stringify(fsState.canvas?.rect) === JSON.stringify(fsState.video));
await ctx.close();
