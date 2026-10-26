// Mechanical WXML binding normalization, safe to re-run.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../miniprogram/pages/index/index.wxml');
const source = fs.readFileSync(file, 'utf8');
fs.writeFileSync(
  file,
  source
    .replace(/(wx:if|disabled)="([^"\n]+)"/g, (all, key, value) =>
      value.startsWith('{{') ? all : `${key}="{{${value}}}"`,
    )
    .replaceAll('.svg', '.png'),
);
