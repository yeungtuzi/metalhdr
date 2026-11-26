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
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
await page.goto("https://www.bilibili.com/video/BV1GJ411x7h7/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);
const info = await page.evaluate(() => {
  const host = document.getElementById("metalhdr-root");
  const panel = host?.shadowRoot?.querySelector(".panel");
  const c = document.querySelector("canvas.metalhdr-canvas");
  const v = document.querySelector("video");
  return {
    hasHost: !!host,
    canvas: c ? { w: c.width, h: c.height } : null,
    videoOpacity: v ? getComputedStyle(v).opacity : null,
    sysNits: panel?.querySelector("[data-sysnits]")?.textContent || "",
    status: (panel?.querySelector("[data-status]")?.innerText || "").replace(/\n/g, " | ")
  };
});
console.log(JSON.stringify(info, null, 2));
console.log("errors:", errs.slice(0, 5));
await page.screenshot({ path: "tests/ext-bilibili.png" });
await ctx.close();
