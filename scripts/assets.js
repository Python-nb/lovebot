// 获取 Tabler MIT 授权的源图标。仅构建时联网，运行小程序不依赖 CDN。
const fs = require('node:fs/promises');
const path = require('node:path');
const names = [
  'ball-basketball',
  'trophy',
  'chart-bar',
  'user',
  'bluetooth',
  'device-tv',
  'player-play',
  'pencil',
];
async function main() {
  const dir = path.join(__dirname, '../miniprogram/assets/icons');
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    names.map(async (name) => {
      const res = await fetch(
        `https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/${name}.svg`,
      );
      if (!res.ok) throw new Error(`Icon ${name}: ${res.status}`);
      const raw = await res.text();
      for (const [suffix, color] of [
        ['', '#a3a4ab'],
        ['-active', '#ff8141'],
      ]) {
        // 原生 image 不继承 currentColor，固化颜色。
        const accent = ['bluetooth', 'device-tv', 'trophy', 'pencil'].includes(name);
        const actual = name === 'player-play' ? '#24170f' : accent && !suffix ? '#ff8141' : color;
        await fs.writeFile(
          path.join(dir, `${name}${suffix}.svg`),
          raw.replaceAll('currentColor', actual),
        );
      }
    }),
  );
  const license = await fetch('https://raw.githubusercontent.com/tabler/tabler-icons/main/LICENSE');
  if (!license.ok) throw new Error('License fetch failed');
  await fs.writeFile(path.join(dir, 'LICENSE'), await license.text());
  console.log('8 Tabler icons + active variants + MIT license saved.');
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
