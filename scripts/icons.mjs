// 外掛圖示:使用預先產生的 PNG 品牌素材。16/24/32/48/128 px 均不放文字，避免工具列縮小後失真。
// build.mjs 呼叫;單獨執行:node scripts/icons.mjs [輸出資料夾,預設 dist/icons]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ICON_SOURCES = {
  16: 'assets/icons/icon16.png',
  24: 'assets/icons/icon24.png',
  32: 'assets/icons/icon32.png',
  48: 'assets/icons/icon48.png',
  128: 'assets/icons/icon128.png',
};
export const ICON_SIZES = Object.keys(ICON_SOURCES).map(Number);

export function renderIcon(size, root = ROOT) {
  const src = ICON_SOURCES[size];
  if (!src) throw new Error(`沒有 ${size} px 圖示的來源`);
  const png = fs.readFileSync(path.join(root, src));
  if (png.subarray(1, 4).toString() !== 'PNG') throw new Error(`${src} 不是 PNG`);
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
    throw new Error(`${src} 尺寸必須是 ${size}x${size}`);
  }
  return png;
}

/** 寫出 icon<size>.png,回傳 { size: 相對路徑 }(prefix 為 manifest 內的資料夾名) */
export function writeIcons(outDir, prefix = 'icons') {
  fs.mkdirSync(outDir, { recursive: true });
  const out = {};
  for (const s of ICON_SIZES) {
    fs.writeFileSync(path.join(outDir, `icon${s}.png`), renderIcon(s));
    out[s] = `${prefix}/icon${s}.png`;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || path.join(ROOT, 'dist/icons'));
  writeIcons(dir);
  console.log(`✓ 圖示 ${ICON_SIZES.join('/')} px → ${path.relative(ROOT, dir) || '.'}`);
}
