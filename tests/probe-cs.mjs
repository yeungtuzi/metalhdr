import { chromium } from "playwright-core";
const ctx = await chromium.launchPersistentContext("/tmp/cs-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"]
});
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:8900/demo/harness.html");
const r = await page.evaluate(async () => {
  const out = {};
  const dev = await (await navigator.gpu.requestAdapter()).requestDevice();
  const c = document.createElement("canvas");
  const g = c.getContext("webgpu");
  const base = { device: dev, format: "rgba16float", alphaMode: "opaque" };
  for (const cs of ["srgb", "display-p3", "rec2100-pq", "rec2100-hlg", "srgb-linear"]) {
    try { g.configure({ ...base, colorSpace: cs }); out["wgpu_" + cs] = "accepted"; }
    catch (e) { out["wgpu_" + cs] = "throw: " + e.message.slice(0, 70); }
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await ctx.close();
