const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectPackage, included, MEDIA_LIMIT } = require('../scripts/check-package');

test('runtime media budget and native asset references pass without excluding required images', () => {
  const result = inspectPackage(path.join(__dirname, '..'));
  assert.equal(result.media.length, 15);
  assert.ok(result.media.every((item) => item.bytes <= MEDIA_LIMIT));
});

test('package exclusions have exact file, suffix, and folder semantics', () => {
  assert.equal(included('assets/icon.png', [{ type: 'file', value: '/assets/icon.png' }]), false);
  assert.equal(included('assets/icon.png.bak', [{ type: 'file', value: 'assets/icon.png' }]), true);
  assert.equal(included('assets/icon.svg', [{ type: 'suffix', value: '.svg' }]), false);
  assert.equal(included('draft/icon.png', [{ type: 'folder', value: '/draft/' }]), false);
  assert.equal(included('draft2/icon.png', [{ type: 'folder', value: 'draft' }]), true);
  assert.throws(() => included('icon.png', [{ type: 'unknown', value: '' }]), /Unsupported/);
});
