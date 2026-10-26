const { UUID, encode, decode, FrameDecoder } = require('./protocol');
const { authorize } = require('./privacy');
function call(api, name, args = {}) {
  return new Promise((resolve, reject) => api[name]({ ...args, success: resolve, fail: reject }));
}
class BleClient {
  constructor(api, events = {}) {
    this.api = api;
    this.events = events;
    this.decoder = new FrameDecoder();
    this.device = null;
    this.ready = false;
    this.scanning = false;
    this.scanTimer = null;
    this.scanGeneration = 0;
    this.disposed = false;
    this.onFound = (result) =>
      !this.disposed && events.devices && events.devices(result.devices || []);
    this.onValue = (event) => {
      if (
        this.disposed ||
        !this.ready ||
        !this.device ||
        event.deviceId !== this.device.deviceId ||
        event.characteristicId.toLowerCase() !== UUID.tx ||
        event.serviceId.toLowerCase() !== UUID.service
      )
        return;
      this.decoder
        .push(decode(event.value))
        .forEach((frame) => events.frame && events.frame(frame));
    };
    this.onConnection = (event) => {
      if (
        !this.disposed &&
        this.device &&
        event.deviceId === this.device.deviceId &&
        !event.connected
      ) {
        this.ready = false;
        this.device = null;
        events.disconnected && events.disconnected();
      }
    };
    api.onBluetoothDeviceFound(this.onFound);
    api.onBLECharacteristicValueChange(this.onValue);
    api.onBLEConnectionStateChange(this.onConnection);
  }
  async scan() {
    const generation = ++this.scanGeneration;
    await authorize(this.api);
    if (this.disposed || generation !== this.scanGeneration) return;
    await call(this.api, 'openBluetoothAdapter', { mode: 'central' });
    if (this.disposed || generation !== this.scanGeneration) return;
    // 不按名称猜设备。连接时严格核对服务与特征；部分固件未广播服务 UUID。
    await call(this.api, 'startBluetoothDevicesDiscovery', { allowDuplicatesKey: false });
    this.scanning = true;
    if (this.disposed || generation !== this.scanGeneration) {
      await this.stopScan();
      return;
    }
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => this.stopScan(), 12000);
    try {
      const known = await call(this.api, 'getBluetoothDevices');
      if (generation === this.scanGeneration) this.onFound(known);
    } catch (error) {
      await this.stopScan();
      throw error;
    }
  }
  async stopScan() {
    this.scanGeneration++;
    clearTimeout(this.scanTimer);
    this.scanTimer = null;
    if (this.scanning) {
      await call(this.api, 'stopBluetoothDevicesDiscovery').catch(() => {});
      this.scanning = false;
    }
    if (!this.disposed && this.events.scanEnd) this.events.scanEnd();
  }
  async connect(device) {
    await authorize(this.api);
    if (this.disposed) throw new Error('页面已关闭，请重新进入后连接设备。');
    await this.stopScan();
    if (this.device) await this.disconnect();
    this.device = device;
    this.decoder = new FrameDecoder();
    try {
      await call(this.api, 'createBLEConnection', { deviceId: device.deviceId, timeout: 10000 });
      const services = await call(this.api, 'getBLEDeviceServices', { deviceId: device.deviceId });
      const service = services.services.find((x) => x.uuid.toLowerCase() === UUID.service);
      if (!service) throw new Error('不是协议支持的发球机：未发现目标服务');
      this.serviceId = service.uuid;
      const result = await call(this.api, 'getBLEDeviceCharacteristics', {
        deviceId: device.deviceId,
        serviceId: this.serviceId,
      });
      const rx = result.characteristics.find((x) => x.uuid.toLowerCase() === UUID.rx);
      const tx = result.characteristics.find((x) => x.uuid.toLowerCase() === UUID.tx);
      if (
        !rx ||
        !(rx.properties.write || rx.properties.writeNoResponse) ||
        !tx ||
        !(tx.properties.notify || tx.properties.indicate)
      )
        throw new Error('设备特征不匹配，请核对固件版本');
      this.rx = rx.uuid;
      this.tx = tx.uuid;
      this.writeType = rx.properties.write ? 'write' : 'writeNoResponse';
      // 先置 ready，避免订阅成功后的首帧被丢弃。
      this.ready = true;
      await call(this.api, 'notifyBLECharacteristicValueChange', {
        deviceId: device.deviceId,
        serviceId: this.serviceId,
        characteristicId: this.tx,
        state: true,
      });
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }
  async send(command) {
    if (!this.ready || !this.device) throw new Error('蓝牙未连接');
    // 不重试：write 失败不代表设备一定没收到。
    await call(this.api, 'writeBLECharacteristicValue', {
      deviceId: this.device.deviceId,
      serviceId: this.serviceId,
      characteristicId: this.rx,
      writeType: this.writeType,
      value: encode(command),
    });
  }
  async readSignal() {
    const device = this.device;
    if (this.disposed || !this.ready || !device) return null;
    if (typeof this.api.getBLEDeviceRSSI !== 'function') return null;
    const { RSSI } = await call(this.api, 'getBLEDeviceRSSI', { deviceId: device.deviceId });
    // Drop readings for a connection that was replaced while the native call was pending.
    if (this.disposed || !this.ready || this.device !== device) return null;
    return Number.isInteger(RSSI) && RSSI >= -127 && RSSI <= 0 ? RSSI : null;
  }
  async disconnect() {
    this.ready = false;
    const device = this.device;
    this.device = null;
    if (device)
      await call(this.api, 'closeBLEConnection', { deviceId: device.deviceId }).catch(() => {});
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Unregister synchronously: native cleanup may finish after page unload.
    this.api.offBluetoothDeviceFound(this.onFound);
    this.api.offBLECharacteristicValueChange(this.onValue);
    this.api.offBLEConnectionStateChange(this.onConnection);
    await this.stopScan();
    await this.disconnect();
    await call(this.api, 'closeBluetoothAdapter').catch(() => {});
  }
}
module.exports = { BleClient };
