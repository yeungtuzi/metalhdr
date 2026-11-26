import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const userjs = readFileSync(new URL("../dist/metalhdr.user.js", import.meta.url), "utf8");
const browser = await chromium.launch({
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"], args: ["--no-first-run"]
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8899/index.html");
await page.evaluate(userjs);
const msgs = await page.evaluate(async () => {
  const out = [];
  for (const key of ["WGSL_MAIN", "WGSL_DOWN"]) {
    const mod = MetalHDR.app.state && null;
    const dev = await (await navigator.gpu.requestAdapter()).requestDevice();
    const m = dev.createShaderModule({ code: MetalHDR.shaders[key] });
    const info = await m.getCompilationInfo();
    out.push({ key, count: info.messages.length, messages: info.messages.map(x => `${x.type} @${x.lineNum}:${x.linePos} ${x.message}`).slice(0, 6) });
  }
  return out;
});
console.log(JSON.stringify(msgs, null, 2));
await browser.close();
