# 本机微信开发环境

2026-10-26，macOS 26.6.2 / Apple Silicon arm64。

## 安装与校验

- 已通过 Homebrew 安装 `wechatwebdevtools 2.02.2608080`。
- 应用：`/Applications/wechatwebdevtools.app`。
- CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`。
- 下载来源：Homebrew Cask 指向腾讯官方 `dldir1.qq.com/WechatWebDev/release/` 的 ARM64 DMG。
- 安装包 SHA-256 与 Cask 声明一致：`66e0a7d1f9ba8a0933d123153769436fc4d9bc74652246372e9f1ebbeb457033`。
- `codesign --verify --deep --strict` 通过；签名主体 Tencent Technology (Shanghai) Company Limited，Team ID `FN2V63AD2J`。
- `spctl --assess --type execute` 返回 accepted，source=Developer ID。未移除隔离属性、未重签名、未修改系统安全设置。

后续首次启动被 macOS GUI 拦截。重新检查确认签名完整，`spctl` 仍返回 Developer ID accepted，但 `xcrun stapler validate` 未发现附加公证票据，`syspolicy_check distribution` 返回 `Notary Ticket Missing`（Fatal）。因此，签名校验不能代表首次启动已获批准，也不能将该安装包描述为已通过完整公证检查。未尝试移除隔离、关闭 Gatekeeper、重签名或替用户确认例外。是否为这个应用单独放行，须由用户本人根据来源与风险决定。

Node.js `v24.12.0` / npm `11.6.2` 已存在，没有安装重复版本或修改 shell 配置。

## 项目入口

在项目根目录执行：

```sh
npm run wechat:check
npm run wechat:open
```

`wechat:check` 仅检查安装文件和项目路径，不启动工具。`wechat:open` 是用户明确运行时才会执行的官方 CLI 打开入口，不上传、发布或自动登录。

早期官方 CLI `--help` 检查被系统终止，退出码 137；原因当时未确定。用户本人处理 macOS 的首次启动放行后，CLI `--help` 已正常返回（退出码 0），GUI 也已进入项目导入页。未移除隔离或修改系统安全保护。

## 2026-10-26 后续现场检查

- 用户已确认完成系统放行，开发工具 GUI 正常打开。
- 导入页已读取本项目名称和目录，选择“不使用云服务”。
- 早期游客 AppID 导入曾返回“系统错误，错误码：1”；该历史错误不能仅归因于 AppID。
- 后续已写入用户提供的真实 AppID `wx84f4e196d257238d`，以“不使用云服务”重新导入成功。用户本人确认“信任并运行”，原生模拟器已运行首页、排行榜、数据与我的页面。
- 工具自带 `wcc-exec/wcc pages/index/index.wxml` 退出码 0。
- 工具自带 `wcc-exec/wcsc app.wxss` 退出码 0。
- 除附带编译器外，已观察 IDE 模拟器实际运行；仍不代表真机 BLE 验收完成。IDE 有 2 条警告提示，不能宣称零警告。

## 当前使用与待验收

1. 导入用户指定 Git 仓库 `lovebot/` 根目录，配置指向 `miniprogram/`；小程序不需要构建 npm，后端依赖单独安装。之前的导入记录属于旧目录历史证据。
2. 如工具再次要求登录，由本人微信扫码。不读取或导出登录凭据。
3. CLI 服务端口未开启，官方 CLI 打开被拒绝后使用 GUI 导入；未改变该安全设置。
4. 样式修订阶段已检查 320×568、390×844、430×932 原生模拟器；移除演示模式并接入 GPT 素材后复查 430×932。
5. 上线之前必须完成真实设备与 iOS/Android 微信联调、协议歧义确认及平台主体/类目/隐私/审核事项。未上传或发布，未创建云服务或修改开发权限。

当前保留开发者工具和项目模拟器，方便用户继续验收；运行包中已无演示入口或模拟成绩生成。真机硬件尚未接入。
