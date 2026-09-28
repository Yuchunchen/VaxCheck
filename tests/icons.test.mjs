// 圖示由 assets/*.svg 產生(scripts/icons.mjs):尺寸正確、小圖不放文字、配色沿用面板
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/lib/rules.mjs';
import { ICON_SOURCES, ICON_SIZES, renderIcon } from '../scripts/icons.mjs';

const svg = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('16/24/32/48/128 px PNG 由 SVG 產生,尺寸正確;16–32 px 用小圖版', () => {
  assert.deepEqual(ICON_SIZES, [16, 24, 32, 48, 128]);
  for (const s of ICON_SIZES) {
    const png = renderIcon(s);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [s, s], `${s} px`);
  }
  for (const s of [16, 24, 32]) assert.equal(ICON_SOURCES[s], 'assets/logo-small.svg');
});

test('標誌 SVG:不含文字、配色 = 面板 ink/go', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'src/panel/panel.css.js'), 'utf8');
  for (const c of ['#1C2B3A', '#1E7B4F']) assert.ok(panel.includes(c), `面板仍用 ${c}`);
  for (const f of ['assets/logo.svg', 'assets/logo-small.svg']) {
    const s = svg(f);
    assert.ok(!/<text\b/.test(s), `${f} 不可有 <text>`);
    assert.ok(s.includes('#1C2B3A') && s.includes('#1E7B4F'), f);
    assert.ok(!/<image\b|href="(?!#)/.test(s), `${f} 不可嵌外部圖片`);
  }
});
