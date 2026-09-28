// 圖示使用 assets/icons/*.png(由 assets/source 原圖經 scripts/make-brand.py 產生):尺寸正確、PNG 可完整解碼;工具列圖示不含文字。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../scripts/lib/rules.mjs';
import { ICON_SOURCES, ICON_SIZES, renderIcon } from '../scripts/icons.mjs';

// 逐 chunk 驗 CRC,IDAT 串接後 inflate;v0.4.17 以前 icon128 與 README 主圖曾是損毀檔,Chrome 會改顯示預設圖示
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function checkPng(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${file} 不是 PNG`);
  let p = 8; const idat = []; let end = false;
  while (p < b.length) {
    const len = b.readUInt32BE(p); const type = b.subarray(p + 4, p + 8).toString();
    const data = b.subarray(p + 8, p + 8 + len);
    assert.equal(crc32(b.subarray(p + 4, p + 8 + len)), b.readUInt32BE(p + 8 + len), `${file} ${type} CRC 錯誤`);
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') { end = true; break; }
    p += 12 + len;
  }
  assert.ok(end, `${file} 缺 IEND`);
  assert.doesNotThrow(() => zlib.inflateSync(Buffer.concat(idat)), `${file} 影像資料無法解壓`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('16/24/32/48/128 px 圖示尺寸正確且可完整解碼', () => {
  assert.deepEqual(ICON_SIZES, [16, 24, 32, 48, 128]);
  for (const s of ICON_SIZES) {
    assert.equal(ICON_SOURCES[s], `assets/icons/icon${s}.png`);
    renderIcon(s);
    assert.deepEqual(Object.values(checkPng(path.join(ROOT, ICON_SOURCES[s]))), [s, s], `${s} px`);
  }
});

test('assets 下所有 PNG 都能完整解碼;README 主圖存在', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.png') ? [path.join(d, e.name)] : []));
  const files = walk(path.join(ROOT, 'assets'));
  assert.ok(files.length >= 18);
  for (const f of files) checkPng(f);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const hero = readme.match(/<img src="([^"]+)"/)[1];
  assert.ok(fs.existsSync(path.join(ROOT, hero)), hero);
});
