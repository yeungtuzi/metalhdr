// MetalHDR · controller — 覆盖层、取帧循环、亮度上限、状态
(() => {
  "use strict";

  const NS = (globalThis.MetalHDR = globalThis.MetalHDR || {});
  const { load, save, normalize, resolveTone, clamp, shortcutMatches } = NS.core;
  const { findVideo, isHdrSource, isProtected, describe } = NS.site;

  const METER_URL = "http://127.0.0.1:8765/headroom";
  const RESCAN_MS = 1500;

  const state = {
    settings: load(),
    hdrSkip: null,
    controller: null,
    headroom: null,        // { nits, screen, potential, source }
    headroomAt: 0,
    lastRescan: 0
  };

  const log = (...a) => {
    if (state.settings.debug) console.info("[MetalHDR]", ...a);
  };

  // ── 亮度上限：原生守护进程 → 自动；失败 → 手动/兜底 ─────────────────
  const fetchHeadroom = () =>
    new Promise((resolve) => {
      const done = (v) => resolve(v);
      const rt = globalThis.chrome?.runtime || globalThis.browser?.runtime;
      try {
        if (rt?.sendMessage) {
          rt.sendMessage({ type: "metalhdr:headroom" }, (resp) => {
            if (rt.lastError) return done(null);
            done(resp && resp.ok ? resp : null);
          });
          return;
        }
        if (typeof GM_xmlhttpRequest === "function") {
          GM_xmlhttpRequest({
            method: "GET",
            url: METER_URL,
            timeout: 1500,
            onload: (r) => {
              try {
                const j = JSON.parse(r.responseText);
                done(j && j.ok ? j : null);
              } catch {
                done(null);
              }
            },
            onerror: () => done(null),
            ontimeout: () => done(null)
          });
          return;
        }
        fetch(METER_URL, { mode: "cors", cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => done(j && j.ok ? j : null))
          .catch(() => done(null));
      } catch {
        done(null);
      }
    });

  const refreshHeadroom = async (force = false) => {
    if (!force && performance.now() - state.headroomAt < 8000) return state.headroom;
    state.headroomAt = performance.now();
    const data = await fetchHeadroom();
    if (data) {
      state.headroom = {
        nits: clamp(Math.round((data.peakNits || 0) * 0.95), 80, 4000),
        rawNits: data.peakNits,
        screen: data.screen || "",
        potential: data.potential || 0,
        source: "system"
      };
    } else if (!state.headroom) {
      state.headroom = null;
    }
    NS.ui?.sync();
    return state.headroom;
  };

  const effectivePeak = () => {
    const s = state.settings;
    if (s.peakMode === "auto" && state.headroom) return state.headroom.nits;
    return s.peakNits;
  };

  const peakSource = () => {
    const s = state.settings;
    if (s.peakMode === "auto") return state.headroom ? "system" : "fallback";
    return "manual";
  };

  // ── 单个 video 的控制器 ───────────────────────────────────────────
  class VideoController {
    constructor(video) {
      this.video = video;
      this.canvas = null;
      this.parent = null;
      this.renderer = null;
      this.active = false;
      this.stopped = false;
      this.cbId = null;
      this.rafId = null;
      this.frames = 0;
      this.lastFpsAt = performance.now();
      this.fps = 0;
      this.cost = 16;
      this.scale = 1;
      this.boxAt = 0;
      this.prev = { opacity: "", position: "", zIndex: "", parentPosition: "" };
      this.ro = null;
      this.skipReason = "";
      this.passthrough = false;
    }

    async start() {
      if (this.stopped) return;
      this.prev.opacity = this.video.style.opacity;
      this.prev.position = this.video.style.position;
      this.prev.zIndex = this.video.style.zIndex;

      if (isProtected(this.video)) {
        // 已知限制：DRM 视频读不到帧，直接跳过（不打扰用户）
        this.skipReason = "protected";
        return;
      }
      if (isHdrSource(this.video)) {
        this.skipReason = "already-hdr";
        this.passthrough = true;
        this.announce("片源已是 HDR，保持原样");
        return;
      }

      const { GpuRenderer, GlRenderer } = NS.renderers;
      const order = [GpuRenderer, GlRenderer];
      for (const R of order) {
        if (!R.isSupported()) continue;
        try {
          this.canvas = this.makeCanvas();
          const r = new R(this.canvas);
          await r.init(state.settings.quality, { zeroCopy: state.settings.zeroCopy });
          r.updateSettings(resolveTone(state.settings, effectivePeak()));
          this.renderer = r;
          break;
        } catch (e) {
          log("renderer failed", e);
          this.canvas?.remove();
          this.canvas = null;
        }
      }

      if (!this.renderer) {
        this.skipReason = "no-renderer";
        this.announce("当前浏览器没有可用的 WebGPU/WebGL2");
        return;
      }

      this.active = true;
      this.installCanvas();
      this.bindMedia();
      this.syncBox(true);
      if (!this.video.paused) this.loop();
      // 视频可能在我们注册回调之前就已经在播放，rVFC 不再回调 → 保活兜底
      this.keepAlive = setInterval(() => {
        if (this.stopped || !this.active || this.video.paused || document.hidden) return;
        if (performance.now() - (this.lastFrameAt || 0) > 1500) this.restartLoop();
      }, 1000);
      NS.ui?.sync();
    }

    makeCanvas() {
      const c = document.createElement("canvas");
      c.className = "metalhdr-canvas";
      c.style.cssText = "position:absolute;pointer-events:none;z-index:2";
      return c;
    }

    installCanvas() {
      const parent = this.video.parentElement || document.body;
      this.parent = parent;
      this.prev.parentPosition = parent.style.position;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      this.canvas.dataset.metalhdr = "1";
      parent.appendChild(this.canvas);
      this.ro = new ResizeObserver(() => this.syncBox(true));
      this.ro.observe(this.video);
      window.addEventListener("fullscreenchange", this.onViewportBound, true);
      window.addEventListener("resize", this.onViewportBound, true);
    }

    syncBox(force = false) {
      if (!this.canvas || !this.parent || !this.video.isConnected) return;
      if (!force && performance.now() - this.boxAt < 400) return;
      this.boxAt = performance.now();

      const vr = this.video.getBoundingClientRect();
      const pr = this.parent.getBoundingClientRect();
      const sw = this.video.videoWidth || 1;
      const sh = this.video.videoHeight || 1;

      // 容器可能被 transform: scale() 缩放（全屏/剧场常见），rect 是变换后的值，
      // 换回父级局部坐标时要除回缩放比，否则 canvas 会偏移或尺寸不对。
      const sx = this.parent.offsetWidth ? pr.width / this.parent.offsetWidth : 1;
      const sy = this.parent.offsetHeight ? pr.height / this.parent.offsetHeight : 1;

      this.canvas.style.left = `${(vr.left - pr.left) / (sx || 1) + this.parent.scrollLeft}px`;
      this.canvas.style.top = `${(vr.top - pr.top) / (sy || 1) + this.parent.scrollTop}px`;
      this.canvas.style.width = `${vr.width / (sx || 1)}px`;
      this.canvas.style.height = `${vr.height / (sy || 1)}px`;

      const rw = Math.max(2, Math.round(sw * this.scale));
      const rh = Math.max(2, Math.round(sh * this.scale));
      if (this.canvas.width !== rw || this.canvas.height !== rh) {
        this.canvas.width = rw;
        this.canvas.height = rh;
        this.renderer?.resize?.(rw, rh);
        this.renderer?.updateSettings(resolveTone(state.settings, effectivePeak()));
      }
    }

    onViewportBound = () => this.syncBox(true);

    bindMedia() {
      if (this.mediaBound) return;
      this.mediaBound = true;
      this.onPlay = () => {
        this.schedule();
        this.loop();
      };
      this.onPause = () => {
        // 暂停时画一帧定格，避免黑屏
        if (!document.hidden) this.frame();
      };
      this.onSeek = () => {
        this.frame();
        this.schedule();
      };
      this.onVis = () => {
        if (!document.hidden) {
          this.schedule();
          this.loop();
        }
      };
      this.video.addEventListener("play", this.onPlay);
      this.video.addEventListener("playing", this.onPlay);
      this.video.addEventListener("pause", this.onPause);
      this.video.addEventListener("seeked", this.onSeek);
      this.video.addEventListener("loadeddata", this.onSeek);
      this.video.addEventListener("canplay", this.onPlay);
      document.addEventListener("visibilitychange", this.onVis);
    }

    unbindMedia() {
      if (!this.mediaBound) return;
      this.mediaBound = false;
      this.video.removeEventListener("play", this.onPlay);
      this.video.removeEventListener("playing", this.onPlay);
      this.video.removeEventListener("pause", this.onPause);
      this.video.removeEventListener("seeked", this.onSeek);
      this.video.removeEventListener("loadeddata", this.onSeek);
      this.video.removeEventListener("canplay", this.onPlay);
      document.removeEventListener("visibilitychange", this.onVis);
    }

    // 只有真正画出第一帧后才隐藏原视频，期间用户不会看到黑屏
    reveal() {
      if (this.hidVideo) return;
      this.hidVideo = true;
      this.video.style.opacity = "0";
    }

    loop = () => {
      if (this.stopped || !this.active) return;
      const step = (now, meta) => {
        this.cbId = null;
        this.rafId = null;
        if (this.stopped || !this.active) return;
        this.frame(meta);
        this.schedule();
      };
      if ("requestVideoFrameCallback" in this.video) {
        this.cbId = this.video.requestVideoFrameCallback(step);
      } else {
        this.rafId = requestAnimationFrame(step);
      }
    };

    schedule() {
      if (this.stopped || !this.active || document.hidden || this.video.paused) return;
      if (this.cbId !== null || this.rafId !== null) return;
      this.loop();
    }

    frame(meta) {
      if (!this.renderer || !this.active || document.hidden) return;
      // Safari 的 rVFC 可能按屏幕刷新率回调；同一帧不再重复渲染
      if (meta && typeof meta.presentedFrames === "number") {
        if (meta.presentedFrames === this.lastPresented) return;
        this.lastPresented = meta.presentedFrames;
      }
      if (this.video.readyState < 2 || !this.video.videoWidth) return;
      this.syncBox();
      const t0 = performance.now();
      try {
        this.renderer.render(this.video);
        this.reveal();
      } catch (e) {
        log("render error", e);
        this.fail();
        return;
      }
      const dt = performance.now() - t0;
      this.cost = this.cost * 0.9 + dt * 0.1;
      this.governor();

      this.frames++;
      this.lastFrameAt = performance.now();
      const now = performance.now();
      if (now - this.lastFpsAt >= 1000) {
        this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsAt));
        this.frames = 0;
        this.lastFpsAt = now;
        // 供排查/自动化读取的状态快照
        try {
          document.documentElement.dataset.metalhdr = JSON.stringify({
            active: this.active, renderer: this.renderer?.name || "",
            vw: this.video.videoWidth, vh: this.video.videoHeight,
            connected: this.video.isConnected, paused: this.video.paused,
            rs: this.video.readyState, fps: this.fps, scale: this.scale, zc: Boolean(this.renderer?.useExt),
            cost: Math.round(this.cost * 10) / 10,
            hid: !!this.hidVideo, videos: document.querySelectorAll("video").length
          });
        } catch { /* ignore */ }
        // 看门狗：在播放却一帧都画不出来时，先还回原视频，再尝试重启循环，最后彻底退出
        if (this.fps === 0 && !this.video.paused) this.stalls = (this.stalls || 0) + 1;
        else this.stalls = 0;
        if (this.stalls === 2) {
          this.hidVideo = false;
          this.video.style.opacity = this.prev.opacity || "";
        }
        if (this.stalls === 3) this.restartLoop();
        if (this.stalls >= 6) {
          this.active = false;
          this.destroy();
          return;
        }
        NS.ui?.tick();
      }
    }

    restartLoop() {
      if (this.cbId !== null && "cancelVideoFrameCallback" in this.video) {
        this.video.cancelVideoFrameCallback(this.cbId);
      }
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.cbId = null;
      this.rafId = null;
      this.loop();
    }

    // 性能调节：只降渲染分辨率，不动 CSS 尺寸
    governor() {
      if (this.cost > 22 && this.scale > 0.5) {
        this.scale = 0.5;
        this.syncBox(true);
      } else if (this.cost > 14 && this.scale > 0.75) {
        this.scale = 0.75;
        this.syncBox(true);
      } else if (this.cost < 6 && this.scale < 1) {
        this.scale = 1;
        this.syncBox(true);
      }
    }

    fail() {
      this.active = false;
      this.destroy();
    }

    announce(text) {
      this.skipReason && NS.ui?.notice(text);
    }

    getStatus() {
      return {
        active: this.active,
        renderer: this.renderer?.name || "none",
        quality: state.settings.quality,
        skipReason: this.skipReason,
        fps: this.fps,
        sourceW: this.video.videoWidth || 0,
        sourceH: this.video.videoHeight || 0,
        scale: this.scale,
        zeroCopy: Boolean(this.renderer?.useExt),
        cost: Math.round(this.cost * 10) / 10
      };
    }

    destroy() {
      this.stopped = true;
      this.active = false;
      if (this.cbId !== null && "cancelVideoFrameCallback" in this.video) {
        this.video.cancelVideoFrameCallback(this.cbId);
      }
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.ro?.disconnect();
      clearInterval(this.keepAlive);
      this.keepAlive = null;
      this.unbindMedia();
      window.removeEventListener("fullscreenchange", this.onViewportBound, true);
      window.removeEventListener("resize", this.onViewportBound, true);
      this.renderer?.destroy?.();
      this.renderer = null;
      this.canvas?.remove();
      this.canvas = null;
      this.video.style.opacity = this.prev.opacity || "";
      if (this.parent) this.parent.style.position = this.prev.parentPosition;
      NS.ui?.sync();
    }
  }

  // ── 扫描与生命周期 ────────────────────────────────────────────────
  const videoIsFullscreen = () => document.fullscreenElement?.tagName === "VIDEO";

  const rescan = () => {
    if (videoIsFullscreen()) {
      // 全屏树里只有 <video>，兄弟节点不会渲染 —— 只能暂时交还原视频
      if (state.controller) {
        state.controller.destroy();
        state.controller = null;
        NS.ui?.notice("该站点全屏的是 <video> 本身，全屏期间暂停增强");
      }
      return;
    }
    if (!state.settings.enabled) {
      state.controller?.destroy();
      state.controller = null;
      return;
    }
    const v = findVideo();
    if (!v) {
      state.controller?.destroy();
      state.controller = null;
      return;
    }
    // 播放中切到 HDR 画质：让路，直到片源回到 SDR
    if (state.hdrSkip === v) {
      if (isHdrSource(v)) return;
      state.hdrSkip = null;
    }

    if (state.controller?.video === v && v.isConnected) {
      if (isHdrSource(v)) {
        state.controller.destroy();
        state.controller = null;
        state.hdrSkip = v;
        NS.ui?.notice("片源切换到 HDR，已暂停增强");
      }
      return;
    }

    state.controller?.destroy();
    state.controller = new VideoController(v);
    state.controller.start();
  };

  const applySettings = async (next) => {
    const prev = state.settings;
    state.settings = save(normalize(next));
    if (prev.zeroCopy !== state.settings.zeroCopy) {
      state.controller?.destroy();
      state.controller = null;
      rescan();
      NS.ui?.sync();
      return;
    }
    NS.ui?.sync();
    if (!state.settings.enabled) {
      state.controller?.destroy();
      state.controller = null;
      return;
    }
    if (state.controller?.active) {
      state.controller.renderer?.setQuality?.(state.settings.quality);
      state.controller.renderer?.updateSettings(resolveTone(state.settings, effectivePeak()));
      state.controller.syncBox(true);
    } else {
      rescan();
    }
  };

  const onKey = (e) => {
    if (e.repeat) return;
    const t = e.target;
    if (t instanceof Element && t.closest("input,textarea,select,[contenteditable]")) return;
    if (shortcutMatches(e, state.settings.shortcut)) {
      e.preventDefault();
      e.stopPropagation();
      NS.ui?.toggle();
    }
  };

  const boot = async () => {
    // 扩展 build：工具栏图标 / 快捷键消息
    try {
      globalThis.chrome?.runtime?.onMessage?.addListener((msg) => {
        if (msg?.type === "metalhdr:toggle") NS.ui?.toggle();
      });
      globalThis.browser?.runtime?.onMessage?.addListener((msg) => {
        if (msg?.type === "metalhdr:toggle") NS.ui?.toggle();
      });
    } catch {
      /* userscript 环境没有 runtime */
    }

    NS.ui?.mount({
      getSettings: () => state.settings,
      setSettings: (s) => applySettings(s),
      getStatus: () => ({
        ...(state.controller?.getStatus() || { active: false }),
        site: describe(),
        headroom: {
          nits: effectivePeak(),
          source: peakSource(),
          screen: state.headroom?.screen || "",
          raw: state.headroom?.rawNits || 0
        }
      }),
      refreshHeadroom: () => refreshHeadroom(true)
    });

    await refreshHeadroom(true);
    rescan();

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", rescan, { passive: true });
    window.addEventListener("fullscreenchange", () => {
      state.controller?.syncBox?.(true);
      rescan();
    }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshHeadroom();
        rescan();
      }
    });
    setInterval(rescan, RESCAN_MS);
    setInterval(() => refreshHeadroom(), 10000);
    new MutationObserver(() => {
      window.requestIdleCallback?.(rescan, { timeout: 600 }) || setTimeout(rescan, 200);
    }).observe(document.documentElement, { childList: true, subtree: true });
  };

  NS.app = { boot, state, effectivePeak, setSettings: applySettings };
  boot();
})();
