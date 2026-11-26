#!/usr/bin/env node
// 一次源码 → 两个 build：油猴脚本 + WebExtension（Safari 转换用）
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const DIST = join(ROOT, "dist");
const SRC = ["00-core.js", "10-shaders.js", "20-renderers.js", "30-site.js", "40-ui.js", "50-content.js"];

const bundle = SRC.map((f) => `// ── ${f} ──\n` + readFileSync(join(ROOT, "src", f), "utf8")).join("\n");

const HEADER = `// ==UserScript==
// @name         MetalHDR
// @name:zh-CN   MetalHDR · SDR 转 HDR
// @namespace    https://github.com/metalhdr/metalhdr
// @version      ${pkg.version}
// @description  把网页里的 SDR 视频实时转成 HDR（EDR）：自动读取屏幕亮度上限，软肩滚降不裁切。
// @description:zh-CN  网页 SDR 视频实时转 HDR：自动读屏幕亮度上限，软肩滚降不裁切。
// @author       metalhdr
// @license      GPL-3.0-or-later
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==
`;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1) 油猴脚本
const userjs = HEADER + "\n" + bundle;
writeFileSync(join(DIST, "metalhdr.user.js"), userjs);

// 2) 扩展
const EXT = join(DIST, "metalhdr-extension");
mkdirSync(EXT, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ROOT, "extension", "manifest.json"), "utf8"));
manifest.version = pkg.version;
manifest.description = "网页 SDR 视频实时转 HDR：自动读屏幕亮度上限，软肩滚降不裁切。";
manifest.permissions = ["storage"];
manifest.host_permissions = ["*://*/*", "http://127.0.0.1:8765/*"];
manifest.background = { service_worker: "background.js" };
manifest.content_scripts = [
  { matches: ["*://*/*"], js: ["metalhdr.js"], all_frames: true, run_at: "document_idle" }
];
writeFileSync(join(EXT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(EXT, "metalhdr.js"), bundle);
writeFileSync(
  join(EXT, "background.js"),
  `// 工具栏图标 → 切换面板；同时代理本地亮度守护进程（扩展上下文不受页面混合内容限制）
const api = globalThis.browser || globalThis.chrome;
const METER = "http://127.0.0.1:8765/headroom";

api.action.onClicked.addListener((tab) => {
  if (tab?.id) api.tabs.sendMessage(tab.id, { type: "metalhdr:toggle" }).catch(() => {});
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "metalhdr:headroom") return false;
  fetch(METER, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => sendResponse(j || null))
    .catch(() => sendResponse(null));
  return true;
});\n`
);
cpSync(join(ROOT, "extension", "icons"), join(EXT, "icons"), { recursive: true });

// 3) 打包
const zip = (src, out) => {
  try {
    execFileSync("zip", ["-qr", out, "."], { cwd: src });
    return true;
  } catch {
    return false;
  }
};
zip(EXT, join(DIST, `metalhdr-extension-${pkg.version}.zip`));

const kb = (p) => (existsSync(p) ? `${(readFileSync(p).length / 1024).toFixed(1)} KB` : "—");
console.log("dist/metalhdr.user.js          ", kb(join(DIST, "metalhdr.user.js")));
console.log("dist/metalhdr-extension/        ", kb(join(EXT, "metalhdr.js")));
console.log("dist/metalhdr-extension-*.zip   ", kb(join(DIST, `metalhdr-extension-${pkg.version}.zip`)));
