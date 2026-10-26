# 爱冠篮品牌与素材清单

2026-10-26。品牌主色为橙色 #FF861C，背景为深海军蓝 #0E131C。所有运行素材随小程序本地打包，无外部图片 CDN。

## 已交付与接入

| 素材 | 路径（相对项目） | 尺寸 / 字节 | 来源与用途 |
| --- | --- | --- | --- |
| 运行品牌图标 | miniprogram/assets/brand/app-icon.png | 192×192 / 40729 B | GPT 品牌原图等比例缩小；我的页默认头像、大屏图标。已低于微信代码质量建议的单资源 200 K |
| 后台头像原图 | ../courtside-icon-512.png（包外） | 512×512 / 260467 B | 原图保留，可人工上传小程序后台头像，小于 1 MB；不作为运行图片打包 |
| 训练空态插画 | miniprogram/assets/brand/training-empty.png | 256×256 / 61994 B | 本轮内置 GPT 生图；排行榜无记录空态。生成原图 1254×1254，交付版仅等比例缩小，不修改内容 |
| 我的页篮球插画 | miniprogram/assets/brand/profile-basketball.png | 128×128 / 16512 B | 内置 GPT 生图，真实透明背景；替换页脚 CSS 圆圈斜线占位。源图在 design-assets/profile-basketball-source.png，不进入运行包 |
| 操作与导航图标 | miniprogram/assets/icons/*.png | 每枚 96×96 | Tabler Icons（MIT），并非 GPT 生成。篮球、奖杯、统计、用户、蓝牙、电视、播放、编辑，共 8 类及选中态；授权见同目录 LICENSE |

后台头像尚未上传或替换；代码接入与微信后台配置是两件事。GPT 生成素材不代表商标注册或权利检索已完成。

SVG 与未引用的操作选中态 PNG 保留为源文件，通过 project.config.json 排除出运行包；导航的四组普通/选中 PNG 仍正常打包。MIT 授权文件保留。`npm run assets:check` 防止新资源超限或误排除必需图片。

## 可用文案

- 名称：爱冠篮（以微信后台可用名称和主体权属为准）。
- 简介建议：连接篮球发球机，设置训练模式，实时查看训练数据并记录每次进步。
- 品牌短句：把热爱，练成实力。
- 无成绩：暂无训练数据 / 完成一次训练，记录第一份成绩。
- 安全提示：训练时请保持小程序在前台。请远离出球口，紧急情况优先使用机器实体停止开关。
- 数据说明：训练记录仅保存在本机，排行为个人单次成绩比较，不代表全网排名。

文案不承诺未经验证的命中率、训练效果、云备份或自动投屏功能。

## 生成方式和最终提示词

品牌与两张插画均使用内置 image_gen（GPT 生图），未使用 API Key 或 CLI 回退。图标复用你提供链接中的成品，不重复生成另一套品牌。仅通过系统 sips 缩放交付尺寸；透明图保留 alpha。

### 品牌图标（原聊天生成提示词）

Use case: logo-brand. Create one finished square WeChat mini-program app icon for COURTSIDE, a basketball shooting-machine training controller and statistics app. Existing UI is near-black charcoal and vivid orange. Full-bleed solid near-black background #111317; a single original, bold, beautifully balanced orange emblem combining a clearly recognizable basketball with a minimal shooting trajectory and hoop suggestion, as one coherent compact symbol. Geometric flat vector-like artwork, premium sports-tech identity, decisive thick curves and clean negative space, flat solid orange #FF762B, absolutely no texture or grain, no gradients, no glow, no shadow, no 3D. Center emblem occupying about 68 percent of canvas, with ample uniform safe area for circle cropping. Icon should remain recognizable at 48px. No words, no letters, no numbers, no watermark, no device mockup, no outer frame, no rounded-square silhouette; background reaches all four edges. Deliver one square raster icon only, ideally 1024x1024, optimized simple-color design for a file below 1 MB.

### 训练空态（本轮生成提示词）

Use case: stylized-concept. Asset type: empty-state illustration for the 爱冠篮 basketball shooting-machine WeChat mini-program. Create one square polished minimal sports-tech illustration on an opaque solid deep navy background #202632, matching a dark navy and vivid orange app. Subject: one orange basketball just above a simple basketball hoop, with one restrained curved shooting trajectory, a subtle geometrical court line below. Center the small compact subject with generous negative space, readable at 96px. Flat vector-like clean illustration, a tiny touch of soft warm shading, orange #ff861c with muted warm cream accents; consistent thick clean outlines, no grain. No people, no machine, no text or letters, no digits, no watermark, no mockup, no logos from real teams, no frame. Original illustration, avoid clutter. This is decorative empty-state art, not a UI screenshot.

### 我的页篮球（2026-10-26）

Use case: stylized-concept. Asset type: a tiny original basketball illustration for a Chinese basketball training WeChat mini program's profile footer. Primary request: one clearly recognizable orange basketball, gently shaded, premium clean flat-meets-soft-volume illustration. Transparent background. Centered isolated whole basketball, round silhouette, four clean dark navy curved basketball seams, warm orange #FF861C, restrained highlights, crisp edges and strong readability when displayed at 28 to 32 pixels. Square canvas with 12 percent transparent padding. Match an understated navy/orange sports UI, useful in both light and dark mode. No text, no letters, no logo, no watermark, no badge, no circular border, no diagonal slash, no prohibition symbol, no hoop, no people, no extra objects, no background or cast shadow.
