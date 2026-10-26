const { AccountClient } = require('./account');
const Privacy = require('./privacy');
const R = require('./records');
const initial = () => ({
  accountUser: null,
  accountStatus: '未登录',
  accountSubtitle: '微信登录 / 手机号密码登录',
  accountSheet: false,
  accountView: 'login',
  accountAccepted: false,
  phoneEnabled: false,
  phoneInput: '',
  loginPassword: '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  showPassword: false,
  resetPhoneReady: false,
  syncLabel: '游客记录仅本机保存',
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
        accountSubtitle: user
          ? user.phoneMasked || '微信账号 · 未绑定手机号'
          : '微信登录 / 手机号密码登录',
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
          : '游客记录仅本机保存',
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
          this.setData({ phoneEnabled: caps.phoneEnabled === true });
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
    accountInput(e) {
      if (this.data.busy) return;
      const field = e.currentTarget.dataset.field;
      if (
        ![
          'phoneInput',
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
    restoreAccountDraft() {
      this.sessionId = null;
      this.frameAt = 0;
      this.setData({ shots: 0, hits: 0, seconds: 0, state: 'idle', status: '' });
      this.updateNumbers();
      const draft = wx.getStorageSync(this.account.draftKey());
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
            '仅当这些记录属于你时确认。将复制到当前账号的待同步记录；原游客记录保留，不自动合并其他账号。',
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
          content: '本机账号缓存和未同步记录仍按账号保留。退出后只显示游客数据。',
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
            '永久删除此账号、手机号绑定、密码及云端训练记录，所有会话失效。请先在本页重新微信登录（5 分钟内有效）；不影响游客数据。',
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
