const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.join(__dirname, '..');
let count = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !['preview', 'node_modules', '.git'].includes(e.name)) walk(p);
    else if (e.name.endsWith('.json')) {
      JSON.parse(fs.readFileSync(p, 'utf8'));
      count++;
    } else if (e.name.endsWith('.js')) {
      cp.execFileSync(process.execPath, ['--check', p]);
      count++;
    }
  }
}
walk(root);
const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json')));
for (const page of config.pages)
  for (const ext of ['js', 'json', 'wxml'])
    if (!fs.existsSync(path.join(root, 'miniprogram', page + '.' + ext)))
      throw new Error('Missing page ' + page + '.' + ext);
console.log(`${count} JS/JSON files validated; page registrations resolved.`);
