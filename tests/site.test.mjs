// site.js 的纯函数测试（不依赖 DOM）
await import("../src/30-site.js");
const { formatLooksHdr } = globalThis.MetalHDR.site;

const cases = [
  [{ colorInfo: { primaries: "COLOR_PRIMARIES_BT2020", transferCharacteristics: "COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084" } }, true, "YouTube 枚举全名"],
  [{ colorInfo: { primaries: "bt2020", transferCharacteristics: "smpte2084" } }, true, "短名 BT.2020 + PQ"],
  [{ colorInfo: { transferCharacteristics: "arib-std-b67" } }, true, "HLG"],
  [{ qualityLabel: "2160p HDR" }, true, "标签含 HDR"],
  [{ qualityLabel: "1080p60" }, false, "普通 1080p60"],
  [{ colorInfo: { primaries: "bt709", transferCharacteristics: "bt709" }, qualityLabel: "720p" }, false, "BT.709"],
  [{}, false, "空对象"],
  [null, false, "null"]
];

let failed = 0;
for (const [fmt, want, name] of cases) {
  const got = formatLooksHdr(fmt);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${got} (期望 ${want})`);
}
if (failed) {
  console.error(`${failed} 个用例失败`);
  process.exit(1);
}
console.log("✓ HDR 格式识别全部通过");
