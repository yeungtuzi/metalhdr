import { chromium } from "playwright-core";
const ctx = await chromium.launchPersistentContext("/tmp/ytp-" + Date.now(), {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false, ignoreDefaultArgs: ["--force-color-profile=srgb"],
  args: ["--no-first-run", "--autoplay-policy=no-user-gesture-required"],
  viewport: { width: 1440, height: 900 }
});
const page = await ctx.newPage();
await page.goto("https://www.youtube.com/watch?v=LXb3EKWsInQ", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
await page.evaluate(async () => { const v = document.querySelector("video"); if (v) { v.muted = true; await v.play().catch(() => {}); } });
await page.waitForTimeout(4000);
const r = await page.evaluate(() => {
  const p = document.querySelector("#movie_player");
  const out = { hasPlayer: !!p, api: typeof p?.getPlayerResponse, hasInit: !!window.ytInitialPlayerResponse };
  try {
    const resp = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const fmts = resp?.streamingData?.adaptiveFormats || [];
    out.n = fmts.length;
    out.labels = [...new Set(fmts.map((f) => f.qualityLabel).filter(Boolean))].slice(0, 10);
    out.withColor = fmts.filter((f) => f.colorInfo).length;
    out.colorSample = fmts.filter((f) => f.colorInfo).slice(0, 3).map((f) => ({ q: f.qualityLabel, ci: f.colorInfo }));
  } catch (e) { out.err = e.message; }
  out.stats = (() => { try { return String(p?.getVideoStats?.() || "").slice(0, 300); } catch { return ""; } })();
  return out;
});
console.log(JSON.stringify(r, null, 1));
await ctx.close();
