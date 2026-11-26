// MetalHDR · site — 站点适配、DRM 保护与 HDR 片源识别
(() => {
  "use strict";

  const NS = (globalThis.MetalHDR = globalThis.MetalHDR || {});

  // 这些站点的正片基本走 DRM，读不到帧；直接跳过，不尝试、不提示
  const PROTECTED_HOSTS = [
    "netflix.com",
    "disneyplus.com",
    "primevideo.com",
    "amazon.com",
    "tv.apple.com",
    "max.com",
    "hbomax.com",
    "hulu.com",
    "peacocktv.com",
    "paramountplus.com",
    "crunchyroll.com",
    "mubi.com",
    "bilibili.com",       // 仅番剧/影视会带 mediaKeys，普通投稿不受影响
    "iqiyi.com",
    "v.qq.com",
    "youku.com",
    "mgtv.com",
    "douyin.com",
    "tiktok.com"
  ];

  const hostMatches = (host, domain) => host === domain || host.endsWith("." + domain);

  const siteId = () => {
    const h = location.hostname;
    if (hostMatches(h, "bilibili.com")) return "bilibili";
    if (hostMatches(h, "youtube.com") || h === "youtu.be") return "youtube";
    if (PROTECTED_HOSTS.some((d) => hostMatches(h, d))) return "drm";
    return "generic";
  };

  const visibleArea = (v) => {
    const r = v.getBoundingClientRect();
    if (r.width < 160 || r.height < 90) return 0;
    if (r.bottom <= 0 || r.right <= 0) return 0;
    if (r.top >= innerHeight || r.left >= innerWidth) return 0;
    const st = getComputedStyle(v);
    if (st.display === "none" || st.visibility === "hidden") return 0;
    return r.width * r.height;
  };

  const findVideo = () => {
    const all = [...document.querySelectorAll("video")];
    return all
      .map((v) => ({ v, a: visibleArea(v) }))
      .filter((e) => e.a > 0)
      .sort((x, y) => y.a - x.a)[0]?.v || null;
  };

  const biliQualityText = () => {
    const el =
      document.querySelector(".bpx-player-ctrl-quality-result") ||
      document.querySelector(".bpx-player-ctrl-quality-menu-item.bpx-state-active");
    return (el?.textContent || "").trim();
  };

  const biliHdrAvailable = () => {
    const items = [...document.querySelectorAll(".bpx-player-ctrl-quality-menu-item")];
    return items.some((e) => /HDR|杜比|Dolby/i.test(e.textContent || ""));
  };

  // YouTube 的 adaptiveFormats 里判断是否 HDR：BT.2020 或 PQ/HLG 传递函数，或标签里带 HDR
  const formatLooksHdr = (fmt) => {
    if (!fmt) return false;
    const ci = fmt.colorInfo || {};
    // YouTube 给的是枚举全名：COLOR_PRIMARIES_BT2020 / COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084
    const prim = String(ci.primaries || "").toUpperCase();
    if (prim.includes("2020")) return true;
    const trc = String(ci.transferCharacteristics || "").toUpperCase();
    if (trc.includes("2084") || trc.includes("B67") || trc.includes("HLG")) return true;
    if (/hdr|dolby/i.test(fmt.qualityLabel || "")) return true;
    return false;
  };

  const ytHdr = () => {
    // 扩展版：MAIN world 小脚本把结论写在 DOM 属性上，这里直接读
    const tag = document.documentElement.dataset.metalhdrYtHdr;
    if (tag === "1") return true;
    if (tag === "0") return false;
    // 油猴版：脚本本来就在主世界，可以直接读页面数据
    try {
      const init = globalThis.ytInitialPlayerResponse;
      const fmts = init?.streamingData?.adaptiveFormats || [];
      if (fmts.length) return fmts.some(formatLooksHdr);
    } catch {
      /* 忽略 */
    }
    try {
      const player = document.querySelector("#movie_player");
      const resp = player?.getPlayerResponse?.();
      const formats = resp?.streamingData?.adaptiveFormats || [];
      if (formats.some(formatLooksHdr)) return true;
    } catch {
      /* player 未就绪 */
    }
    // 兜底：画质菜单里当前选中项带 HDR
    const active = document.querySelector(".ytp-quality-menu .ytp-menuitem[aria-checked='true']");
    if (active && /hdr|dolby/i.test(active.textContent || "")) return true;
    return false;
  };

  // 片源是否已经是 HDR / 杜比 —— 是就不要再抬一次
  const isHdrSource = (video) => {
    const site = siteId();
    if (site === "bilibili") {
      if (/HDR|杜比|Dolby/i.test(biliQualityText())) return true;
    }
    if (site === "youtube") {
      if (ytHdr()) return true;
    }

    const src = String(video.currentSrc || video.src || "").toLowerCase();
    if (/\b(hdr|hlg|pq|dolby|dovi)\b/.test(src)) return true;

    const q = video.getVideoPlaybackQuality?.();
    if (q?.hdrMetadataType) return true;

    return false;
  };

  const isProtected = (video) => {
    if (video.mediaKeys) return true;
    return siteId() === "drm";
  };

  const describe = () => ({
    site: siteId(),
    qualityLabel: siteId() === "bilibili" ? biliQualityText() : "",
    hdrAvailable: siteId() === "bilibili" ? biliHdrAvailable() : false
  });

  NS.site = {
    siteId,
    findVideo,
    isHdrSource,
    isProtected,
    describe,
    biliQualityText,
    biliHdrAvailable,
    formatLooksHdr,
    ytHdr
  };
})();
