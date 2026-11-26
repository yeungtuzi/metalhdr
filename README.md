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

## 原理

- **输入**：`<video>` 帧 → `copyExternalImageToTexture` 进 `rgba16float` 纹理
- **高画质**：3 级降采样得到「局部最大亮度 / 场景平均」，主 pass 按 MacLC 的驱动能量 `max(Y, 0.85·maxRGB)` 计算高光权重，整像素等比缩放保色相
- **软肩**：`k = 0.85·peak`，`x ≤ k` 恒等；`x > k` 时 `k + (peak−k)(1−e^{−(x−k)/(peak−k)})`，膝点导数为 1，渐近于 peak
- **输出**：BT.709 → Display P3，sRGB 传递函数编码，写入 `toneMapping: 'extended'` 的画布；不支持扩展的画布会软压回 SDR

峰值以「SDR 白 = 100 nits」为基准换算成倍数。

## 已知限制

- **DRM 视频**（Netflix、B 站影视区部分内容）：已知问题，不做处理，检测到直接跳过、不弹提示
- **已经是 HDR 的片源**会自动跳过；B 站按画质标签判断
- **站点全屏的是 `<video>` 本身**时，覆盖层不在全屏树内：会暂时交还原视频并提示，退出全屏自动恢复。
  B 站/YouTube 全屏的是播放器容器，不受影响
- 烧录进画面的字幕、logo 会被一起抬亮
- 高画质在 4K60 下 GPU 压力明显，面板可切「低」

## 已验证

| 环境 | 结果 |
|---|---|
| Safari 27.2 + 油猴脚本 | 测试条正常输出；B 站画面变亮；原生全屏增强保持 |
| Chromium（Brave 158）扩展 | B 站接管成功，100 fps；网页全屏/原生全屏 canvas 与视频 rect 一致 |
| 裸 `<video>` 全屏 | 自动交还原视频并提示，退出后恢复增强 |

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
