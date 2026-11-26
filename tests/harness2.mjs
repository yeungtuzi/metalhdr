import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const userjs = readFileSync(new URL("../dist/metalhdr.user.js", import.meta.url), "utf8");
const browser = await chromium.launch({
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", "--autoplay-policy=no-user-gesture-required", "--window-size=1400,900"]
});
const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text().slice(0, 220)));
page.on("pageerror", (e) => logs.push("ERR " + e.message.slice(0, 220)));
await page.goto("http://127.0.0.1:8899/index.html");
await page.waitForTimeout(1500);
const before = await page.evaluate(() => {
  const v = document.querySelector("video");
  return { paused: v.paused, t: v.currentTime, rs: v.readyState, w: v.videoWidth, h: v.videoHeight };
});
await page.evaluate(userjs);
await page.waitForTimeout(2000);
const after = await page.evaluate(() => {
  const v = document.querySelector("video");
  const c = document.querySelector("canvas.metalhdr-canvas");
  const st = MetalHDR.app.state.controller?.getStatus();
  return {
    video: { paused: v.paused, t: v.currentTime, opacity: getComputedStyle(v).opacity },
    canvas: c ? { w: c.width, h: c.height, rect: (() => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(), css: c.style.cssText } : null,
    st
  };
});
console.log("before:", JSON.stringify(before));
console.log("after:", JSON.stringify(after, null, 1));
console.log("logs:", logs.slice(0, 10).join("\n"));
await page.screenshot({ path: "tests/full-hq.png" });
await browser.close();
