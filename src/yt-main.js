// 仅 YouTube：运行在页面主世界，把「当前视频是否提供 HDR」写进 DOM 属性，
// 供隔离世界的内容脚本读取（两个世界共享 DOM，但不共享 JS 全局）。
(() => {
  "use strict";
  const looksHdr = (f) => {
    if (!f) return false;
    const ci = f.colorInfo || {};
    const prim = String(ci.primaries || "").toUpperCase();
    if (prim.includes("2020")) return true;
    const trc = String(ci.transferCharacteristics || "").toUpperCase();
    if (trc.includes("2084") || trc.includes("B67") || trc.includes("HLG")) return true;
    if (/hdr|dolby/i.test(f.qualityLabel || "")) return true;
    return false;
  };

  const write = (on) => {
    const next = on ? "1" : "0";
    if (document.documentElement.dataset.metalhdrYtHdr !== next) {
      document.documentElement.dataset.metalhdrYtHdr = next;
    }
  };

  const check = () => {
    try {
      const p = document.querySelector("#movie_player");
      const resp =
        (p && typeof p.getPlayerResponse === "function" ? p.getPlayerResponse() : null) ||
        globalThis.ytInitialPlayerResponse ||
        null;
      const fmts = resp?.streamingData?.adaptiveFormats || [];
      if (!fmts.length) return; // 还没拿到，别乱写
      write(fmts.some(looksHdr));
    } catch {
      /* 忽略 */
    }
  };

  check();
  setInterval(check, 1500);
  document.addEventListener("yt-navigate-finish", check, true);
})();
