// Native WeChat image compatibility: 96px PNGs derived from licensed SVG source.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.COURTSIDE_SHARP_MODULE || 'sharp');
const dir = path.join(__dirname, '../miniprogram/assets/icons');
Promise.all(
  fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.svg'))
    .map((n) =>
      sharp(path.join(dir, n))
        .resize(96, 96)
        .png()
        .toFile(path.join(dir, n.replace('.svg', '.png'))),
    ),
)
  .then(() => console.log('16 native-compatible PNG icons generated.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
