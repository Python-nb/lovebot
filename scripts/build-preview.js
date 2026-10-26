// 生成静态浏览器预览。预览直接复用原生页面 WXML/WXSS/JS 和业务模块；不提供真蓝牙。
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const files = [
  'lib/protocol',
  'lib/records',
  'lib/ble',
  'lib/theme',
  'lib/privacy',
  'config/service',
  'lib/account',
  'lib/account-page',
  'pages/index/index',
];
const modules = Object.fromEntries(
  files.map((id) => [id, fs.readFileSync(path.join(root, `miniprogram/${id}.js`), 'utf8')]),
);
const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxml'), 'utf8');
const css = fs
  .readFileSync(path.join(root, 'miniprogram/app.wxss'), 'utf8')
  .replace(/(-?\d*\.?\d+)rpx/g, 'calc(var(--rpx) * $1)')
  .replace(/(?<![-\w.])page(?=\s*\{)/g, '.phone')
  .replace(/(?<![-\w.])(?:scroll-view|view)(?![-\w])/g, 'div')
  .replace(/(?<![-\w.])text(?![-\w])/g, 'span')
  .replace(/(?<![-\w.])image(?![-\w])/g, 'img');
const assets = Object.fromEntries(
  ['icons', 'brand'].flatMap((folder) =>
    fs
      .readdirSync(path.join(root, 'miniprogram/assets', folder))
      .filter((x) => /\.(svg|png)$/.test(x))
      .map((x) => [
        `/assets/${folder}/${x}`,
        `data:image/${x.endsWith('.svg') ? 'svg+xml' : 'png'};base64,` +
          fs.readFileSync(path.join(root, 'miniprogram/assets', folder, x)).toString('base64'),
      ]),
  ),
);
const runtime = fs.readFileSync(path.join(__dirname, 'preview-runtime.js'), 'utf8');
const payload = JSON.stringify({ modules, wxml, assets }).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COURTSIDE · 篮球训练小程序预览</title><style>
*{box-sizing:border-box}body{margin:0;background:#08090b;color:#f5f4ef;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid #ffad7d;outline-offset:3px}button::after{border:0}img{object-fit:contain}input{outline-offset:3px}.preview-context{position:fixed;left:6vw;top:12vh;max-width:260px}.preview-context h1{font-size:42px;line-height:1.2;letter-spacing:-1.5px;margin:20px 0}.preview-context p{font-size:14px;line-height:1.9;color:#a3a4ab}.preview-context small{color:#ff8141;letter-spacing:3px;font-size:11px}.preview-context a{color:#ffad7d}.preview-notice{font-size:12px;color:#a3a4ab;border-top:1px solid #303136;padding-top:20px;margin-top:30px}.phone{--rpx:.573333px;width:430px;min-height:100vh;margin:auto;background:#101114;border-left:1px solid #303136;border-right:1px solid #303136;position:relative;font-size:16px;line-height:1.5}.phone .bottom-nav{left:50%;right:auto;transform:translateX(-50%);width:430px}.phone .modal-scrim,.phone .fullscreen-panel{left:50%;right:auto;width:430px;transform:translateX(-50%)}.phone .fullscreen-panel{padding:20px}.phone .big-rate{font-size:92px}.phone .app-shell{padding-left:18px;padding-right:18px}.phone .help-button{display:block}#dialog{max-width:360px;width:90%;border:1px solid #53545c;background:#242529;color:#f5f4ef;border-radius:20px;padding:24px;font-size:15px;line-height:1.8}#dialog::backdrop{background:#000b}#dialog h3{margin:0 0 10px;font-size:20px}#dialog input{color:#f5f4ef;background:#101114;border:1px solid #53545c;padding:12px;width:100%;border-radius:8px;margin:12px 0}.dialog-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:24px}.dialog-actions button{padding:10px 15px;border-radius:8px;border:1px solid #53545c;min-height:44px}.dialog-actions button:last-child{background:#ff8141;color:#24170f;border-color:#ff8141}#toast{position:fixed;left:50%;top:45%;transform:translateX(-50%);background:#f5f4ef;color:#101114;border-radius:12px;padding:16px 24px;z-index:100;display:none}.preview-context code{font-size:12px}@media(max-width:1100px){.preview-context{display:none}}@media(max-width:500px){body{background:#101114}.phone{width:100%;border:0;--rpx:calc(100vw / 750)}.phone .bottom-nav,.phone .modal-scrim,.phone .fullscreen-panel{width:100%}}\n${css}</style></head><body><aside class="preview-context"><small>WECHAT MINI PROGRAM</small><h1>把热爱，<br>练成实力。</h1><p>COURTSIDE 篮球训练<br>设备连接 / 训练控制 / 运动数据</p><div class="preview-notice">这是共用原生页面代码的浏览器预览。<br>演示流程可操作；真实 BLE 请在微信真机中验证。<br><br>源码：<code>miniprogram/</code><br>无云端账号或全网排行榜。</div></aside><main class="phone" id="root"></main><dialog id="dialog"><h3 id="dialog-title"></h3><p id="dialog-content"></p><input id="dialog-input" maxlength="16"><div class="dialog-actions"><button id="dialog-cancel">取消</button><button id="dialog-confirm">确认</button></div></dialog><div id="toast"></div><script>const BUNDLE=${payload};\n${runtime}</script></body></html>`;
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'preview/index.html'),
  html
    .replace(
      '演示流程可操作；真实 BLE 请在微信真机中验证。',
      '仅预览布局，不生成训练数据；真实 BLE 请在微信真机中验证。',
    )
    .replace('无云端账号或全网排行榜。', '账号服务需部署后在微信真机验证；不提供全网排行。'),
);
console.log('Built preview/index.html (shared WXML/WXSS/controller, offline standalone).');
