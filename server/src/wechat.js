const { fail, text } = require('./security');
function createWechat({ appId, appSecret, phoneEnabled, fetcher = fetch }) {
  let cachedToken,
    tokenUntil = 0,
    inflight;
  async function request(path, body) {
    let result;
    try {
      const response = await fetcher(`https://api.weixin.qq.com${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('upstream');
      result = await response.json();
    } catch (_) {
      fail(502, 'WECHAT_UNAVAILABLE', '微信服务暂不可用，请重新操作');
    }
    if (result.errcode) fail(400, 'WECHAT_REJECTED', '微信凭证已失效或能力未开通，请重新授权');
    return result;
  }
  async function accessToken() {
    if (cachedToken && Date.now() < tokenUntil) return cachedToken;
    if (!inflight)
      inflight = (async () => {
        const result = await request('/cgi-bin/stable_token', {
          grant_type: 'client_credential',
          appid: appId,
          secret: appSecret,
          force_refresh: false,
        });
        if (!text(result.access_token, 1024) || !Number.isFinite(result.expires_in))
          fail(502, 'WECHAT_RESPONSE', '微信服务返回异常');
        cachedToken = result.access_token;
        tokenUntil = Date.now() + Math.max(0, result.expires_in - 120) * 1000;
        return cachedToken;
      })().finally(() => {
        inflight = null;
      });
    return inflight;
  }
  return {
    async login(code) {
      if (!text(code)) fail(400, 'INPUT', '登录凭证无效');
      const query = new URLSearchParams({
        appid: appId,
        secret: appSecret,
        js_code: code,
        grant_type: 'authorization_code',
      });
      const result = await request(`/sns/jscode2session?${query}`);
      if (!text(result.openid, 128)) fail(502, 'WECHAT_RESPONSE', '微信登录返回异常');
      // session_key is neither returned to the client nor persisted or logged.
      return result.openid;
    },
    async phone(code) {
      if (!phoneEnabled) fail(503, 'PHONE_DISABLED', '手机号授权尚未开通，请联系运营方');
      if (!text(code)) fail(400, 'INPUT', '手机号凭证无效');
      const token = await accessToken();
      const result = await request(
        `/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`,
        { code },
      );
      const p = result.phone_info;
      if (
        !p ||
        String(p.countryCode) !== '86' ||
        !/^1[3-9]\d{9}$/.test(p.purePhoneNumber) ||
        p.watermark?.appid !== appId ||
        !Number.isFinite(p.watermark?.timestamp) ||
        Math.abs(Date.now() / 1000 - p.watermark.timestamp) > 600
      )
        fail(400, 'PHONE_INVALID', '暂仅支持中国大陆手机号，请重新授权');
      return p.purePhoneNumber;
    },
  };
}
module.exports = { createWechat };
