// 外掛圖示:由 SVG 產生 PNG(resvg,不手繪)。16/24/32 px 用 assets/logo-small.svg(16 格繪製、無山海細節),48/128 px 用 assets/logo.svg。
// build.mjs 呼叫;單獨執行:node scripts/icons.mjs [輸出資料夾,預設 dist/icons]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ICON_SOURCES = { 16: 'assets/logo-small.svg', 24: 'assets/logo-small.svg', 32: 'assets/logo-small.svg', 48: 'assets/logo.svg', 128: 'assets/logo.svg' };
export const ICON_SIZES = Object.keys(ICON_SOURCES).map(Number);

export function renderIcon(size, root = ROOT) {
  const src = ICON_SOURCES[size];
  if (!src) throw new Error(`沒有 ${size} px 圖示的來源`);
  return new Resvg(fs.readFileSync(path.join(root, src), 'utf8'), { fitTo: { mode: 'width', value: size } }).render().asPng();
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
