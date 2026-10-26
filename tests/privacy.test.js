const test = require('node:test');
const assert = require('node:assert/strict');
const Privacy = require('../miniprogram/lib/privacy');

test('privacy gate waits for platform success, not a local consent flag', async () => {
  let complete,
    resolved = false;
  const pending = Privacy.authorize({ requirePrivacyAuthorize: (o) => (complete = o.success) });
  pending.then(() => (resolved = true));
  await new Promise(setImmediate);
  assert.equal(resolved, false);
  complete({});
  await pending;
  assert.equal(resolved, true);
});
test('unsupported privacy APIs fail closed instead of assuming consent', async () => {
  await assert.rejects(Privacy.authorize({}), /升级微信/);
  await assert.rejects(Privacy.openContract({}), /升级微信/);
});
test('official contract opens through callback API and has a truthful failure message', async () => {
  let opened = 0;
  await Privacy.openContract({
    openPrivacyContract: (o) => {
      opened++;
      o.success({});
    },
  });
  assert.equal(opened, 1);
  await assert.rejects(
    Privacy.openContract({ openPrivacyContract: (o) => o.fail({}) }),
    /暂不可用/,
  );
});
test('data explanation covers actual collection, retention, sharing and user controls', () => {
  const text = Privacy.sections.map((section) => section.content).join('\n');
  for (const expected of [
    'RSSI',
    '手动输入',
    '微信本机缓存',
    '主动删除',
    '不向开发者服务器上传',
    '撤回',
    '未成年人',
    '联系',
  ])
    assert.ok(text.includes(expected), expected);
  assert.doesNotMatch(text, /绝不收集|本版本完全不联网|已通过.*合规|假设|待填写/);
});
