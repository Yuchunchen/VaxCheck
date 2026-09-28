// 圖示使用 assets/icons/*.png:尺寸正確，Chrome 工具列圖示不含文字；大型文字版放 assets/brand/。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/lib/rules.mjs';
import { ICON_SOURCES, ICON_SIZES, renderIcon } from '../scripts/icons.mjs';

test('16/24/32/48/128 px PNG 尺寸正確', () => {
  assert.deepEqual(ICON_SIZES, [16, 24, 32, 48, 128]);
  for (const s of ICON_SIZES) {
    assert.equal(ICON_SOURCES[s], `assets/icons/icon${s}.png`);
    const png = renderIcon(s);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [s, s], `${s} px`);
  }
});

test('品牌 PNG 素材齊全；只有大型素材含文字', () => {
  const brand = [
    'project-logo.png',
    'vaxcheck-full.png',
    'taiwan-mark.png',
    'taiwan-vaxcheck.png',
    'taiwan-115-zh.png',
    'vaxcheck-115-zh.png',
  ];
  for (const f of brand) assert.ok(fs.existsSync(path.join(ROOT, 'assets/brand', f)), f);
  for (const s of ICON_SIZES) assert.ok(fs.existsSync(path.join(ROOT, ICON_SOURCES[s])), ICON_SOURCES[s]);
});
