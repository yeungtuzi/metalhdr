# MetalHDR

把网页里的 **SDR 视频实时转成 HDR（macOS EDR）**。自动读取显示器的亮度上限，用**软肩滚降**把高光映射进这个上限——不裁切、也没有硬膝点。

给 macOS 上用 Safari / Chromium 看 B 站、YouTube 的人。灵感来自 Windows 上的 NVIDIA RTX Video HDR，以及 MacLC 的原生 SDR→HDR 管线。

```
SDR 帧 → 线性光 → 逆色调映射 → 软肩滚降(≤ 屏幕峰值) → Display P3 扩展范围画布
```

## 两个 build

| build | 产物 | 用在哪 |
|---|---|---|
| 油猴脚本 | `dist/metalhdr.user.js` | Safari（Tampermonkey）、Chrome/Edge/Brave |
| 扩展 | `dist/metalhdr-extension/`、`*.zip` | Chromium 直接加载；Safari 用 converter 包成 App |

两者共用同一份 `src/`，只有外壳不同。

## 特性

- **自动亮度上限**：本地守护进程 `metalhdr-meter` 读取 `NSScreen` 的 EDR 余量（如 M27P20 → 1015 nits），扩展通过 background 代理、油猴通过 `GM_xmlhttpRequest` 取用
- **不裁切**：C1 连续的软肩曲线，渐近逼近峰值但永不越过；大面积高光自动收敛
- **两档画质**：高（多 pass 亮度金字塔 + 局部高光 + 肤色保护 + 去色带 + 锐化）/ 低（HDR Lift 式单 pass 全局提亮）
- **性能自适应**：单帧耗时超标时自动降渲染分辨率；播放卡住有看门狗，会先把原视频还给你
- **首帧后才接管**：渲染成功前不动原视频，避免黑屏
- **B 站适配**：识别 HDR/杜比片源并跳过、DRM 提示、切清晰度后自动重绑
- 面板 `Alt+H` 唤出，所有参数即时生效

## 安装

### 0. 亮度守护进程（自动读取需要）

```bash
bash native/install.sh
```

编译 `metalhdr-meter` 并注册 LaunchAgent（登录自启），自检会打印当前屏幕读数。卸载用 `native/uninstall.sh`。

不装也能用：面板里把「最高亮度」切到**手动**，拖 500–2000 nits。

### 1a. Safari（油猴脚本）

1. 安装 [Tampermonkey for Safari](https://apps.apple.com/app/tampermonkey/id1482490089)，在 Safari 设置里允许它访问所有网站
2. 打开 Tampermonkey 面板 → 添加新脚本 → 粘贴 `dist/metalhdr.user.js` → 保存
3. 打开任意视频页，按 `Alt+H`

### 1b. Chromium

`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选 `dist/metalhdr-extension/`。

### 1c. Safari 原生扩展（需要 Xcode）

```bash
node scripts/build.mjs
bash scripts/make-safari.sh     # 生成 Xcode 工程
bash scripts/run-safari.sh      # 无账号：ad-hoc 签名构建 + 注册 + 启动
bash scripts/install-app.sh     # 装到 ~/Applications 并重新注册
```

然后 **Safari › 设置 › 扩展** 勾选 MetalHDR。若从 Xcode 直接 Run，需要先在 Safari 的「开发」菜单里允许未签名扩展。

有个人 Team 时在 Xcode 里给两个 target 选团队即可。

## 支持的站点

| 站点 | 行为 |
|---|---|
| B 站 | 处理普通投稿；按画质标签识别 HDR/杜比并跳过；番剧/影视 DRM 直接跳过 |
| YouTube | 处理 SDR；只要有 HDR 版本就跳过（读播放器 `adaptiveFormats` 的 BT.2020 / PQ / HLG） |
| 其他任意站点 | 通用 `<video>` 接管，按 URL 与 `hdrMetadataType` 做基本判断 |

> Safari 上 YouTube 的 HDR 自动识别**不可用**：Safari 不支持 manifest 的 `world: "MAIN"`，
> 内容脚本读不到页面里的播放器数据。在 Safari 看 YouTube 的 HDR 视频时，请按 `Option+H`
> 手动把「启用」切到「关闭」，否则画面会被重复抬亮。B 站与 DRM 列表不受影响。
| Netflix / Disney+ / Prime / Apple TV+ / Max / Hulu / 爱奇艺 / 腾讯视频 / 优酷 / 芒果 / 抖音 等 | 视为 DRM，直接跳过，不尝试读帧 |

YouTube 的 HDR 判断需要读播放器数据，而内容脚本运行在隔离世界读不到页面全局，所以有一个**只在 `youtube.com` 运行的 MAIN world 小脚本**（`yt-main.js`），把结论写进 `data-metalhdr-yt-hdr` 属性供主脚本读取。油猴版直接在页面世界执行，不需要这一步。

## 设置面板

| 项 | 说明 |
|---|---|
| 画质 | 高 = 多 pass；低 = 单 pass（更省 GPU） |
| 最高亮度 | 自动（系统）/ 手动 500–2000 nits |
| 提亮强度 | 逆映射增益总量 |
| 覆盖范围 | 从多暗的亮度开始抬；越小越只动高光 |
| 饱和度 | 逆映射同时的色域扩展量 |
| 锐化 / 去色带 | 低码率源尤其有用 |

状态行会显示渲染器、分辨率、帧率、单帧耗时、当前峰值来源。

## 算法原理

一句话：**在线性光域里只抬「亮部」，用一条 C1 连续的软肩曲线把结果收进显示器的实际峰值，全程不裁切。**

### 1. 色彩链路

```
视频帧 (sRGB/BT.709, 8bit)
  → 解码 sRGB 传递函数        → 线性 BT.709
  → 逆色调映射（下面第 3 步）  → 线性，1.0 = SDR 白
  → BT.709 → Display P3 矩阵
  → sRGB 传递函数编码
  → rgba16float 画布（toneMapping: extended）
```

峰值统一用「SDR 白的倍数」表示：`peak = 峰值 nits / 100`。macOS 上 EDR 的 1.0 对应约 100 nit 参考白，所以 964 nits 的屏幕就是 `peak ≈ 9.6`。

### 2. 只动亮部：驱动能量

逐像素算一个「有多亮」的标量，而不是直接对 RGB 三个通道分别处理——这样色相不会偏：

```wgsl
Y     = 0.2126R + 0.7152G + 0.0722B      // 亮度
drive = max(Y, 0.85 * max(R,G,B))        // 取两者较大：纯色高光也能被识别
```

`0.85 * max(R,G,B)` 这一项来自 MacLC 的公开规格，用来避免「红色霓虹灯」这类高饱和高光因为亮度低而被漏掉。

### 3. 逆色调映射增益

```wgsl
w      = smoothstep(reach, 1.0, max(drive, localMax * 0.9))  // 亮部权重
area   = smoothstep(0.72, 1.0, localMax)                     // 是否大面积明亮
atten  = 1 - shaping * area * 0.65                           // 大面积自动收敛
adapt  = mix(1.0, 0.72, smoothstep(0.45, 0.92, sceneAvg))     // 亮场景少给、暗场景多给
gain   = 1 + (peak - 1) * w * atten * adapt * strength
lin   *= gain                                                // 整像素等比缩放，保色相
```

- `localMax` / `sceneAvg` 来自高光图：高画质是 3 级降采样金字塔（1/2 → 1/4 → 1/8，每级取邻域**最大**亮度与**平均**亮度）；零拷贝路径是单 pass 直接按 1/8 采样
- `reach` 控制「从多暗开始抬」，越大越只动高光
- 大面积白色（天空、白墙）用 `atten` 收敛，避免整片推爆

### 4. 软肩：为什么不会裁切

```wgsl
k = 0.85 * peak
f(x) = x                                              , x ≤ k
     = k + (peak-k) * (1 - exp(-(x-k)/(peak-k)))      , x > k
```

性质：

- **C1 连续**：`f(k) = k`，`f'(k⁻) = f'(k⁺) = 1`，没有硬膝点
- **严格有界**：`f(x) < peak` 对任意有限 x 成立，只是渐近
- **保色相**：先对 `max(R,G,B)` 求 `f`，再按 `f(m)/m` 等比缩放整个像素

所以哪怕峰值估高了（比如系统报 10× 而实际只给 2×），也只会被显示器压暗，不会出现「一片死白」的硬裁切。

### 5. 肤色保护与去色带

- 肤色近似：`warmth = (R-B)/R`，只在非暗区生效，按 `protect` 比例**减少**饱和度提升，避免人脸变橙
- 去色带：输出前加三角分布抖动（两个 hash 相减），幅度 `deband/255`，把 8 bit 源拉伸后出现的色阶抹平

### 6. 两档画质

| | 高（多 pass） | 低（单 pass） |
|---|---|---|
| 高光检测 | 3 级亮度金字塔，局部高光检测更准 | 单次 1/8 采样 / 4 抽头近似 |
| 曲线 | 第 3 步的完整增益模型 | 全局提亮 + 高光遮罩 + 软肩 |
| 用途 | 默认 | 4K60 或低功耗场景 |

两档共用同一条软肩（第 4 步），所以**低画质也不会裁切**，只是高光的空间精度差一些。

### 7. 边界

逆色调映射只能**重新分配**已有的亮度，无法恢复已经在 8 bit 里被裁掉的细节。片源本身过曝的高光，只会被映射成一个有层次的亮块，而不是还原出里面的内容。

## 致谢

本项目的骨架、算法与色彩管线并非从零发明，主要来自这些公开工作：

- **[HDR Lift](https://github.com/ZheMuxi/HDR-Lift)**（ZheMuxi，GPL-3.0）——WebExtension 骨架、content script 生命周期、WebGPU/WebGL2 降级链、设置面板形态与图标资源都以其为基础
- **[Headroom HDR / SDR-to-HDR-Video](https://github.com/96dot/SDR-to-HDR-Video)**（MIT）——多 pass 逆色调映射的思路：拷贝 → 亮度金字塔 → 主 pass，局部高光检测、大面积收敛、去色带、锐化
- **[MacLC](https://www.hazenstudio.com/maclc/)**（Hazen Studio）——`drive = max(Y, 0.85·max(R,G,B))` 的驱动能量公式、以 SDR 白倍数表示峰值、软肩滚降的思路
- **[W3C ColorWeb-CG](https://github.com/w3c-cg/ColorWeb-CG)** 与 Chromium 的 `CanvasHDR` / WebGPU `toneMapping: 'extended'`——`rec2100-pq`、`display-p3` 与扩展范围画布的色彩语义
- **[ITU-R BT.2390](https://www.itu.int/pub/R-REP-BT.2390)**——EETF 的色调映射思想，本项目的软肩曲线是它的一个简化实现

软肩曲线本身（指数形式、膝点导数为 1、渐近封顶）是这个项目里独立实现的，没有直接照搬上述代码。

## 已知限制

- **DRM 视频**（Netflix、B 站影视区部分内容）：已知问题，不做处理，检测到直接跳过、不弹提示
- **已经是 HDR 的片源**会自动跳过：B 站按画质标签、YouTube 按 `adaptiveFormats` 的色彩信息（保守策略：只要提供 HDR 版本就跳过，即使当前选的是 SDR 画质）
- **站点全屏的是 `<video>` 本身**时，覆盖层不在全屏树内：会暂时交还原视频并提示，退出全屏自动恢复。
  B 站/YouTube 全屏的是播放器容器，不受影响
- 烧录进画面的字幕、logo 会被一起抬亮
- **Safari + YouTube HDR**：无法自动识别（Safari 不支持 `world: "MAIN"`），需手动关闭增强
- 高画质在 4K60 下 GPU 压力明显，面板可切「低」
- **零拷贝（实验，默认关闭）**：Chromium 上单帧可降到 0.1 ms 级。**开启后可能的后果**：
  画面颜色/亮度可能与关闭时不同（两条路径的色彩处理未对齐）、Safari 上可能直接黑屏、部分机型上会闪烁。
  只是省一次全帧拷贝，不改变增强强度；出现任何异常请切回「关」，拷贝路径是已验证的正确基准

## 已验证

| 环境 | 结果 |
|---|---|
| Safari 27.2 + 油猴脚本 | 测试条正常输出；B 站画面变亮；原生全屏增强保持 |
| Chromium（Brave 158）扩展 | B 站接管成功，100 fps；网页全屏/原生全屏 canvas 与视频 rect 一致 |
| 裸 `<video>` 全屏 | 自动交还原视频并提示，退出后恢复增强 |
| 4K 25fps（Safari，拷贝路径） | 19.7 ms/帧，预算 40 ms，不掉帧 |

## 开发

```bash
node scripts/build.mjs        # 打两个 build
node tests/tone.test.mjs      # 软肩曲线性质：单调 / 不越界 / C1
node tests/e2e-flow.mjs       # Chromium 上跑 B 站，验证接管与回退
```

目录：

```
src/            00-core 10-shaders 20-renderers 30-site 40-ui 50-content
extension/      manifest、图标
native/         亮度守护进程 + 安装脚本
scripts/        build / make-safari / run-safari
demo/           本地测试页（含 Range 支持的 beacon 服务器：tests/beacon.mjs）
```

## 许可

GPL-3.0-or-later。骨架来自 [HDR Lift](https://github.com/ZheMuxi/HDR-Lift)（GPL-3.0），
高画质算法参考 [Headroom HDR](https://github.com/96dot/SDR-to-HDR-Video)（MIT），
驱动能量公式参考 [MacLC](https://www.hazenstudio.com/maclc/) 公开规格。详见 [NOTICE](NOTICE)。
