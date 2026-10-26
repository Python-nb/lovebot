// 擎点体育 T1.2 / 交互 V2。命令区分大小写；不追加换行。
const UUID = Object.freeze({
  service: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
  rx: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
  tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
});
function integer(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`请输入 ${min}–${max} 的整数`);
  return n;
}
function setupCommand(mode, target) {
  if (mode === 'free') return null; // 协议未定义自由模式切换命令。
  if (mode === 'time') return `SET1#${integer(target, 1, 180) * 60}#`;
  if (mode === 'count') return `SET2#${integer(target, 1, 9999)}#`;
  throw new Error('未知训练模式');
}
function encode(text) {
  return Uint8Array.from(text.split('').map((c) => c.charCodeAt(0))).buffer;
}
function decode(value) {
  return String.fromCharCode(...new Uint8Array(value));
}
function parseFrame(raw) {
  const fields = raw.trim().replace(/,$/, '').split(',');
  if (fields.length !== 7 || !fields.every((x) => /^\d+$/.test(x.trim()))) return null;
  const [head, shots, hits, seconds, mode, target, end] = fields.map(Number);
  if (
    head !== 101 ||
    end !== 9 ||
    mode > 2 ||
    hits > shots ||
    !fields.every((x) => Number.isSafeInteger(Number(x)))
  )
    return null;
  return { shots, hits, seconds, mode, target };
}
// 处理 BLE 拆包、粘包；以固定头尾识别，不把 notify 边界当业务帧边界。
class FrameDecoder {
  constructor() {
    this.buffer = '';
  }
  push(chunk) {
    this.buffer = (this.buffer + chunk).slice(-4096);
    const result = [];
    const re = /(?:^|[,\r\n])101,\s*\d+,\s*\d+,\s*\d+,\s*[012],\s*\d+,\s*9(?=,|\r|\n|101,)/g;
    let match,
      consumed = 0;
    while ((match = re.exec(this.buffer))) {
      const frame = parseFrame(match[0].replace(/^[,\r\n]/, ''));
      if (frame) result.push(frame);
      consumed = re.lastIndex;
    }
    if (consumed) this.buffer = this.buffer.slice(consumed).replace(/^[,\r\n]+/, '');
    return result;
  }
}
module.exports = { UUID, setupCommand, integer, encode, decode, parseFrame, FrameDecoder };
