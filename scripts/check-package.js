const fs = require('node:fs');
const path = require('node:path');

// Deliberately stricter than 200 KiB so the IDE's 200 K recommendation is met.
const MEDIA_LIMIT = 200000;
const PACKAGE_LIMIT = 1500000;
const MEDIA = /\.(?:png|jpe?g|webp|gif|mp3|wav|aac|m4a|ogg)$/i;

function included(file, rules) {
  return !rules.some((rule) => {
    if (rule.type === 'suffix') return file.endsWith(rule.value);
    if (rule.type === 'file') return file === rule.value.replace(/^\//, '');
    if (rule.type === 'folder') {
      const folder = rule.value.replace(/^\/+|\/+$/g, '');
      return file.startsWith(`${folder}/`);
    }
    throw new Error(`Unsupported package ignore type: ${rule.type}`);
  });
}

function inspectPackage(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  if (config.miniprogramRoot !== 'miniprogram/') throw new Error('Unexpected runtime root');
  const runtime = path.join(root, config.miniprogramRoot);
  const rules = config.packOptions?.ignore || [];
  if (config.packOptions?.include?.length)
    throw new Error('Review explicit package includes first');
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Runtime symlinks are not allowed');
      if (entry.isDirectory()) walk(absolute);
      else {
        const relative = path.relative(runtime, absolute).split(path.sep).join('/');
        if (included(relative, rules))
          files.push({ file: relative, bytes: fs.statSync(absolute).size });
      }
    }
  }
  walk(runtime);
  for (const { file, bytes } of files) {
    if (MEDIA.test(file) && bytes > MEDIA_LIMIT)
      throw new Error(`Oversized runtime media: ${file}`);
    if (/\.svg$/i.test(file)) throw new Error(`Source-only SVG in runtime: ${file}`);
  }
  const total = files.reduce((sum, item) => sum + item.bytes, 0);
  if (total > PACKAGE_LIMIT) throw new Error('Runtime source exceeds the 1.5 MB project budget');

  const template = fs.readFileSync(path.join(runtime, 'pages/index/index.wxml'), 'utf8');
  const controller = fs.readFileSync(path.join(runtime, 'pages/index/index.js'), 'utf8');
  const required = new Set();
  for (const [, src] of template.matchAll(/\bsrc="(\/assets\/[^"{}]+)"/g))
    required.add(src.slice(1));
  // The only dynamic image binding is the four navigation icons plus active states.
  const navigation = controller.match(/\btabs:\s*\[([\s\S]*?)\]/)?.[1] || '';
  for (const [, icon] of navigation.matchAll(/\bicon:\s*['"]([^'"]+)['"]/g)) {
    for (const state of ['', '-active']) required.add(`assets/icons/${icon}${state}.png`);
  }
  if (required.size !== 15)
    throw new Error('Asset bindings changed: review the runtime asset manifest');
  for (const file of required) {
    if (!files.some((item) => item.file === file))
      throw new Error(`Missing/excluded runtime asset: ${file}`);
  }
  for (const { file } of files.filter((item) => MEDIA.test(item.file))) {
    if (!required.has(file)) throw new Error(`Unreferenced runtime media: ${file}`);
  }
  return { count: files.length, total, media: files.filter((item) => MEDIA.test(item.file)) };
}

if (require.main === module) {
  const result = inspectPackage(path.join(__dirname, '..'));
  console.log(`Runtime assets passed: ${result.media.length} media, each <= ${MEDIA_LIMIT} B.`);
  console.log(`${result.count} runtime source files, ${result.total} B before WeChat compilation.`);
}
module.exports = { inspectPackage, included, MEDIA_LIMIT };
