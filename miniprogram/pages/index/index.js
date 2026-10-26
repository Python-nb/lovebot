const P = require('../../lib/protocol');
const R = require('../../lib/records');
const T = require('../../lib/theme');
const Privacy = require('../../lib/privacy');
const AccountPage = require('../../lib/account-page');
const { BleClient } = require('../../lib/ble');
const live = (state) => ['starting', 'running', 'stopping'].includes(state);
const initial = () => ({
  ...AccountPage.initial(),
  tab: 'home',
  state: 'idle',
  busy: false,
  connected: false,
  deviceName: '尚未连接设备',
  signalDbm: null,
  signalLevel: 0,
  signalLabel: '信号待获取',
  theme: 'light',
  themePreference: 'system',
  themeChoices: T.choices,
  mode: 'free',
  targetTime: '10',
  targetCount: '100',
  shots: 0,
  hits: 0,
  seconds: 0,
  rate: '0.0',
  clock: '00:00:00',
  status: '准备好，投进下一球。',
  deviceSheet: false,
  dataInfoOpen: false,
  dataSections: Privacy.sections,
  devices: [],
  scanning: false,
  fullscreen: false,
  days: 7,
  rankPeriod: 1,
  rankMetric: 'shots',
  metric: 'shots',
  records: [],
  recent: [],
  ranking: [],
  total: R.summary([]),
  points: [],
  chartMax: 10,
  chartUnit: '个',
  selectedDay: '',
  dayRows: [],
  monthLabel: '',
  calendar: [],
  calendarMonth: 0,
  calendarYear: 0,
  nickname: '球场新朋友',
  editName: false,
  nameInput: '',
  sourceLabel: '设备训练记录',
  tabs: [
    { id: 'home', label: '首页', icon: 'ball-basketball' },
    { id: 'rank', label: '排行榜', icon: 'trophy' },
    { id: 'stats', label: '训练数据', icon: 'chart-bar' },
    { id: 'profile', label: '我的', icon: 'user' },
  ],
  modes: [
    { id: 'free', label: '自由模式', desc: '跟随节奏，自由投篮', no: '01' },
    { id: 'time', label: '定时模式', desc: '在限定时间内挑战自己', no: '02' },
    { id: 'count', label: '定数模式', desc: '每一球，都算数', no: '03' },
  ],
  metrics: [
    { id: 'shots', label: '发球数' },
    { id: 'hits', label: '进球数' },
    { id: 'rate', label: '命中率' },
    { id: 'seconds', label: '训练时长' },
  ],
  ranges: [
    { value: 7, label: '7 天' },
    { value: 30, label: '30 天' },
    { value: 365, label: '一年' },
  ],
  periods: [
    { value: 1, label: '今日' },
    { value: 7, label: '近 7 天' },
    { value: 30, label: '近 30 天' },
    { value: 365, label: '一年' },
  ],
});
Page({
  ...AccountPage.methods(wx),
  data: initial(),
  onLoad() {
    this.systemTheme = T.system(wx);
    this.setData({ themePreference: T.read(wx) });
    this.applyTheme();
    this.themeListener = ({ theme }) => {
      this.systemTheme = theme === 'dark' ? 'dark' : 'light';
      this.applyTheme();
    };
    if (wx.onThemeChange) wx.onThemeChange(this.themeListener);
    this.updateTitle();
    this.foreground = true;
    this.initAccount();
    this.frameAt = 0;
    this.currentFrame = null;
    this.timer = null;
    this.sessionId = null;
    const now = new Date();
    this.setData({
      calendarMonth: now.getMonth(),
      calendarYear: now.getFullYear(),
    });
    this.ble = new BleClient(wx, {
      devices: (rows) => {
        const map = new Map(this.data.devices.map((x) => [x.deviceId, x]));
        rows
          .filter((x) => x.name || x.localName)
          .forEach((x) =>
            map.set(x.deviceId, {
              deviceId: x.deviceId,
              name: x.name || x.localName,
              RSSI: x.RSSI,
              signal: x.RSSI > -65 ? '信号良好' : '靠近设备再连接',
            }),
          );
        this.setData({ devices: [...map.values()] });
      },
      scanEnd: () => this.setData({ scanning: false }),
      frame: (frame) => this.receive(frame),
      disconnected: () => {
        this.stopSignalPolling();
        this.setData({ connected: false, deviceName: '连接已断开' });
        this.frameAt = 0;
        if (live(this.data.state))
          this.interrupt('蓝牙断开，请现场停止设备并核对最终数据。不会自动重连或重发指令。');
      },
    });
    const draft = wx.getStorageSync(this.account.draftKey());
    if (draft && R.valid(draft)) {
      this.sessionId = draft.id;
      this.setData({
        mode: draft.mode,
        shots: draft.shots,
        hits: draft.hits,
        seconds: draft.seconds,
        state: 'interrupted',
        status: '发现上次未完成训练，数据尚未确认。请先现场确认设备已停止，再核对并保存。',
      });
      this.updateNumbers();
    }
    this.refresh();
  },
  onShow() {
    this.foreground = true;
    this.systemTheme = T.system(wx);
    this.applyTheme();
    this.startSignalPolling();
  },
  onHide() {
    this.foreground = false;
    this.clearAccountSecrets();
    wx.hideToast();
    this.stopSignalPolling();
    this.ble.stopScan();
    if (live(this.data.state)) {
      clearInterval(this.timer);
      this.timer = null;
      // 离开前仅尽力发送一次停止；不能把系统回调当作硬件停止保证。
      if (this.ble.ready) this.ble.send('Turn-off').catch(() => {});
      this.interrupt('小程序已离开前台，已尝试停止；请立即现场确认设备停止。');
    }
    wx.setKeepScreenOn({ keepScreenOn: false });
  },
  onUnload() {
    this.foreground = false;
    this.clearAccountSecrets();
    if (this.account) this.account.dispose();
    wx.hideToast();
    this.stopSignalPolling();
    clearInterval(this.timer);
    if (this.ble) this.ble.dispose();
    if (wx.offThemeChange && this.themeListener) wx.offThemeChange(this.themeListener);
  },
  applyTheme() {
    const theme = T.resolve(this.data.themePreference, this.systemTheme);
    this.setData({ theme });
    const colors = T.chrome(theme);
    if (wx.setNavigationBarColor)
      wx.setNavigationBarColor({
        frontColor: colors.frontColor,
        backgroundColor: colors.backgroundColor,
      });
    if (wx.setBackgroundColor)
      wx.setBackgroundColor({
        backgroundColor: colors.backgroundColor,
        backgroundColorTop: colors.backgroundColor,
        backgroundColorBottom: colors.backgroundColor,
      });
    if (wx.setBackgroundTextStyle)
      wx.setBackgroundTextStyle({ textStyle: colors.backgroundTextStyle });
  },
  selectTheme(e) {
    const preference = e.currentTarget.dataset.id;
    if (!T.valid(preference)) return;
    try {
      wx.setStorageSync(T.KEY, preference);
    } catch (_) {
      this.notify('外观偏好保存失败，请检查本机存储。');
      return;
    }
    this.setData({ themePreference: preference });
    this.applyTheme();
  },
  async task(fn) {
    if (this.data.busy) return;
    wx.hideToast();
    this.setData({ busy: true });
    try {
      await fn();
    } catch (e) {
      this.notify(e.message || e.errMsg || '操作失败，请检查权限后重试。');
    } finally {
      this.setData({ busy: false });
    }
  },
  notify(title) {
    if (!this.foreground) return;
    wx.showToast({ title, icon: 'none', duration: 3000, mask: false });
  },
  startSignalPolling() {
    this.stopSignalPolling();
    if (!this.foreground || !this.data.connected || !this.ble.ready) return;
    const generation = this.signalGeneration;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      let rssi = null;
      try {
        rssi = await this.ble.readSignal();
      } catch (_) {
        // Signal is optional telemetry; failure must not interrupt a valid BLE session.
      } finally {
        pending = false;
      }
      if (generation !== this.signalGeneration || !this.foreground || !this.data.connected) return;
      const level = rssi === null ? 0 : rssi >= -65 ? 3 : rssi >= -80 ? 2 : 1;
      this.setData({
        signalDbm: rssi,
        signalLevel: level,
        signalLabel: ['信号暂不可用', '信号较弱', '信号一般', '信号良好'][level],
      });
    };
    refresh();
    if (typeof wx.getBLEDeviceRSSI === 'function') this.signalTimer = setInterval(refresh, 10000);
  },
  stopSignalPolling() {
    clearInterval(this.signalTimer);
    this.signalTimer = null;
    this.signalGeneration = (this.signalGeneration || 0) + 1;
    this.setData({ signalDbm: null, signalLevel: 0, signalLabel: '信号待获取' });
  },
  updateTitle() {
    const titles = { home: '首页', rank: '排行榜', stats: '训练数据', profile: '我的' };
    if (wx.setNavigationBarTitle)
      wx.setNavigationBarTitle({ title: titles[this.data.tab] || '爱冠篮' });
  },
  switchTab(e) {
    wx.hideToast();
    this.setData({ tab: e.currentTarget.dataset.id });
    this.updateTitle();
    this.refresh();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  chooseMode(e) {
    if (this.data.state !== 'idle' || this.data.busy) return;
    this.setData({ mode: e.currentTarget.dataset.id });
  },
  targetInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  updateNumbers() {
    this.setData({
      rate: R.rate(this.data.shots, this.data.hits),
      clock: R.clock(this.data.seconds),
    });
  },
  draft() {
    return {
      id: this.sessionId,
      source: 'ble',
      mode: this.data.mode,
      shots: this.data.shots,
      hits: this.data.hits,
      seconds: this.data.seconds,
      endedAt: Date.now(),
    };
  },
  checkpoint() {
    try {
      wx.setStorageSync(this.account.draftKey(), this.draft());
      this.draftStorageFailed = false;
    } catch (_) {
      if (!this.draftStorageFailed)
        this.notify('本机草稿存储失败。请保持页面打开，结束时重试保存。');
      this.draftStorageFailed = true;
    }
  },
  receive(frame) {
    this.currentFrame = frame;
    this.frameAt = Date.now();
    if (['starting', 'running', 'stopping'].includes(this.data.state)) {
      this.setData({ shots: frame.shots, hits: frame.hits, seconds: frame.seconds });
      this.updateNumbers();
      this.checkpoint();
      if (this.data.state === 'running') this.checkLimit();
    }
  },
  async start() {
    if (this.data.state !== 'idle') return;
    await this.task(async () => {
      const { mode } = this.data;
      const target = mode === 'time' ? this.data.targetTime : this.data.targetCount;
      const command = P.setupCommand(mode, target);
      this.assertDeviceReady(mode);
      const result = await wx.showModal({
        title: '确认现场安全',
        content:
          '设备将开始发球。请确认无人靠近出球口。协议不含运行确认；指令发送成功不等于机器已开始工作。',
        confirmText: '确认并发送',
      });
      if (!result.confirm || !this.foreground) return;
      // 确认弹窗可能停留较久，发指令前重新核验连接和回传。
      this.assertDeviceReady(mode);
      this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.setData({ state: 'starting', shots: 0, hits: 0, seconds: 0, status: '正在发送指令…' });
      this.updateNumbers();
      this.checkpoint();
      try {
        if (command) await this.ble.send(command);
        if (this.data.state !== 'starting' || !this.foreground) return;
        await this.ble.send('Turn-on');
        if (this.data.state !== 'starting' || !this.foreground) return;
      } catch (_) {
        this.interrupt('指令结果不确定，请现场确认设备；不会自动重发。');
        return;
      }
      this.setData({ state: 'running', status: '启用指令已发送 · 请现场确认运行' });
      wx.setKeepScreenOn({ keepScreenOn: true });
      this.timer = setInterval(() => {
        if (this.data.state === 'running' && Date.now() - this.frameAt > 3500) {
          if (this.ble.ready) this.ble.send('Turn-off').catch(() => {});
          this.interrupt('超过 3.5 秒未收到回传，已尝试停止；请现场核对设备和数据。');
        }
      }, 1000);
    });
  },
  assertDeviceReady(mode) {
    if (!this.ble.ready) throw new Error('蓝牙未连接，无法开始训练。请先连接发球机。');
    if (!this.currentFrame || Date.now() - this.frameAt > 3500)
      throw new Error('尚无新鲜设备回传，请检查设备通知连接。');
    if (mode === 'free' && this.currentFrame.mode !== 0)
      throw new Error('协议没有切回自由模式的指令，请先在机器端切回自由模式。');
  },
  checkLimit() {
    const { mode, seconds, shots, targetTime, targetCount } = this.data;
    if (
      (mode === 'time' && seconds >= Number(targetTime) * 60) ||
      (mode === 'count' && shots >= Number(targetCount))
    )
      this.finish();
  },
  async finish() {
    if (this.data.busy || this.data.state === 'idle' || this.data.state === 'stopping') return;
    if (['review', 'interrupted'].includes(this.data.state)) return this.confirmSave();
    await this.task(async () => {
      clearInterval(this.timer);
      this.timer = null;
      this.setData({ state: 'stopping', status: '正在结束本次训练…' });
      try {
        await this.ble.send('Turn-off');
      } catch (_) {
        this.interrupt('停止指令结果不确定，请立即在现场停止设备。');
        return;
      }
      if (this.data.state !== 'stopping') return;
      this.setData({ state: 'review', status: '停止指令已发送，请核对设备和最终数据后保存。' });
      this.checkpoint();
      wx.setKeepScreenOn({ keepScreenOn: false });
    });
    if (this.data.state === 'review') await this.confirmSave();
  },
  interrupt(message) {
    clearInterval(this.timer);
    this.timer = null;
    this.setData({ state: 'interrupted', status: `训练中断 · ${message}` });
    this.notify(message);
    this.checkpoint();
  },
  async confirmSave() {
    await this.task(async () => {
      const res = await wx.showModal({
        title: '现场确认后保存',
        content: `请确认机器已经停止。当前回传 ${this.data.shots} 球 / 进球 ${this.data.hits} / ${this.data.clock}。协议未说明计数清零和时长单位，需现场核对。数据不符请取消，不要保存为最终成绩。`,
        confirmText: '已核对并保存',
        cancelText: '暂不保存',
      });
      if (!res.confirm) return;
      const row = {
        ...this.draft(),
        verifiedByUser: true,
        interrupted: this.data.state === 'interrupted',
      };
      R.save(this.account.storage(), row);
      wx.removeStorageSync(this.account.draftKey());
      this.sessionId = null;
      this.setData({ state: 'idle', status: '训练已保存。下一次，继续突破。' });
      this.refresh();
      this.refreshAccount();
      wx.showToast({ title: '已保存到本机', icon: 'success' });
    });
  },
  async discard() {
    if (!['review', 'interrupted'].includes(this.data.state)) return;
    await this.task(async () => {
      const res = await wx.showModal({
        title: '放弃本次未保存训练？',
        content:
          '请先现场确认机器已停止。只删除本次未保存草稿，不发送任何蓝牙指令，也不影响历史记录。',
        confirmText: '已停止，放弃',
        cancelText: '保留草稿',
      });
      if (!res.confirm) return;
      wx.removeStorageSync(this.account.draftKey());
      this.sessionId = null;
      this.setData({
        state: 'idle',
        shots: 0,
        hits: 0,
        seconds: 0,
        status: '本次草稿已放弃，历史记录未改变。',
      });
      this.updateNumbers();
      this.refresh();
    });
  },
  async openDevices() {
    if (this.data.state !== 'idle') {
      this.notify('请先结束并保存当前训练，再连接或切换设备。');
      return;
    }
    this.setData({ deviceSheet: true, devices: [] });
    await this.scanDevices();
  },
  async scanDevices() {
    await this.task(async () => {
      this.setData({ scanning: true });
      try {
        await this.ble.scan();
      } catch (e) {
        this.setData({ scanning: false });
        throw e;
      }
    });
  },
  closeDevices() {
    wx.hideToast();
    this.ble.stopScan();
    this.setData({ deviceSheet: false });
  },
  async connectDevice(e) {
    await this.task(async () => {
      const device = this.data.devices.find((d) => d.deviceId === e.currentTarget.dataset.id);
      if (!device) throw new Error('设备已不在列表，请重新搜索');
      this.frameAt = 0;
      this.currentFrame = null;
      this.stopSignalPolling();
      this.setData({ connected: false, deviceName: '尚未连接设备' });
      await this.ble.connect(device);
      this.setData({
        connected: true,
        deviceName: device.name,
        deviceSheet: false,
        status: '已连接，等待设备数据。',
      });
      this.startSignalPolling();
      this.refresh();
    });
  },
  async disconnect() {
    if (this.data.state !== 'idle') {
      this.notify('请先结束并保存训练，再断开设备。');
      return;
    }
    await this.task(async () => {
      this.stopSignalPolling();
      await this.ble.disconnect();
      this.frameAt = 0;
      this.currentFrame = null;
      this.setData({ connected: false, deviceName: '尚未连接设备' });
    });
  },
  selectRange(e) {
    this.setData({ days: Number(e.currentTarget.dataset.value) });
    this.refresh();
  },
  selectMetric(e) {
    this.setData({ metric: e.currentTarget.dataset.id });
    this.refresh();
  },
  rankFilter(e) {
    this.setData({
      [e.currentTarget.dataset.field]:
        e.currentTarget.dataset.field === 'rankPeriod'
          ? Number(e.currentTarget.dataset.value)
          : e.currentTarget.dataset.value,
    });
    this.refresh();
  },
  refresh() {
    const rows = R.load(this.account.storage());
    const visible = rows.filter((r) => r.endedAt >= R.since(this.data.days));
    const count = this.data.days === 365 ? 12 : this.data.days;
    // 年视图聚合到月；避免 365 个不可触达的细柱。
    let points;
    if (this.data.days === 365) {
      points = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 11 + i);
        const s = R.summary(
          visible.filter((r) => {
            const x = new Date(r.endedAt);
            return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
          }),
        );
        return { ...s, key: R.dayKey(d), label: `${d.getMonth() + 1}月` };
      });
    } else points = R.trend(visible, count);
    const metric = this.data.metric;
    const max = Math.max(
      metric === 'rate' ? 100 : metric === 'seconds' ? 60 : 10,
      ...points.map((p) => Number(p[metric])),
    );
    points = points.map((p, i) => ({
      ...p,
      value: metric === 'seconds' ? Math.round(p.seconds / 60) : p[metric],
      barStyle: `height: ${(Number(p[metric]) / max) * 100}%;`,
      showLabel: count <= 12 || i % 5 === 0 || i === count - 1,
    }));
    const ranking = rows
      .filter((r) => r.endedAt >= R.since(this.data.rankPeriod))
      .sort((a, b) => {
        const val = (x) =>
          this.data.rankMetric === 'rate'
            ? Number(R.rate(x.shots, x.hits))
            : x[this.data.rankMetric];
        return val(b) - val(a) || b.endedAt - a.endedAt;
      })
      .slice(0, 50)
      .map((r, i) => ({
        ...this.present(r),
        rank: String(i + 1).padStart(2, '0'),
        score:
          this.data.rankMetric === 'rate'
            ? `${R.rate(r.shots, r.hits)}%`
            : this.data.rankMetric === 'seconds'
              ? R.clock(r.seconds)
              : `${r[this.data.rankMetric]} 球`,
      }));
    this.setData({
      records: rows,
      total: R.summary(visible),
      recent: rows.slice(0, 5).map((r) => this.present(r)),
      ranking,
      points,
      chartMax: metric === 'seconds' ? Math.round(max / 60) : max,
      chartUnit: metric === 'rate' ? '%' : metric === 'seconds' ? '分钟' : '球',
      sourceLabel: '设备训练记录',
    });
    this.buildCalendar(rows);
  },
  present(r) {
    return {
      ...r,
      title: R.MODES[r.mode],
      date: `${R.dayKey(r.endedAt)} ${new Date(r.endedAt).toTimeString().slice(0, 5)}`,
      rate: R.rate(r.shots, r.hits),
      duration: R.clock(r.seconds),
    };
  },
  buildCalendar(rows) {
    const y = this.data.calendarYear,
      m = this.data.calendarMonth;
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const n = new Date(y, m + 1, 0).getDate();
    const calendar = Array.from({ length: Math.ceil((offset + n) / 7) * 7 }, (_, i) => {
      const day = i - offset + 1;
      if (day < 1 || day > n) return { key: `blank-${i}`, day: '', empty: true };
      const key = R.dayKey(new Date(y, m, day));
      const sessions = rows.filter((r) => R.dayKey(r.endedAt) === key);
      return {
        key,
        day,
        trained: sessions.length > 0,
        today: key === R.dayKey(new Date()),
        selected: key === this.data.selectedDay,
      };
    });
    this.setData({
      monthLabel: `${y} 年 ${m + 1} 月`,
      calendar,
      dayRows: rows
        .filter((r) => R.dayKey(r.endedAt) === this.data.selectedDay)
        .map((r) => this.present(r)),
    });
  },
  monthChange(e) {
    const d = new Date(
      this.data.calendarYear,
      this.data.calendarMonth + Number(e.currentTarget.dataset.step),
      1,
    );
    this.setData({ calendarMonth: d.getMonth(), calendarYear: d.getFullYear(), selectedDay: '' });
    this.refresh();
  },
  pickDay(e) {
    this.setData({ selectedDay: e.currentTarget.dataset.key });
    this.refresh();
  },
  openScreen() {
    this.setData({ fullscreen: true });
    wx.setKeepScreenOn({ keepScreenOn: true });
  },
  closeScreen() {
    this.setData({ fullscreen: false });
    wx.setKeepScreenOn({ keepScreenOn: live(this.data.state) });
  },
  async rename() {
    if (!this.accountIdle()) return;
    await this.task(async () => {
      const res = await wx.showModal({
        title: '设置训练昵称',
        editable: true,
        placeholderText: '1–16 个字符',
        content: this.data.nickname,
      });
      if (res.confirm && this.foreground && res.content && res.content.trim()) {
        const nickname = res.content.trim().slice(0, 16);
        if (this.account.user) {
          await this.account.rename(nickname);
          this.accountVerified = true;
          this.refreshAccount();
        } else wx.setStorageSync('courtside.nickname', nickname);
        this.setData({ nickname });
      }
    });
  },
  help() {
    wx.showModal({
      title: '连接与安全说明',
      content:
        '支持交互 V2 的 BLE 发球机。打开手机蓝牙，按系统提示授予微信附近设备权限；Android 系统可能还需定位开关。本小程序不读取地理位置。先确认现场安全再启动。切后台可能中断蓝牙，紧急情况优先使用机器实体停止开关。',
      showCancel: false,
    });
  },
  async privacy() {
    try {
      await Privacy.openContract(wx);
    } catch (error) {
      this.notify(error.message);
    }
  },
  openDataInfo() {
    wx.hideToast();
    this.setData({ dataInfoOpen: true });
  },
  closeDataInfo() {
    wx.hideToast();
    this.setData({ dataInfoOpen: false });
  },
  async deleteRecords() {
    if (this.data.state !== 'idle' || this.data.busy) {
      this.notify('请先结束并核对当前训练，再管理已保存的记录。');
      return;
    }
    await this.task(async () => {
      const result = await wx.showModal({
        title: '删除本机训练记录？',
        content: this.account.user
          ? '仅删除当前账号的本机缓存和待同步记录，不删除云端记录，下次同步可下载云端已有记录。不影响游客及其他账号。'
          : '将删除游客本机全部已保存成绩，且无法恢复。不修改昵称或外观，不发送蓝牙指令。',
        confirmText: '确认删除',
        confirmColor: '#b42318',
        cancelText: '取消',
      });
      if (!result.confirm || !this.foreground || this.data.state !== 'idle') return;
      this.account.storage().removeStorageSync(R.KEY);
      this.refresh();
      this.refreshAccount();
      this.notify('本机训练记录已删除');
    });
  },
  castHelp() {
    wx.showModal({
      title: '训练大屏',
      content:
        '大屏是小程序内的数据看板，不包含电视投屏协议。电视显示请使用手机系统的屏幕镜像功能，设备是否支持由手机与电视决定。',
      showCancel: false,
    });
  },
});
