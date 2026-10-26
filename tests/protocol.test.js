const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../miniprogram/lib/protocol');
test('exact BLE UUIDs from supplied protocol', () => {
  assert.equal(P.UUID.service, '4fafc201-1fb5-459e-8fcc-c5c9c331914b');
  assert.equal(P.UUID.rx, 'beb5483e-36e1-4688-b7f5-ea07361b26a8');
  assert.equal(P.UUID.tx, '6e400003-b5a3-f393-e0a9-e50e24dcca9e');
});
test('time command follows SET1 example, minutes converted to seconds', () =>
  assert.equal(P.setupCommand('time', '10'), 'SET1#600#'));
test('count command exact', () => assert.equal(P.setupCommand('count', 100), 'SET2#100#'));
test('free mode never invents a reset command', () => assert.equal(P.setupCommand('free'), null));
for (const bad of ['', 0, -1, 1.5, 'abc', '10#Turn-on', 181, Infinity])
  test(`invalid time ${bad}`, () => assert.throws(() => P.setupCommand('time', bad)));
test('unknown mode rejected', () => assert.throws(() => P.setupCommand('other', 1)));
test('ASCII has no newline or terminator', () =>
  assert.equal(P.decode(P.encode('Turn-on')), 'Turn-on'));
test('valid frame matches seven fields', () =>
  assert.deepEqual(P.parseFrame('101,12,8,60,1,600,9,'), {
    shots: 12,
    hits: 8,
    seconds: 60,
    mode: 1,
    target: 600,
  }));
for (const raw of [
  '101,1,2,3,0,0,9,',
  '102,1,1,3,0,0,9',
  '101,1,1,3,3,0,9',
  '101,1,1,-3,0,0,9',
  '101,1,1,3,0,0,8',
  '101,1,1,3,0,0,9,4',
])
  test(`malformed frame ${raw}`, () => assert.equal(P.parseFrame(raw), null));
test('decoder supports all possible split points', () => {
  const raw = '101,12,8,60,1,600,9,';
  for (let i = 1; i < raw.length; i++) {
    const d = new P.FrameDecoder();
    const frames = [...d.push(raw.slice(0, i)), ...d.push(raw.slice(i))];
    assert.equal(frames.length, 1, `split ${i}`);
    assert.equal(frames[0].hits, 8);
  }
});
test('decoder handles concatenated frames and trailing partial data', () => {
  const d = new P.FrameDecoder();
  assert.equal(d.push('101,1,1,3,0,0,9,101,2,1,6,0,0,9,101,').length, 2);
  assert.equal(d.push('3,2,9,0,0,9,')[0].shots, 3);
});
test('decoder does not prematurely accept split invalid terminator 99', () => {
  const d = new P.FrameDecoder();
  assert.equal(d.push('101,1,1,3,0,0,9').length, 0);
  assert.equal(d.push('9,').length, 0);
});
test('malformed data never updates metrics, buffer bounded', () => {
  const d = new P.FrameDecoder();
  assert.equal(d.push('x'.repeat(9000)).length, 0);
  assert.ok(d.buffer.length <= 4096);
  assert.equal(d.push('\n101,3,2,9,0,0,9,').length, 1);
});
