// MetalHDR · ui — 页面内设置面板（Shadow DOM 隔离）
(() => {
  "use strict";

  const NS = (globalThis.MetalHDR = globalThis.MetalHDR || {});
  const { normalize, clamp, MIN_PEAK, MAX_PEAK } = NS.core;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; }
.pill {
  position: fixed; right: 14px; bottom: 74px; z-index: 2147483000;
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  border-radius: 999px; background: rgba(16,16,18,.82); color: #e8e8ea;
  font-size: 11px; font-weight: 600; letter-spacing: .04em; cursor: pointer;
  border: 1px solid rgba(255,255,255,.14); backdrop-filter: blur(12px);
  box-shadow: 0 4px 18px rgba(0,0,0,.35); user-select: none;
}
.pill:hover { background: rgba(30,30,34,.9); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #3ddc97; }
.dot.off { background: #8a8a8f; }
.dot.warn { background: #ffb020; }
.panel {
  position: fixed; right: 14px; bottom: 116px; width: 296px; z-index: 2147483000;
  background: rgba(18,18,20,.94); color: #e8e8ea; border-radius: 14px;
  border: 1px solid rgba(255,255,255,.13); backdrop-filter: blur(18px);
  box-shadow: 0 18px 50px rgba(0,0,0,.5); padding: 14px; display: none;
  font-size: 12px;
}
.panel.open { display: block; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.title { font-size: 13px; font-weight: 700; letter-spacing: .02em; }
.close { cursor: pointer; color: #9a9aa0; font-size: 16px; line-height: 1; padding: 2px 4px; }
.close:hover { color: #fff; }
.row { margin: 9px 0; }
.lbl { display: flex; justify-content: space-between; color: #a9a9b0; margin-bottom: 5px; font-size: 11px; }
.lbl b { color: #e8e8ea; font-weight: 600; }
.seg { display: flex; gap: 4px; background: rgba(255,255,255,.06); padding: 3px; border-radius: 9px; }
.seg button {
  flex: 1; border: 0; background: transparent; color: #b6b6bd; padding: 6px 8px;
  border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer;
}
.seg button.on { background: rgba(255,255,255,.16); color: #fff; }
input[type=range] { width: 100%; accent-color: #7cc4ff; height: 18px; }
input[type=number] {
  width: 76px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
  color: #e8e8ea; border-radius: 7px; padding: 4px 6px; font-size: 11px;
}
.auto { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  background: rgba(255,255,255,.05); border-radius: 8px; padding: 7px 9px; color: #b6b6bd; font-size: 11px; }
.auto b { color: #e8e8ea; }
.mini { border: 0; background: rgba(255,255,255,.12); color: #e8e8ea; border-radius: 6px;
  padding: 4px 7px; font-size: 10px; cursor: pointer; }
.mini:hover { background: rgba(255,255,255,.2); }
.status { margin-top: 10px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,.09);
  color: #8f8f96; font-size: 10px; line-height: 1.6; word-break: break-all; }
.status b { color: #c8c8cf; font-weight: 600; }
.hide { display: none !important; }
.toast { position: fixed; right: 14px; bottom: 122px; z-index: 2147483001;
  background: rgba(18,18,20,.95); color: #e8e8ea; border: 1px solid rgba(255,255,255,.14);
  padding: 9px 12px; border-radius: 10px; font-size: 11px; max-width: 280px; }
`;

  let api = null;
  let root = null;
  let els = {};
  let open = false;

  const h = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  const pct = (v) => `${Math.round(v * 100)}%`;

  const mount = (a) => {
    api = a;
    if (root) return;

    const host = document.createElement("div");
    host.id = "metalhdr-root";
    root = host.attachShadow({ mode: "open" });
    root.appendChild(h(`<style>${CSS}</style>`));

    els.pill = h(`<div class="pill" title="MetalHDR"><span class="dot"></span><span>HDR</span></div>`);
    els.panel = h(`
      <div class="panel">
        <div class="head"><span class="title">MetalHDR</span><span class="close">×</span></div>

        <div class="row">
          <div class="seg" data-seg="enabled">
            <button data-v="on">启用</button><button data-v="off">关闭</button>
          </div>
        </div>

        <div class="row">
          <div class="lbl">画质</div>
          <div class="seg" data-seg="quality">
            <button data-v="high">高 · 多 pass</button><button data-v="low">低 · 单 pass</button>
          </div>
        </div>

        <div class="row">
          <div class="lbl">零拷贝 <span style="color:#6b6b73">省一次全帧拷贝</span></div>
          <div class="seg" data-seg="zeroCopy">
            <button data-v="on">开</button><button data-v="off">关</button>
          </div>
        </div>

        <div class="row">
          <div class="lbl">最高亮度</div>
          <div class="seg" data-seg="peakMode">
            <button data-v="auto">自动（系统）</button><button data-v="manual">手动</button>
          </div>
        </div>

        <div class="row" data-auto>
          <div class="auto">
            <span>系统读到 <b data-sysnits>—</b> nits</span>
            <button class="mini" data-refresh>重新读取</button>
          </div>
        </div>

        <div class="row hide" data-manual>
          <div class="lbl">峰值 <b data-peakval>1000</b> nits</div>
          <input type="range" min="500" max="2000" step="10" data-peakrange>
          <div style="display:flex;justify-content:flex-end;margin-top:5px">
            <input type="number" min="${MIN_PEAK}" max="${MAX_PEAK}" step="10" data-peaknum>
          </div>
        </div>

        <div class="row"><div class="lbl">提亮强度 <b data-v-strength></b></div>
          <input type="range" min="0" max="100" data-s="strength"></div>
        <div class="row"><div class="lbl">覆盖范围 <b data-v-reach></b></div>
          <input type="range" min="5" max="98" data-s="reach"></div>
        <div class="row"><div class="lbl">饱和度 <b data-v-saturation></b></div>
          <input type="range" min="-20" max="60" data-s="saturation"></div>
        <div class="row"><div class="lbl">锐化 <b data-v-sharpen></b></div>
          <input type="range" min="0" max="100" data-s="sharpen"></div>
        <div class="row"><div class="lbl">去色带 <b data-v-deband></b></div>
          <input type="range" min="0" max="100" data-s="deband"></div>

        <div class="status" data-status></div>
      </div>`);

    root.append(els.pill, els.panel);
    (document.body || document.documentElement).appendChild(host);

    els.pill.addEventListener("click", () => toggle());
    els.panel.querySelector(".close").addEventListener("click", () => toggle(false));

    els.panel.querySelectorAll(".seg").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-v]");
        if (!btn) return;
        const key = seg.dataset.seg;
        const s = { ...api.getSettings() };
        if (key === "enabled") s.enabled = btn.dataset.v === "on";
        else if (key === "quality") s.quality = btn.dataset.v;
        else if (key === "peakMode") s.peakMode = btn.dataset.v;
        else if (key === "zeroCopy") s.zeroCopy = btn.dataset.v === "on";
        api.setSettings(s);
        if (key === "peakMode" && btn.dataset.v === "auto") api.refreshHeadroom();
        sync();
      });
    });

    els.panel.querySelector("[data-refresh]").addEventListener("click", () => api.refreshHeadroom());

    const range = els.panel.querySelector("[data-peakrange]");
    const numIn = els.panel.querySelector("[data-peaknum]");
    const applyPeak = (v) => {
      const nits = clamp(Math.round(Number(v) || 1000), MIN_PEAK, MAX_PEAK);
      api.setSettings({ ...api.getSettings(), peakMode: "manual", peakNits: nits });
      sync();
    };
    range.addEventListener("input", () => applyPeak(range.value));
    numIn.addEventListener("change", () => applyPeak(numIn.value));

    els.panel.querySelectorAll("input[data-s]").forEach((el) => {
      el.addEventListener("input", () => {
        const key = el.dataset.s;
        const val = Number(el.value) / 100;
        api.setSettings({ ...api.getSettings(), [key]: val });
        sync();
      });
    });

    sync();
  };

  const toggle = (force) => {
    open = typeof force === "boolean" ? force : !open;
    els.panel?.classList.toggle("open", open);
    if (open) sync();
  };

  const sync = () => {
    if (!api || !els.panel) return;
    const s = normalize(api.getSettings());
    const st = api.getStatus();

    els.panel.querySelector('[data-seg="enabled"]').querySelectorAll("button").forEach((b) =>
      b.classList.toggle("on", (b.dataset.v === "on") === s.enabled)
    );
    els.panel.querySelector('[data-seg="quality"]').querySelectorAll("button").forEach((b) =>
      b.classList.toggle("on", b.dataset.v === s.quality)
    );
    els.panel.querySelector('[data-seg="peakMode"]').querySelectorAll("button").forEach((b) =>
      b.classList.toggle("on", b.dataset.v === s.peakMode)
    );
    els.panel.querySelector('[data-seg="zeroCopy"]').querySelectorAll("button").forEach((b) =>
      b.classList.toggle("on", (b.dataset.v === "on") === Boolean(s.zeroCopy))
    );

    const autoRow = els.panel.querySelector("[data-auto]");
    const manRow = els.panel.querySelector("[data-manual]");
    autoRow.classList.toggle("hide", s.peakMode !== "auto");
    manRow.classList.toggle("hide", s.peakMode !== "manual");

    const sysNits = st.headroom?.raw || st.headroom?.nits || 0;
    els.panel.querySelector("[data-sysnits]").textContent = sysNits
      ? `${Math.round(sysNits)}${st.headroom.screen ? " · " + st.headroom.screen : ""}`
      : "未连接（见 native/）";

    els.panel.querySelector("[data-peakval]").textContent = String(Math.round(s.peakNits));
    const range = els.panel.querySelector("[data-peakrange]");
    const numIn = els.panel.querySelector("[data-peaknum]");
    if (document.activeElement !== range) range.value = String(clamp(s.peakNits, 500, 2000));
    if (document.activeElement !== numIn) numIn.value = String(Math.round(s.peakNits));

    els.panel.querySelectorAll("input[data-s]").forEach((el) => {
      const key = el.dataset.s;
      const v = s[key];
      if (document.activeElement !== el) el.value = String(Math.round(v * 100));
      const out = els.panel.querySelector(`[data-v-${key}]`);
      if (out) out.textContent = pct(v);
    });

    const dot = els.pill.querySelector(".dot");
    dot.className = "dot";
    if (!s.enabled) dot.classList.add("off");
    else if (st.skipReason) dot.classList.add("warn");

    const peak = st.headroom?.nits ?? 0;
    const src = { system: "系统读取", manual: "手动", fallback: "兜底" }[st.headroom?.source] || "—";
    const parts = [
      `<b>${st.renderer || "—"}</b> · ${st.sourceW || 0}×${st.sourceH || 0}`,
      st.active
        ? `${st.fps || 0} fps · ${st.cost || 0} ms · scale ${st.scale || 1} · 零拷贝 ${st.zeroCopy ? "开" : "关"}`
        : `未处理${st.skipReason ? " · " + st.skipReason : ""}`,
      `峰值 <b>${Math.round(peak)}</b> nits（${src}）`,
      st.headroom?.screen ? `屏幕 ${st.headroom.screen}` : ""
    ].filter(Boolean);
    els.panel.querySelector("[data-status]").innerHTML = parts.join("<br>");
  };

  const tick = () => {
    if (open) sync();
  };

  let toastTimer = null;
  const notice = (msg) => {
    if (!root) return;
    root.querySelector(".toast")?.remove();
    const t = h(`<div class="toast"></div>`);
    t.textContent = msg;
    root.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2600);
  };

  NS.ui = { mount, sync, tick, toggle, notice };
})();
