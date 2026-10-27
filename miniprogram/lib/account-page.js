const { AccountClient } = require('./account');
const Privacy = require('./privacy');
const R = require('./records');
const initial = () => ({
  accountUser: null,
  accountStatus: '未登录',
  accountSheet: false,
  accountView: 'login',
  registerMethod: 'username',
  accountAccepted: false,
  phoneEnabled: false,
  usernameEnabled: false,
  usernameInput: '',
  phoneInput: '',
  loginPassword: '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  showPassword: false,
  resetPhoneReady: false,
  syncLabel: '游客单次使用 · 结果不保存或上传',
  guestCount: 0,
});
function methods(wx) {
  return {
    initAccount() {
      this.account = new AccountClient(wx);
      this.accountVerified = false;
      this.refreshAccount();
    },
    refreshAccount() {
      const user = this.account.user;
      let pending = false;
      try {
        pending = user && this.account.snapshot().pending.length > 0;
      } catch (error) {
        this.notify(error.message);
      }
      this.setData({
        accountUser: user,
        accountStatus: user
          ? !this.account.active
            ? '登录已失效，请重新登录'
            : this.accountVerified
              ? '已登录'
              : '登录凭证待校验'
          : '未登录',
        nickname: user?.nickname || wx.getStorageSync('courtside.nickname') || '球场新朋友',
        guestCount: R.load(wx).filter((r) => r.verifiedByUser === true).length,
        syncLabel: user
          ? pending
            ? '本机有待同步记录'
            : '账号缓存 · 可手动同步'
          : '游客单次使用 · 结果不保存或上传',
      });
    },
    accountIdle() {
      if (this.data.state !== 'idle' || this.data.busy) {
        this.notify('请先结束并核对当前训练，再操作账号或同步数据');
        return false;
      }
      return true;
    },
    async openAccount() {
      if (!this.accountIdle()) return;
      this.setData({
        accountSheet: true,
        accountView: this.account.user ? 'security' : 'login',
        accountAccepted: false,
      });
      this.clearAccountSecrets();
      await this.task(async () => {
        try {
          const caps = await this.account.capabilities();
          this.setData({
            phoneEnabled: caps.phoneEnabled === true,
            usernameEnabled: caps.usernameEnabled === true,
            registerMethod: 'username',
          });
          if (this.account.user) {
            await this.account.verify();
            this.accountVerified = true;
          }
        } finally {
          this.refreshAccount();
        }
      });
    },
    closeAccount() {
      if (this.data.busy) return;
      wx.hideToast();
      this.clearAccountSecrets();
      this.setData({ accountSheet: false, accountAccepted: false });
    },
    accountView(e) {
      if (this.data.busy) return;
      this.clearAccountSecrets();
      this.setData({ accountView: e.currentTarget.dataset.view, accountAccepted: false });
    },
    selectRegisterMethod(e) {
      if (this.data.busy) return;
      const method = e.currentTarget.dataset.method;
      if (!['username', 'wechat'].includes(method)) return;
      this.clearAccountSecrets();
      this.setData({ registerMethod: method, accountAccepted: false });
    },
    accountInput(e) {
      if (this.data.busy) return;
      const field = e.currentTarget.dataset.field;
      if (
        ![
          'phoneInput',
          'usernameInput',
          'loginPassword',
          'currentPassword',
          'newPassword',
          'confirmPassword',
        ].includes(field)
      )
        return;
      this.setData({ [field]: e.detail.value });
    },
    toggleAccountConsent() {
      if (!this.data.busy) this.setData({ accountAccepted: !this.data.accountAccepted });
    },
    togglePassword() {
      this.setData({ showPassword: !this.data.showPassword });
    },
    clearAccountSecrets() {
      this.resetPhoneCode = null;
      this.setData({
        phoneInput: '',
        usernameInput: '',
        loginPassword: '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        showPassword: false,
        resetPhoneReady: false,
      });
    },
    async loginWechat() {
      if (!this.accountIdle()) return;
      await this.task(async () => {
        if (!this.data.accountAccepted) throw new Error('请先阅读并同意账号与数据说明');
        this.account.assertConfigured();
        await Privacy.authorize(wx);
        await this.account.wechatLogin(true);
        this.accountVerified = true;
        this.refreshAccount();
        this.restoreAccountDraft();
        this.refresh();
        this.setData({ accountView: 'security', accountAccepted: false });
        this.notify('微信登录成功');
      });
      this.clearAccountSecrets();
    },
    async loginWithPassword() {
      if (!this.accountIdle()) return;
      const { phoneInput, loginPassword, accountAccepted } = this.data;
      await this.task(async () => {
        if (!accountAccepted) throw new Error('请先阅读并同意账号与数据说明');
        this.account.assertConfigured();
        await Privacy.authorize(wx);
        await this.account.passwordLogin(phoneInput, loginPassword, true);
        this.accountVerified = true;
        this.refreshAccount();
        this.restoreAccountDraft();
        this.refresh();
        this.setData({ accountView: 'security', accountAccepted: false, phoneInput: '' });
        this.notify('登录成功');
      });
      this.clearAccountSecrets();
    },
    async registerWithPhone(e) {
      if (
        !this.accountIdle() ||
        !this.foreground ||
        this.data.accountView !== 'register' ||
        this.data.registerMethod !== 'wechat'
      )
        return;
      const { newPassword, confirmPassword, accountAccepted, phoneEnabled } = this.data;
      const phoneCode = e.detail?.code;
      await this.task(async () => {
        if (!accountAccepted) throw new Error('请先阅读并同意账号与数据说明');
        if (!phoneEnabled) throw new Error('运营方尚未开通微信手机号能力，暂不能注册');
        if (!phoneCode) throw new Error('未授权手机号，注册未完成');
        if (newPassword !== confirmPassword) throw new Error('两次密码不一致');
        this.account.assertConfigured();
        await Privacy.authorize(wx);
        if (!this.foreground || !this.data.accountSheet || this.data.accountView !== 'register')
          throw new Error('账号面板已关闭，本次操作已取消');
        await this.account.register(phoneCode, newPassword, true);
        this.accountVerified = true;
        this.refreshAccount();
        this.restoreAccountDraft();
        this.refresh();
        this.setData({ accountView: 'security', accountAccepted: false });
        this.notify('注册成功，已登录');
      });
      this.clearAccountSecrets();
    },
    async submitUsername() {
      if (!this.accountIdle() || !this.foreground) return;
      const {
        usernameInput,
        loginPassword,
        newPassword,
        confirmPassword,
        accountAccepted,
        usernameEnabled,
        accountView,
        registerMethod,
      } = this.data;
      await this.task(async () => {
        if (!usernameEnabled) throw new Error('账号密码服务尚未开放');
        if (!accountAccepted) throw new Error('请先阅读并同意账号与数据说明');
        const registering = accountView === 'register' && registerMethod === 'username';
        if (registering && newPassword !== confirmPassword) throw new Error('两次密码不一致');
        this.account.assertConfigured();
        await Privacy.authorize(wx);
        if (!this.foreground || !this.data.accountSheet || this.data.accountView !== accountView)
          return;
        if (registering) await this.account.usernameRegister(usernameInput, newPassword, true);
        else await this.account.usernameLogin(usernameInput, loginPassword, true);
        this.accountVerified = true;
        this.refreshAccount();
        this.restoreAccountDraft();
        this.refresh();
        this.setData({ accountView: 'security', accountAccepted: false });
        this.notify(registering ? '注册成功，已登录' : '登录成功');
        this.clearAccountSecrets();
      });
    },
    restoreAccountDraft() {
      this.sessionId = null;
      this.guestSession = null;
      this.completedSession = false;
      this.frameAt = 0;
      this.setData({ shots: 0, hits: 0, seconds: 0, state: 'idle', status: '' });
      this.updateNumbers();
      const draft = this.account.user ? wx.getStorageSync(this.account.draftKey()) : null;
      if (draft && R.valid(draft)) {
        this.sessionId = draft.id;
        this.setData({
          mode: draft.mode,
          shots: draft.shots,
          hits: draft.hits,
          seconds: draft.seconds,
          state: 'interrupted',
          status: '发现此账号未完成训练，请先现场确认设备已停止，再核对并保存。',
        });
        this.updateNumbers();
        this.setData({ accountSheet: false });
      }
    },
    async bindAccountPhone(e) {
      if (!this.accountIdle()) return;
      if (!e.detail?.code) {
        this.notify('未授权手机号，绑定未完成');
        return;
      }
      await this.task(async () => {
        await this.account.bindPhone(e.detail.code);
        this.refreshAccount();
        this.notify('手机号已绑定，可设置登录密码');
      });
    },
    authorizeResetPhone(e) {
      if (!this.accountIdle() || !this.foreground || this.data.accountView !== 'reset') return;
      this.clearAccountSecrets();
      if (!e.detail?.code) {
        this.notify('未授权已绑定手机号，重置未开始');
        return;
      }
      // Single-use code stays only in controller memory, never page data or storage.
      this.resetPhoneCode = { code: e.detail.code, until: Date.now() + 240000 };
      this.setData({ resetPhoneReady: true });
    },
    async saveAccountPassword() {
      if (!this.accountIdle()) return;
      const { newPassword, confirmPassword, currentPassword, accountView } = this.data;
      await this.task(async () => {
        if (newPassword !== confirmPassword) throw new Error('两次新密码不一致');
        if (accountView === 'reset') {
          const phone = this.resetPhoneCode;
          this.resetPhoneCode = null;
          if (!phone || phone.until <= Date.now()) throw new Error('请重新授权已绑定手机号后重置');
          await this.account.resetPassword(newPassword, phone.code);
        } else await this.account.setPassword(newPassword, currentPassword);
        this.accountVerified = true;
        this.refreshAccount();
        this.setData({ accountView: 'security' });
        this.notify('密码已更新，其他登录凭证已失效');
      });
      this.clearAccountSecrets();
    },
    async syncAccountRecords() {
      if (!this.accountIdle()) return;
      await this.task(async () => {
        this.setData({ syncLabel: '正在同步…' });
        try {
          await this.account.verify();
          this.accountVerified = true;
          const count = await this.account.sync();
          this.refresh();
          this.refreshAccount();
          this.setData({ syncLabel: `已同步 ${count} 条账号记录` });
          this.notify('账号记录同步完成');
        } catch (e) {
          this.setData({ syncLabel: '同步未完成，本机记录保留' });
          throw e;
        }
      });
    },
    async importGuestRecords() {
      if (!this.accountIdle()) return;
      await this.task(async () => {
        const result = await wx.showModal({
          title: '导入游客训练记录？',
          content:
            '仅导入旧版本已保存的游客本机记录，不包含现在的单次训练。仅当这些记录属于你时确认；会复制到当前账号待同步记录，原件仍保留。',
          confirmText: '属于我，导入',
        });
        if (!result.confirm || !this.foreground) return;
        const count = this.account.importGuest();
        this.refresh();
        this.refreshAccount();
        this.notify(`已导入 ${count} 条，请点击同步上传`);
      });
    },
    async logoutAccount() {
      if (!this.accountIdle()) return;
      await this.task(async () => {
        const result = await wx.showModal({
          title: '退出当前账号？',
          content:
            '本机账号缓存和未同步记录仍按账号保留。退出后进入游客单次使用；旧版游客记录保留但不会自动展示或上传。',
        });
        if (!result.confirm || !this.foreground) return;
        await this.account.logout();
        this.accountVerified = false;
        this.refreshAccount();
        this.restoreAccountDraft();
        this.refresh();
        this.clearAccountSecrets();
        this.setData({ accountSheet: false });
        this.notify('已退出登录');
      });
    },
    async deleteCloudData() {
      if (!this.accountIdle()) return;
      await this.task(async () => {
        const result = await wx.showModal({
          title: '删除账号全部训练记录？',
          content:
            '删除当前账号的云端记录、本机账号缓存和待同步记录，不影响游客或其他账号。不可恢复。',
          confirmText: '确认删除',
          confirmColor: '#b42318',
        });
        if (!result.confirm || !this.foreground) return;
        await this.account.deleteCloudRecords();
        this.refresh();
        this.refreshAccount();
        this.notify('账号训练记录已删除');
      });
    },
    async deleteAccount() {
      if (!this.accountIdle()) return;
      await this.task(async () => {
        const result = await wx.showModal({
          title: '确认注销当前账号？',
          content:
            '永久删除此账号、登录凭据及云端训练记录，所有会话失效。请先重新登录微信或账号（5 分钟内有效）；不影响游客数据。',
          confirmText: '确认注销',
          confirmColor: '#b42318',
        });
        if (!result.confirm || !this.foreground) return;
        await this.account.deleteAccount();
        this.accountVerified = false;
        this.refreshAccount();
        this.restoreAccountDraft();
        this.refresh();
        this.clearAccountSecrets();
        this.setData({ accountSheet: false });
        this.notify('账号已注销');
      });
    },
  };
}
module.exports = { initial, methods };
