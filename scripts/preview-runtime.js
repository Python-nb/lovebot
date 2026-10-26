/* Browser-only development adapter. Not included in miniprogramRoot. */
(() => {
  let page,
    renderPending = false,
    toastTimer = null;
  const root = document.getElementById('root');
  const localKey = (k) => 'courtside-preview:' + k;
  const callbacks = {};
  const wx = {
    getStorageSync: (k) => JSON.parse(localStorage.getItem(localKey(k)) || 'null'),
    setStorageSync: (k, v) => localStorage.setItem(localKey(k), JSON.stringify(v)),
    removeStorageSync: (k) => localStorage.removeItem(localKey(k)),
    getAppBaseInfo: () => ({
      theme:
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light',
    }),
    onThemeChange: (fn) => {
      if (!window.matchMedia) return;
      callbacks.themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      callbacks.themeListener = (e) => fn({ theme: e.matches ? 'dark' : 'light' });
      callbacks.themeQuery.addEventListener('change', callbacks.themeListener);
    },
    offThemeChange: () => {
      if (callbacks.themeQuery)
        callbacks.themeQuery.removeEventListener('change', callbacks.themeListener);
    },
    setKeepScreenOn: () => {},
    pageScrollTo: () => window.scrollTo(0, 0),
    hideToast: () => {
      clearTimeout(toastTimer);
      toastTimer = null;
      document.getElementById('toast').style.display = 'none';
    },
    showToast: ({ title, duration = 1500 }) => {
      wx.hideToast();
      const t = document.getElementById('toast');
      t.textContent = title;
      t.style.display = 'block';
      toastTimer = setTimeout(() => wx.hideToast(), duration);
    },
    showModal: (options) =>
      new Promise((resolve) => {
        const dialog = document.getElementById('dialog');
        document.getElementById('dialog-title').textContent = options.title || '';
        document.getElementById('dialog-content').textContent = options.content || '';
        const input = document.getElementById('dialog-input');
        input.hidden = !options.editable;
        input.value = options.content || '';
        input.placeholder = options.placeholderText || '';
        const done = (confirm) => {
          dialog.close();
          resolve({ confirm, cancel: !confirm, content: input.value });
        };
        const cancel = document.getElementById('dialog-cancel');
        cancel.hidden = options.showCancel === false;
        cancel.textContent = options.cancelText || '取消';
        cancel.onclick = () => done(false);
        const confirm = document.getElementById('dialog-confirm');
        confirm.textContent = options.confirmText || '知道了';
        confirm.onclick = () => done(true);
        dialog.oncancel = (e) => {
          e.preventDefault();
          done(false);
        };
        dialog.showModal();
      }),
    onBluetoothDeviceFound: (fn) => (callbacks.found = fn),
    offBluetoothDeviceFound: () => {},
    onBLECharacteristicValueChange: (fn) => (callbacks.frame = fn),
    offBLECharacteristicValueChange: () => {},
    onBLEConnectionStateChange: (fn) => (callbacks.connection = fn),
    offBLEConnectionStateChange: () => {},
    openBluetoothAdapter: (opts) =>
      opts.fail({ errMsg: '浏览器预览不支持微信 BLE。请在微信开发者工具中使用真机调试。' }),
    stopBluetoothDevicesDiscovery: (opts) => opts.success({}),
    closeBLEConnection: (opts) => opts.success({}),
    closeBluetoothAdapter: (opts) => opts.success({}),
    requirePrivacyAuthorize: (opts) =>
      opts.fail({ errMsg: '浏览器预览不能验证微信隐私授权，请使用微信真机。' }),
    openPrivacyContract: (opts) => opts.fail({ errMsg: '仅微信支持正式隐私指引' }),
  };
  const cache = {};
  function load(id) {
    if (cache[id]) return cache[id].exports;
    const mod = { exports: {} };
    cache[id] = mod;
    const require = (relative) => {
      const parts = id.split('/');
      parts.pop();
      relative.split('/').forEach((x) => {
        if (x === '..') parts.pop();
        else if (x !== '.') parts.push(x);
      });
      return load(parts.join('/'));
    };
    new Function('require', 'module', 'exports', 'wx', 'Page', BUNDLE.modules[id])(
      require,
      mod,
      mod.exports,
      wx,
      (definition) => {
        page = definition;
      },
    );
    return mod.exports;
  }
  load('pages/index/index');
  page.setData = function (patch) {
    Object.assign(this.data, patch);
    scheduleRender();
  };
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    queueMicrotask(() => {
      renderPending = false;
      render();
    });
  }
  const source = new DOMParser().parseFromString(
    '<root xmlns:wx="wx">' + BUNDLE.wxml.replace(/wx:else(?=[\s>])/g, 'wx:else=""') + '</root>',
    'application/xml',
  );
  if (source.querySelector('parsererror'))
    throw new Error(source.querySelector('parsererror').textContent);
  function evaluate(expr, scope) {
    const decoded = expr.replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
    try {
      return new Function('s', 'with(s){return (' + decoded + ')}')(scope);
    } catch (e) {
      console.error('Template expression:', expr, e);
      return '';
    }
  }
  function binding(value, scope) {
    const whole = value.match(/^\{\{((?:(?!\}\})[\s\S])*)\}\}$/);
    if (whole) return evaluate(whole[1], scope);
    return value.replace(/\{\{([\s\S]*?)\}\}/g, (_, x) => String(evaluate(x, scope)));
  }
  function children(parent, target, scope) {
    let branch = false;
    [...parent.childNodes].forEach((node) => {
      if (node.nodeType !== 1) {
        if (node.nodeType === 3 && node.textContent.trim())
          target.append(document.createTextNode(binding(node.textContent, scope)));
        return;
      }
      const cond = node.getAttribute('wx:if'),
        elif = node.getAttribute('wx:elif'),
        other = node.hasAttribute('wx:else');
      if (cond !== null) {
        branch = !!binding(cond, scope);
        if (!branch) return;
      } else if (elif !== null) {
        if (branch) return;
        branch = !!binding(elif, scope);
        if (!branch) return;
      } else if (other) {
        if (branch) return;
        branch = true;
      } else branch = false;
      const loop = node.getAttribute('wx:for');
      if (loop !== null) {
        const rows = binding(loop, scope) || [];
        rows.forEach((item, index) => element(node, target, { ...scope, item, index }));
      } else element(node, target, scope);
    });
  }
  function element(node, target, scope) {
    if (node.tagName === 'block') {
      children(node, target, scope);
      return;
    }
    if (node.tagName === 'template') {
      const name = node.getAttribute('is');
      if (!name) return;
      const definition = source.querySelector(`template[name="${name}"]`);
      if (!definition) throw new Error(`Missing native template: ${name}`);
      const data = node.getAttribute('data') || '{{}}';
      children(definition, target, evaluate('({' + data.slice(2, -2) + '})', scope));
      return;
    }
    const map = { view: 'div', text: 'span', image: 'img', 'scroll-view': 'div' };
    const tag = map[node.tagName] || node.tagName;
    const el = document.createElement(tag);
    const dataset = {};
    [...node.attributes].forEach((attr) => {
      if (attr.name.startsWith('wx:') || attr.name.startsWith('bind')) return;
      let v = binding(attr.value, scope);
      if (attr.name === 'src' && v.startsWith('/assets/')) v = BUNDLE.assets[v] || v;
      if (attr.name === 'disabled') {
        el.disabled = !!v;
        return;
      }
      if (attr.name === 'value') {
        el.value = v;
        return;
      }
      if (attr.name === 'type' && tag === 'input' && v === 'number') {
        el.setAttribute('inputmode', 'numeric');
        el.type = 'text';
        return;
      }
      if (attr.name === 'password' && tag === 'input') {
        el.type = v ? 'password' : 'text';
        return;
      }
      if (attr.name.startsWith('data-')) dataset[attr.name.slice(5)] = v;
      el.setAttribute(attr.name, String(v));
    });
    if (tag === 'img') {
      el.alt = '';
      el.style.width = el.style.width || '';
    }
    ['tap', 'input', 'change'].forEach((type) => {
      const method = node.getAttribute('bind' + type);
      if (!method) return;
      el.addEventListener(type === 'tap' ? 'click' : type, (ev) => {
        const event = { currentTarget: { dataset }, detail: { value: ev.target.value } };
        try {
          Promise.resolve(page[method](event)).catch(console.error);
        } catch (error) {
          console.error(error);
        }
      });
    });
    children(node, el, scope);
    target.append(el);
  }
  function render() {
    const focused = document.activeElement;
    const field = focused && focused.getAttribute('data-field');
    const selection = focused && focused.selectionStart;
    const fragment = document.createDocumentFragment();
    children(source.documentElement, fragment, page.data);
    root.replaceChildren(fragment);
    if (field) {
      const next = root.querySelector('[data-field="' + field + '"]');
      if (next) {
        next.focus();
        try {
          next.setSelectionRange(selection, selection);
        } catch (_) {
          /* Some input types do not support text selection. */
        }
      }
    }
  }
  // Minimal parity hooks for deterministic browser QA, never shipped to WeChat.
  window.__courtside = { page, wx };
  page.onLoad();
  render();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) page.onHide();
  });
  window.addEventListener('pagehide', () => page.onUnload());
})();
