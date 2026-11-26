// MetalHDR · shaders — WGSL (WebGPU) 与 GLSL (WebGL2)
(() => {
  "use strict";

  const NS = (globalThis.MetalHDR = globalThis.MetalHDR || {});

  // ── 共用数学：两种画质都走同一条「软肩」曲线，保证不裁切 ──────────────
  const COMMON = /* wgsl */ `
fn srgbToLinear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, c <= vec3f(0.0031308));
}

// BT.709 线性 → Display P3 线性
fn toP3(c: vec3f) -> vec3f {
  return vec3f(
    dot(c, vec3f(0.8225923, 0.1775235, 0.0000000)),
    dot(c, vec3f(0.0331957, 0.9667878, 0.0000165)),
    dot(c, vec3f(0.0170841, 0.0723982, 0.9105177))
  );
}

// C1 连续、渐近于 peak 的软肩：永不裁切，也不做硬膝点
fn softKnee(x: f32, peak: f32) -> f32 {
  let k = 0.85 * peak;
  if (x <= k) { return x; }
  let d = max(peak - k, 1e-4);
  return k + d * (1.0 - exp(-(x - k) / d));
}

fn luma709(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn hash21(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34, 456.21));
  let r = q + dot(q, q + 45.32);
  return fract(r.x * r.y);
}
`;

  const UNIFORM = /* wgsl */ `
struct U {
  res: vec2f,
  texel: vec2f,
  peak: f32,
  strength: f32,
  reach: f32,
  shaping: f32,
  saturation: f32,
  sharpen: f32,
  deband: f32,
  protect: f32,
  quality: f32,
  exposure: f32,
  extended: f32,
  adapt: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
  pad3: f32,
};

struct D {
  outRes: vec2f,
  texel: vec2f,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> U0: U;
@group(0) @binding(3) var smallTex: texture_2d<f32>;
`;

  const UNIFORM_DOWN = /* wgsl */ `
struct D {
  outRes: vec2f,
  texel: vec2f,
};

@group(0) @binding(0) var downSrc: texture_2d<f32>;
@group(0) @binding(1) var downSamp: sampler;
@group(0) @binding(2) var<uniform> D0: D;
`;

  // ── 高画质：局部高光检测 + 大面积收敛 + 肤色保护 + 去色带 + 锐化 ─────
  const HQ = /* wgsl */ `
fn highQuality(lin: vec3f, uv: vec2f) -> vec3f {
  let y = luma709(lin);
  let m = max(lin.r, max(lin.g, lin.b));
  // MacLC 的驱动能量：亮度与最大通道 85% 取大，整像素等比缩放以保色相
  let drive = max(y, 0.85 * m);

  let small = textureSampleLevel(smallTex, samp, uv, 0.0);
  let localMax = small.r;
  let sceneAvg = small.g;

  let reachW = smoothstep(U0.reach, 1.0, max(drive, localMax * 0.9));
  // 大面积明亮处自动收敛，避免整片天/白墙被推爆
  let area = smoothstep(0.72, 1.0, localMax);
  let areaAtten = 1.0 - U0.shaping * area * 0.65;
  // 亮场景整体少给一点，暗场景多给一点
  let adapt = mix(1.0, 0.72, smoothstep(0.45, 0.92, sceneAvg));

  let gain = 1.0 + (U0.peak - 1.0) * reachW * areaAtten * adapt * U0.strength;
  var c = lin * gain;

  let y2 = luma709(c);
  // 肤色近似：暖色且非极暗，降低饱和提升
  let warmth = clamp((c.r - c.b) / max(c.r, 1e-4), 0.0, 1.0);
  let skin = warmth * smoothstep(0.06, 0.30, y2);
  let sat = 1.0 + U0.saturation * (1.0 - U0.protect * skin);
  c = mix(vec3f(y2), c, sat);

  // 软肩按最大通道做，再等比缩回 → 保色相且不超过 peak
  let mx = max(c.r, max(c.g, c.b));
  let my = softKnee(mx, U0.peak);
  return c * (my / max(mx, 1e-4));
}
`;

  // ── 低画质：HDR Lift 式全局提亮，但同样收敛到软肩 ──────────────────
  const LQ = /* wgsl */ `
fn lowQuality(lin: vec3f) -> vec3f {
  let y = luma709(lin);
  let mask = smoothstep(0.18, 0.92, y);
  let gain = 1.0 + U0.strength * 0.16 + U0.strength * U0.exposure * mask * 0.92;
  var c = lin * gain
        + pow(max(lin - vec3f(0.58), vec3f(0.0)), vec3f(1.35)) * U0.strength * 1.25;

  let y2 = luma709(c);
  c = mix(vec3f(y2), c, 1.0 + U0.saturation);

  let mx = max(c.r, max(c.g, c.b));
  let my = softKnee(mx, U0.peak);
  return c * (my / max(mx, 1e-4));
}
`;

  const VS = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
`;

  const MAIN = /* wgsl */ `
@fragment
fn fsMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / U0.res;
  var c = textureSampleLevel(srcTex, samp, uv, 0.0).rgb;

  // 对比自适应锐化（在编码域做，避免线性域的过冲）
  if (U0.sharpen > 0.001) {
    let t = U0.texel;
    let n = (textureSampleLevel(srcTex, samp, uv + vec2f(t.x, 0.0), 0.0).rgb
           + textureSampleLevel(srcTex, samp, uv - vec2f(t.x, 0.0), 0.0).rgb
           + textureSampleLevel(srcTex, samp, uv + vec2f(0.0, t.y), 0.0).rgb
           + textureSampleLevel(srcTex, samp, uv - vec2f(0.0, t.y), 0.0).rgb) * 0.25;
    c = clamp(c + (c - n) * U0.sharpen, vec3f(0.0), vec3f(1.0));
  }

  let lin = srgbToLinear(clamp(c, vec3f(0.0), vec3f(1.0)));

  var outLin: vec3f;
  if (U0.quality > 0.5) {
    outLin = highQuality(lin, uv);
  } else {
    outLin = lowQuality(lin);
  }

  var enc = linearToSrgb(toP3(max(outLin, vec3f(0.0))));

  // 去色带：三角分布抖动，只在最终编码域加
  if (U0.deband > 0.001) {
    let n1 = hash21(uv * U0.res) - 0.5;
    let n2 = hash21(uv * U0.res + 37.0) - 0.5;
    enc = enc + vec3f((n1 + n2) * U0.deband / 255.0);
  }

  // 非扩展画布：软压回 1.0，仍然不硬切
  if (U0.extended < 0.5) {
    let mx = max(enc.r, max(enc.g, enc.b));
    if (mx > 1.0) { enc = enc * (0.98 + 0.02 * (1.0 - exp(-(mx - 1.0)))) / mx; }
  }

  return vec4f(clamp(enc, vec3f(0.0), vec3f(8.0)), 1.0);
}

`;

  const DOWN = /* wgsl */ `
// 降采样：r = 邻域最大亮度（找高光），g = 邻域平均亮度（场景亮度）
@fragment
fn fsDown(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / D0.outRes;
  let t = D0.texel;
  let a = textureSampleLevel(downSrc, downSamp, uv + vec2f(-t.x, -t.y), 0.0).rgb;
  let b = textureSampleLevel(downSrc, downSamp, uv + vec2f( t.x, -t.y), 0.0).rgb;
  let c = textureSampleLevel(downSrc, downSamp, uv + vec2f(-t.x,  t.y), 0.0).rgb;
  let d = textureSampleLevel(downSrc, downSamp, uv + vec2f( t.x,  t.y), 0.0).rgb;
  let la = luma709(a); let lb = luma709(b); let lc = luma709(c); let ld = luma709(d);
  let mx = max(max(la, lb), max(lc, ld));
  let av = (la + lb + lc + ld) * 0.25;
  return vec4f(mx, av, 0.0, 1.0);
}
`;

  const WGSL_MAIN = `${UNIFORM}\n${COMMON}\n${HQ}\n${LQ}\n${VS}\n${MAIN}`;
  const WGSL_DOWN = `${UNIFORM_DOWN}\n${COMMON}\n${VS}\n${DOWN}`;

  // ── WebGL2 回退：单 pass，低画质曲线 + 4 抽头局部高光 ────────────────
  const GLSL_VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  vec2 q = p[gl_VertexID];
  vUv = q * 0.5 + 0.5;
  gl_Position = vec4(q, 0.0, 1.0);
}
`;

  const GLSL_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uTexel;
uniform float uPeak;
uniform float uStrength;
uniform float uReach;
uniform float uShaping;
uniform float uSaturation;
uniform float uDeband;
uniform float uProtect;
uniform float uQuality;
uniform float uExposure;
uniform float uExtended;

in vec2 vUv;
out vec4 outColor;

float luma709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + vec3(0.055)) / 1.055, vec3(2.4));
  return mix(hi, lo, step(c, vec3(0.04045)));
}

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - vec3(0.055);
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

vec3 toP3(vec3 c) {
  return vec3(
    dot(c, vec3(0.8225923, 0.1775235, 0.0000000)),
    dot(c, vec3(0.0331957, 0.9667878, 0.0000165)),
    dot(c, vec3(0.0170841, 0.0723982, 0.9105177))
  );
}

float softKnee(float x, float peak) {
  float k = 0.85 * peak;
  if (x <= k) return x;
  float d = max(peak - k, 1e-4);
  return k + d * (1.0 - exp(-(x - k) / d));
}

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(123.34, 456.21, 789.12));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = texture(uTex, uv).rgb;

  vec3 lin = srgbToLinear(clamp(c, 0.0, 1.0));
  float y = luma709(lin);
  float mask = smoothstep(0.18, 0.92, y);

  // 4 抽头估局部高光，弥补没有金字塔
  float lmax = 0.0;
  lmax = max(lmax, luma709(srgbToLinear(texture(uTex, uv + vec2(uTexel.x, 0.0)).rgb)));
  lmax = max(lmax, luma709(srgbToLinear(texture(uTex, uv - vec2(uTexel.x, 0.0)).rgb)));
  lmax = max(lmax, luma709(srgbToLinear(texture(uTex, uv + vec2(0.0, uTexel.y)).rgb)));
  lmax = max(lmax, luma709(srgbToLinear(texture(uTex, uv - vec2(0.0, uTexel.y)).rgb)));
  lmax = max(lmax, y);

  float gain;
  vec3 outc;
  if (uQuality > 0.5) {
    float drive = max(y, 0.85 * max(c.r, max(c.g, c.b)));
    float w = smoothstep(uReach, 1.0, max(drive, lmax * 0.9));
    float area = smoothstep(0.72, 1.0, lmax);
    gain = 1.0 + (uPeak - 1.0) * w * (1.0 - uShaping * area * 0.65) * uStrength;
    outc = lin * gain;
  } else {
    gain = 1.0 + uStrength * 0.16 + uStrength * uExposure * mask * 0.92;
    outc = lin * gain + pow(max(lin - vec3(0.58), vec3(0.0)), vec3(1.35)) * uStrength * 1.25;
  }

  float y2 = luma709(outc);
  float warmth = clamp((outc.r - outc.b) / max(outc.r, 1e-4), 0.0, 1.0);
  float skin = warmth * smoothstep(0.06, 0.30, y2);
  outc = mix(vec3(y2), outc, 1.0 + uSaturation * (1.0 - uProtect * skin));

  float mx = max(outc.r, max(outc.g, outc.b));
  float my = softKnee(mx, uPeak);
  outc = outc * (my / max(mx, 1e-4));

  vec3 enc = linearToSrgb(toP3(max(outc, vec3(0.0))));
  if (uDeband > 0.001) {
    float n = (hash21(uv * uRes) - 0.5) + (hash21(uv * uRes + 37.0) - 0.5);
    enc += vec3(n * uDeband / 255.0);
  }
  if (uExtended < 0.5) {
    float m2 = max(enc.r, max(enc.g, enc.b));
    if (m2 > 1.0) enc *= (0.98 + 0.02 * (1.0 - exp(-(m2 - 1.0)))) / m2;
  }
  outColor = vec4(enc, 1.0);
}
`;

  NS.shaders = { WGSL_MAIN, WGSL_DOWN, GLSL_VERT, GLSL_FRAG };
})();
