// 软肩曲线的性质：单调、C1 连续、渐近但永不超过 peak
import assert from "node:assert";

const knee = (x, peak) => {
  const k = 0.85 * peak;
  if (x <= k) return x;
  const d = Math.max(peak - k, 1e-4);
  return k + d * (1 - Math.exp(-(x - k) / d));
};

for (const peak of [1.0, 2.0, 4.0, 9.64, 20.0]) {
  let prev = -Infinity;
  for (let i = 0; i <= 20000; i++) {
    const x = (i / 20000) * peak * 4;
    const y = knee(x, peak);
    assert.ok(Number.isFinite(y), "finite");
    assert.ok(y <= peak + 1e-6, `不超过 peak: ${y} > ${peak}`);
    assert.ok(y >= prev - 1e-9, `单调: x=${x} y=${y} prev=${prev}`);
    prev = y;
  }
  // C1：膝点两侧导数一致
  const k = 0.85 * peak;
  const d = peak - k;
  const right = (knee(k + 1e-6, peak) - knee(k, peak)) / 1e-6;
  assert.ok(Math.abs(right - 1) < 0.01, `膝点导数≈1，实得 ${right}`);
}

// 接近 peak 的输入仍留有余量，不会被压到 0.85 以下
const top = knee(2.0 * 0.98, 2.0);
assert.ok(top > 1.7 && top < 2.0, `顶部保留细节: ${top}`);
// 膝点是软过渡：斜率从 1 平滑降到接近 0
const k = 0.85 * 2.0;
const slope = (knee(k + 0.05, 2.0) - knee(k, 2.0)) / 0.05;
assert.ok(slope < 1 && slope > 0.5, `肩部软过渡: ${slope}`);

console.log("✓ tone mapping: 单调 / 不越界 / C1 连续");
