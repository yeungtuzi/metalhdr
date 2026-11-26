import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const userjs = readFileSync(new URL("../dist/metalhdr.user.js", import.meta.url), "utf8");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const URL_ = process.argv[2] || "https://www.bilibili.com/video/BV1GJ411x7h7/";

const browser = await chromium.launch({
  executablePath: BRAVE,
  headless: false,
  ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.slice(0, 200)));

await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(7000);
await page.evaluate(userjs);
await page.waitForTimeout(4500);

const info = await page.evaluate(() => {
  const v = document.querySelector("video");
  const c = document.querySelector("canvas.metalhdr-canvas");
  const host = document.getElementById("metalhdr-root");
  const panel = host?.shadowRoot?.querySelector(".panel");
  const status = panel?.querySelector("[data-status]")?.innerText || "";
  const sysNits = panel?.querySelector("[data-sysnits]")?.textContent || "";
  return {
    video: v ? { w: v.videoWidth, h: v.videoHeight, opacity: getComputedStyle(v).opacity } : null,
    canvas: c ? { w: c.width, h: c.height, rect: (() => { const r = c.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() } : null,
    hasHost: !!host,
    status,
    sysNits,
    dynamicRange: matchMedia("(dynamic-range: high)").matches
  };
});
console.log(JSON.stringify(info, null, 2));

// 打开面板 → 切到低画质
await page.locator(".pill").click();
await page.waitForTimeout(400);
const panelVisible = await page.locator(".panel").isVisible();
await page.locator('.seg[data-seg="quality"] button[data-v="low"]').click();
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const host = document.getElementById("metalhdr-root");
  const panel = host?.shadowRoot?.querySelector(".panel");
  const c = document.querySelector("canvas.metalhdr-canvas");
  return { status: panel?.querySelector("[data-status]")?.innerText || "", canvas: !!c };
});
console.log("panelVisible:", panelVisible);
console.log("afterLow:", JSON.stringify(after));
console.log("errors:", errors.slice(0, 8));

await page.screenshot({ path: "tests/out-bilibili.png" });
await browser.close();
