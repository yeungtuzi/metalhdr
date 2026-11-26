// MetalHDR · core — settings, tone mapping parameters, storage
(() => {
  "use strict";

  const NS = (globalThis.MetalHDR = globalThis.MetalHDR || {});
  const MH = NS;

  // macOS EDR 1.0 == SDR 参考白 ≈ 100 cd/m²
  const SDR_WHITE_NITS = 100;
  const MIN_PEAK = 80;
  const MAX_PEAK = 4000;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    quality: "high",        // high = headroom 多 pass；low = hdr lift 单 pass
    peakMode: "auto",       // auto = 读系统；manual = 手填
    peakNits: 1000,         // 手动值 / 自动读不到时的兜底
    strength: 0.62,         // 提亮强度
    reach: 0.52,            // 向下覆盖到多暗
    shaping: 0.5,           // 大面积高光收敛
    saturation: 0.16,
    sharpen: 0.22,
    deband: 0.6,
    protect: 0.7,           // 肤色保护
    autoEnableSites: true,
    zeroCopy: false,      // 零拷贝在 Safari 上会黑屏（仅 Chromium 可用），默认关
    shortcut: "Alt+H",
    debug: false
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const normalize = (s = {}) => ({
    ...DEFAULT_SETTINGS,
    ...s,
    enabled: Boolean(s.enabled ?? DEFAULT_SETTINGS.enabled),
    quality: s.quality === "low" ? "low" : "high",
    peakMode: s.peakMode === "manual" ? "manual" : "auto",
    peakNits: clamp(num(s.peakNits, DEFAULT_SETTINGS.peakNits), MIN_PEAK, MAX_PEAK),
    strength: clamp(num(s.strength, DEFAULT_SETTINGS.strength), 0, 1),
    reach: clamp(num(s.reach, DEFAULT_SETTINGS.reach), 0.05, 0.98),
    shaping: clamp(num(s.shaping, DEFAULT_SETTINGS.shaping), 0, 1),
    saturation: clamp(num(s.saturation, DEFAULT_SETTINGS.saturation), -0.2, 0.6),
    sharpen: clamp(num(s.sharpen, DEFAULT_SETTINGS.sharpen), 0, 1),
    deband: clamp(num(s.deband, DEFAULT_SETTINGS.deband), 0, 1),
    protect: clamp(num(s.protect, DEFAULT_SETTINGS.protect), 0, 1),
    zeroCopy: Boolean(s.zeroCopy ?? DEFAULT_SETTINGS.zeroCopy),
    shortcut: String(s.shortcut ?? DEFAULT_SETTINGS.shortcut).trim(),
    debug: Boolean(s.debug ?? DEFAULT_SETTINGS.debug)
  });

  // 渲染器用的一组标量；peak 以「SDR 白的倍数」表示
  const resolveTone = (settings, effectivePeakNits) => {
    const s = normalize(settings);
    const nits = clamp(num(effectivePeakNits, s.peakNits), MIN_PEAK, MAX_PEAK);
    return {
      peak: Math.max(1.0, nits / SDR_WHITE_NITS),
      strength: s.strength,
      reach: s.reach,
      shaping: s.shaping,
      saturation: s.saturation,
      sharpen: s.sharpen,
      deband: s.deband,
      protect: s.protect,
      exposure: 1.22,
      quality: s.quality === "high" ? 1 : 0,
      nits
    };
  };

  const KEYS = ["metalhdr:settings"];

  const gmAvailable = () =>
    typeof GM_getValue === "function" && typeof GM_setValue === "function";

  const load = () => {
    try {
      if (gmAvailable()) {
        const raw = GM_getValue("settings", null);
        if (raw) return normalize(typeof raw === "string" ? JSON.parse(raw) : raw);
      }
      const raw = localStorage.getItem("metalhdr:settings");
      return raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };

  const save = (settings) => {
    const s = normalize(settings);
    try {
      if (gmAvailable()) GM_setValue("settings", JSON.stringify(s));
      else localStorage.setItem("metalhdr:settings", JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
    return s;
  };

  const shortcutMatches = (event, shortcut) => {
    if (!shortcut) return false;
    const parts = shortcut.split("+").map((p) => p.trim()).filter(Boolean);
    const key = parts[parts.length - 1];
    const wantAlt = parts.includes("Alt");
    const wantShift = parts.includes("Shift");
    const wantCtrl = parts.includes("Ctrl");
    const wantMeta = parts.includes("Meta");
    const eventKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const want = key.length === 1 ? key.toUpperCase() : key;
    // macOS 上 Option+H 会变成特殊字符（˙），必须按物理键位匹配
    const byCode =
      /^[A-Z]$/.test(want) ? event.code === "Key" + want
      : /^[0-9]$/.test(want) ? event.code === "Digit" + want
      : want === "Space" ? event.code === "Space"
      : false;
    return (
      (eventKey === want || byCode) &&
      event.altKey === wantAlt &&
      event.shiftKey === wantShift &&
      event.ctrlKey === wantCtrl &&
      event.metaKey === wantMeta
    );
  };

  MH.core = {
    SDR_WHITE_NITS,
    MIN_PEAK,
    MAX_PEAK,
    DEFAULT_SETTINGS,
    clamp,
    num,
    smoothstep,
    normalize,
    resolveTone,
    load,
    save,
    shortcutMatches
  };
})();
