// flowchart.html → flowchart.png(1080×1350,deviceScaleFactor 2 → 2160×2700)
// 用法:node docs/outreach/2026-11-threads/render.mjs [Noto Sans TC 的 fontsource 資料夾]
// 字型:建議先 `npm i @fontsource/noto-sans-tc` 到任一資料夾,把該套件路徑當第一個參數;不給則用系統字型。
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright'); // CJS require 才吃得到全域安裝(NODE_PATH)
const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(here, 'flowchart.html')).href);
if (fontDir) {
  for (const w of [400, 500, 700, 900]) await page.addStyleTag({ url: pathToFileURL(path.join(fontDir, `${w}.css`)).href });
}
await page.evaluate(async () => { await document.fonts.ready; });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(here, 'flowchart.png'), clip: { x: 0, y: 0, width: 1080, height: 1350 } });
await browser.close();
console.log('wrote', path.join(here, 'flowchart.png'));
