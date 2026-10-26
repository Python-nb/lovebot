const KEY = 'courtside.theme.v1';
const choices = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];
const valid = (value) => choices.some((item) => item.id === value);
function read(api) {
  try {
    const value = api.getStorageSync(KEY);
    return valid(value) ? value : 'system';
  } catch (_) {
    return 'system';
  }
}
function system(api) {
  try {
    return api.getAppBaseInfo && api.getAppBaseInfo().theme === 'dark' ? 'dark' : 'light';
  } catch (_) {
    return 'light';
  }
}
function resolve(preference, systemTheme) {
  return preference === 'dark' || (preference !== 'light' && systemTheme === 'dark')
    ? 'dark'
    : 'light';
}
function chrome(theme) {
  return theme === 'dark'
    ? { frontColor: '#ffffff', backgroundColor: '#0e131c', backgroundTextStyle: 'light' }
    : { frontColor: '#000000', backgroundColor: '#f4f6fa', backgroundTextStyle: 'dark' };
}
module.exports = { KEY, choices, valid, read, system, resolve, chrome };
