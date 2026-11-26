// MetalHDR · site — 站点适配与片源判定
(() => {
  "use strict";

  const NS = (globalThis.MetalHDR = globalThis.MetalHDR || {});

  const siteId = () => {
    const h = location.hostname;
    if (h.endsWith("bilibili.com")) return "bilibili";
    if (h.endsWith("youtube.com")) return "youtube";
    if (h.endsWith("netflix.com") || h.endsWith("disneyplus.com") || h.endsWith("primevideo.com")) return "drm";
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
    const sel = siteId() === "bilibili"
      ? ".bpx-player-video-wrap video, .bpx-player-container video, video"
      : "video";
    const all = [...document.querySelectorAll(sel)];
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

  // 片源是否已经是 HDR / 杜比 —— 是就不要再抬一次
  const isHdrSource = (video) => {
    const label = siteId() === "bilibili" ? biliQualityText() : "";
    if (/HDR|杜比|Dolby/i.test(label)) return true;

    const src = String(video.currentSrc || video.src || "").toLowerCase();
    if (/\b(hdr|hlg|pq|dolby|dovi)\b/.test(src)) return true;

    const q = video.getVideoPlaybackQuality?.();
    if (q?.hdrMetadataType) return true;

    return false;
  };

  const isProtected = (video) => {
    if (video.mediaKeys) return true;
    if (siteId() === "drm") return true;
    return false;
  };

  const describe = () => ({
    site: siteId(),
    qualityLabel: siteId() === "bilibili" ? biliQualityText() : "",
    hdrAvailable: siteId() === "bilibili" ? biliHdrAvailable() : false
  });

  NS.site = { siteId, findVideo, isHdrSource, isProtected, describe, biliQualityText, biliHdrAvailable };
})();
