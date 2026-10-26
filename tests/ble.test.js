const test = require('node:test');
const assert = require('node:assert/strict');
const { BleClient } = require('../miniprogram/lib/ble');
const { UUID, encode, decode } = require('../miniprogram/lib/protocol');
function mock() {
  const calls = [],
    handlers = {};
  const api = {
    requirePrivacyAuthorize: (o) => o.success({}),
    onBluetoothDeviceFound: (f) => (handlers.found = f),
    onBLECharacteristicValueChange: (f) => (handlers.value = f),
    onBLEConnectionStateChange: (f) => (handlers.connection = f),
    offBluetoothDeviceFound: () => {},
    offBLECharacteristicValueChange: () => {},
    offBLEConnectionStateChange: () => {},
  };
  for (const name of [
    'openBluetoothAdapter',
    'startBluetoothDevicesDiscovery',
    'stopBluetoothDevicesDiscovery',
    'createBLEConnection',
    'notifyBLECharacteristicValueChange',
    'writeBLECharacteristicValue',
    'closeBLEConnection',
    'closeBluetoothAdapter',
  ])
    api[name] = (o) => {
      calls.push([name, o]);
      o.success({});
    };
  api.getBluetoothDevices = (o) => o.success({ devices: [] });
  api.getBLEDeviceServices = (o) => o.success({ services: [{ uuid: UUID.service.toUpperCase() }] });
  api.getBLEDeviceCharacteristics = (o) =>
    o.success({
      characteristics: [
        { uuid: UUID.rx, properties: { write: true } },
        { uuid: UUID.tx, properties: { notify: true } },
      ],
    });
  return { api, calls, handlers };
}
test('connection validates UUIDs and subscribes without starting hardware', async () => {
  const h = mock();
  const client = new BleClient(h.api);
  await client.connect({ deviceId: 'test' });
  assert.equal(client.ready, true);
  assert.equal(h.calls.filter((x) => x[0] === 'writeBLECharacteristicValue').length, 0);
  assert.equal(h.calls.filter((x) => x[0] === 'notifyBLECharacteristicValueChange').length, 1);
  await client.dispose();
});
test('privacy rejection prevents scanning and connecting before Bluetooth is accessed', async () => {
  const h = mock();
  h.api.requirePrivacyAuthorize = (o) => o.fail({ errMsg: 'user rejected privacy' });
  const client = new BleClient(h.api);
  await assert.rejects(client.scan(), /未完成隐私授权/);
  await assert.rejects(client.connect({ deviceId: 'test' }), /未完成隐私授权/);
  assert.equal(h.calls.length, 0);
  assert.equal(client.ready, false);
  assert.equal(client.scanTimer, null);
});
test('closing discovery while platform authorization is pending never starts a late scan', async () => {
  const h = mock();
  let agree;
  h.api.requirePrivacyAuthorize = (o) => (agree = o.success);
  const client = new BleClient(h.api);
  const pending = client.scan();
  await client.stopScan();
  agree({});
  await pending;
  assert.equal(client.scanning, false);
  assert.equal(client.scanTimer, null);
  assert.equal(h.calls.length, 0);
  await client.dispose();
});
test('wrong service closes connection and never writes', async () => {
  const h = mock();
  h.api.getBLEDeviceServices = (o) => o.success({ services: [] });
  const client = new BleClient(h.api);
  await assert.rejects(client.connect({ deviceId: 'test' }), /未发现/);
  assert.equal(client.ready, false);
  assert.ok(h.calls.some((x) => x[0] === 'closeBLEConnection'));
});
test('wrong characteristic properties rejected', async () => {
  const h = mock();
  h.api.getBLEDeviceCharacteristics = (o) =>
    o.success({
      characteristics: [
        { uuid: UUID.rx, properties: {} },
        { uuid: UUID.tx, properties: { read: true } },
      ],
    });
  await assert.rejects(new BleClient(h.api).connect({ deviceId: 'test' }), /特征/);
});
test('write error has exactly one attempt', async () => {
  const h = mock();
  const client = new BleClient(h.api);
  await client.connect({ deviceId: 'test' });
  let attempts = 0;
  h.api.writeBLECharacteristicValue = (o) => {
    attempts++;
    assert.equal(decode(o.value), 'Turn-on');
    o.fail(Error('unknown'));
  };
  await assert.rejects(client.send('Turn-on'), /unknown/);
  assert.equal(attempts, 1);
});
test('foreign device/service notifications ignored', async () => {
  const h = mock();
  let frames = 0;
  const client = new BleClient(h.api, { frame: () => frames++ });
  await client.connect({ deviceId: 'test' });
  const event = {
    deviceId: 'test',
    serviceId: UUID.service,
    characteristicId: UUID.tx,
    value: encode('101,1,1,3,0,0,9,'),
  };
  h.handlers.value({ ...event, deviceId: 'other' });
  h.handlers.value({ ...event, serviceId: 'other' });
  assert.equal(frames, 0);
  h.handlers.value(event);
  assert.equal(frames, 1);
});
test('disconnected BLE cannot send', async () => {
  const h = mock();
  const client = new BleClient(h.api);
  await client.connect({ deviceId: 'test' });
  h.handlers.connection({ deviceId: 'test', connected: false });
  await assert.rejects(client.send('Turn-on'), /未连接/);
});
test('RSSI reads the current connection without sending a control command', async () => {
  const h = mock();
  h.api.getBLEDeviceRSSI = (options) => {
    assert.equal(options.deviceId, 'test');
    options.success({ RSSI: -62 });
  };
  const client = new BleClient(h.api);
  assert.equal(await client.readSignal(), null);
  await client.connect({ deviceId: 'test' });
  assert.equal(await client.readSignal(), -62);
  assert.equal(h.calls.filter(([name]) => name === 'writeBLECharacteristicValue').length, 0);
  await client.dispose();
  assert.equal(await client.readSignal(), null);
});
test('RSSI absence, invalid responses and unsupported API never invent a reading', async () => {
  const h = mock();
  const client = new BleClient(h.api);
  await client.connect({ deviceId: 'test' });
  assert.equal(await client.readSignal(), null);
  for (const RSSI of [undefined, null, '0', NaN, Infinity, -128, 1, 127, -62.5]) {
    h.api.getBLEDeviceRSSI = (options) => options.success({ RSSI });
    assert.equal(await client.readSignal(), null);
  }
  h.api.getBLEDeviceRSSI = (options) => options.fail(Error('unavailable'));
  await assert.rejects(client.readSignal(), /unavailable/);
  assert.equal(client.ready, true);
  await client.dispose();
});
test('late RSSI is ignored after switching or disconnecting the device', async () => {
  const h = mock();
  const client = new BleClient(h.api);
  await client.connect({ deviceId: 'first' });
  let complete;
  h.api.getBLEDeviceRSSI = (options) => (complete = () => options.success({ RSSI: -55 }));
  const first = client.readSignal();
  await client.connect({ deviceId: 'second' });
  complete();
  assert.equal(await first, null);
  const second = client.readSignal();
  h.handlers.connection({ deviceId: 'second', connected: false });
  complete();
  assert.equal(await second, null);
  await client.dispose();
});
test('scan and dispose stop scanner and unregister handlers', async () => {
  const h = mock();
  const client = new BleClient(h.api);
  await client.scan();
  assert.equal(client.scanning, true);
  await client.dispose();
  assert.equal(client.scanTimer, null);
  assert.equal(client.scanning, false);
});
test('failed device enumeration stops discovery immediately and preserves the error', async () => {
  const h = mock();
  const failure = Error('device list failed');
  h.api.getBluetoothDevices = (o) => o.fail(failure);
  const client = new BleClient(h.api);
  await assert.rejects(client.scan(), (error) => error === failure);
  assert.equal(client.scanning, false);
  assert.equal(client.scanTimer, null);
  assert.equal(h.calls.filter(([name]) => name === 'stopBluetoothDevicesDiscovery').length, 1);
  await client.dispose();
});
test('dispose detaches handlers before awaiting native cleanup and ignores late callbacks', async () => {
  const h = mock();
  let callbacks = 0;
  const detached = [];
  for (const name of [
    'offBluetoothDeviceFound',
    'offBLECharacteristicValueChange',
    'offBLEConnectionStateChange',
  ])
    h.api[name] = () => detached.push(name);
  const client = new BleClient(h.api, {
    devices: () => callbacks++,
    scanEnd: () => callbacks++,
    disconnected: () => callbacks++,
  });
  await client.scan();
  callbacks = 0;
  let finishStop;
  h.api.stopBluetoothDevicesDiscovery = (o) => {
    finishStop = () => o.success({});
  };
  const disposing = client.dispose();
  assert.equal(detached.length, 3);
  h.handlers.found({ devices: [{ deviceId: 'late' }] });
  h.handlers.connection({ deviceId: 'late', connected: false });
  assert.equal(callbacks, 0);
  finishStop();
  await disposing;
  await client.dispose();
  assert.equal(detached.length, 3);
  assert.equal(callbacks, 0);
});
