// Vendor CLI wrapper. check is static only; open is an explicit user-invoked launch.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const app = process.env.WECHAT_DEVTOOLS_APP || '/Applications/wechatwebdevtools.app';
const cli = path.join(app, 'Contents/MacOS/cli');
const command = process.argv[2] || 'check';
if (!['check', 'open'].includes(command)) {
  console.error('Usage: node scripts/wechat-devtools.js check|open');
  process.exit(2);
}
if (!fs.existsSync(cli)) {
  console.error('微信开发者工具 CLI 未找到：' + cli);
  console.error('请先安装官方 macOS 版本，或设置 WECHAT_DEVTOOLS_APP 为 .app 路径。');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const manifest = path.join(app, 'Contents/Resources/app.asar.unpacked/package.json');
const version = fs.existsSync(manifest)
  ? JSON.parse(fs.readFileSync(manifest, 'utf8')).version
  : 'unknown';
const miniRoot = path.resolve(root, config.miniprogramRoot || '.');
if (!fs.existsSync(path.join(miniRoot, 'app.json'))) throw new Error('小程序 app.json 不存在');
console.log('工具安装版本：' + version);
console.log('主机架构：' + process.arch);
console.log('CLI 文件存在：' + cli);
console.log('项目目录：' + root);
console.log('小程序目录：' + miniRoot);
console.log(
  'AppID 模式：' +
    (config.appid === 'touristappid'
      ? '游客（真机调试/上传需要自己的 AppID）'
      : '已配置，需微信工具验证授权'),
);
if (command === 'check') {
  console.log('静态环境检查通过；不证明 CLI 可启动、已登录或官方编译成功。');
  process.exit(0);
}
console.log('调用官方 CLI 打开项目；不会登录、上传或发布代码。');
const result = spawnSync(cli, ['open', '--project', root], { stdio: 'inherit', timeout: 30000 });
if (result.error || result.signal || result.status !== 0) {
  console.error('CLI 未正常完成：' + (result.error?.message || result.signal || result.status));
  console.error('请手动打开微信开发者工具，扫码登录，再导入上方项目目录。');
  process.exit(1);
}
