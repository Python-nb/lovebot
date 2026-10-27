const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHandler } = require('../src/ingest');
const { EVENTS: clientEvents } = require('../../miniprogram/lib/diagnostics');
const { EVENTS: serverEvents } = require('../src/ingest');

async function fixture(enabled = true) {
  const logs = [];
  const server = http.createServer(createHandler({ enabled, log: (row) => logs.push(row) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = async (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/v1/ble-diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { logs, request, close: () => new Promise((resolve) => server.close(resolve)) };
}
const batch = () => ({
  id: 'a'.repeat(24),
  events: [{ event: 'start_requested', at: Date.now() }],
});
test('client and independent ingest accept exactly the same event names', () => {
  assert.deepEqual([...clientEvents].sort(), [...serverEvents].sort());
});

test('independent ingest fails closed and rejects extra identity or credential fields', async () => {
  const off = await fixture(false);
  try {
    assert.equal((await off.request(batch())).status, 404);
    assert.equal(off.logs.length, 0);
  } finally {
    await off.close();
  }
  const on = await fixture();
  try {
    assert.equal((await on.request({ ...batch(), token: 'private-token' })).status, 400);
    assert.equal(
      (
        await on.request({
          id: 'a'.repeat(24),
          events: [{ event: 'notify_raw', at: Date.now(), deviceId: 'private-device' }],
        })
      ).status,
      400,
    );
    assert.equal(on.logs.length, 0);
    assert.equal(
      (
        await on.request({
          id: 'a'.repeat(24),
          events: [{ event: 'notify_raw', at: Date.now(), sample: '313031' }],
        })
      ).status,
      400,
    );
    assert.equal((await on.request(batch())).status, 202);
    assert.equal(on.logs[0].id, 'a'.repeat(24));
    assert.doesNotMatch(JSON.stringify(on.logs), /private-/);
  } finally {
    await on.close();
  }
});

test('ingest rate limits repeated anonymous batches by diagnostic ID', async () => {
  const h = await fixture();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await h.request(batch())).status, 202);
    assert.equal((await h.request(batch())).status, 429);
    assert.equal(h.logs.length, 10);
  } finally {
    await h.close();
  }
});
