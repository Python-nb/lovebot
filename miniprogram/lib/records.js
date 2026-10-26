const KEY = 'courtside.records.v1';
const MODES = { free: '自由训练', time: '定时训练', count: '定数训练' };
function rate(shots, hits) {
  return shots ? ((hits / shots) * 100).toFixed(1) : '0.0';
}
function clock(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  return [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60]
    .map((x) => String(x).padStart(2, '0'))
    .join(':');
}
function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function load(api) {
  try {
    const rows = api.getStorageSync(KEY);
    return Array.isArray(rows) ? rows.filter(valid) : [];
  } catch (_) {
    return [];
  }
}
function valid(r) {
  return (
    r &&
    typeof r.id === 'string' &&
    r.source === 'ble' &&
    typeof r.mode === 'string' &&
    Object.prototype.hasOwnProperty.call(MODES, r.mode) &&
    Number.isFinite(r.endedAt) &&
    ['shots', 'hits', 'seconds'].every((k) => Number.isSafeInteger(r[k]) && r[k] >= 0) &&
    r.hits <= r.shots
  );
}
function save(api, row) {
  if (!valid(row)) throw new Error('记录格式无效');
  const rows = load(api);
  if (rows.some((x) => x.id === row.id)) return rows;
  const next = [row, ...rows];
  api.setStorageSync(KEY, next); // 写失败必须向上传递，不显示保存成功。
  return next;
}
function since(days, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days + 1);
  return d.getTime();
}
function summary(rows) {
  const sum = rows.reduce(
    (a, r) => ({ shots: a.shots + r.shots, hits: a.hits + r.hits, seconds: a.seconds + r.seconds }),
    { shots: 0, hits: 0, seconds: 0 },
  );
  return {
    ...sum,
    rate: rate(sum.shots, sum.hits),
    minutes: Math.round(sum.seconds / 60),
    sessions: rows.length,
  };
}
function trend(rows, days = 7, now = new Date()) {
  const points = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const s = summary(rows.filter((r) => dayKey(r.endedAt) === key));
    points.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, ...s });
  }
  return points;
}
module.exports = { KEY, MODES, rate, clock, dayKey, valid, load, save, since, summary, trend };
