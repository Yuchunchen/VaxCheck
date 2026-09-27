// 外掛與示範頁建置:esbuild 打包 → dist/ext(載入未封裝項目用)+ zip;dist/web/index.html(單檔示範頁)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { ROOT } from './lib/rules.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const D = (...p) => path.join(ROOT, 'dist', ...p);
const EXT = D('ext');
fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'rules'), { recursive: true });
fs.mkdirSync(path.join(EXT, 'icons'), { recursive: true });

const common = { bundle: true, format: 'iife', target: 'chrome116', legalComments: 'none', charset: 'utf8', minify: true, loader: { '.json': 'json' } };
await esbuild.build({ ...common, entryPoints: { background: 'src/background.js', 'content-medcloud': 'src/content/medcloud.js', 'content-niis': 'src/content/niis.js', options: 'src/options/options.js' }, outdir: EXT, absWorkingDir: ROOT });
fs.copyFileSync(path.join(ROOT, 'src/options/options.html'), path.join(EXT, 'options.html'));
for (const f of fs.readdirSync(D('rules')).filter((f) => f !== 'niis-vaccine-codes.json')) fs.copyFileSync(D('rules', f), path.join(EXT, 'rules', f));
for (const f of ['LICENSE', 'NOTICE']) fs.copyFileSync(path.join(ROOT, f), path.join(EXT, f));

// 圖示:深藍底、綠色勾(純 Node 產生 PNG)
function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const inCheck = (x, y) => { const s = size; const d1 = Math.abs((y - 0.62 * s) + (x - 0.40 * s)) < 0.09 * s && x > 0.22 * s && x < 0.44 * s; const d2 = Math.abs((y - 0.62 * s) - (0.62 * s - 0.62 * s) + (x - 0.40 * s) * 1.25) < 0.09 * s * 1.6 && x >= 0.38 * s && x < 0.80 * s && y > 0.24 * s; return d1 || d2; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4; const r = size * 0.18;
    const cx = Math.min(Math.max(x, r), size - 1 - r), cy = Math.min(Math.max(y, r), size - 1 - r);
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    const [R, G, B] = inCheck(x, y) ? [0x5F, 0xD3, 0x94] : [0x1C, 0x2B, 0x3A];
    px.set(inside ? [R, G, B, 255] : [0, 0, 0, 0], i);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(EXT, 'icons', `icon${s}.png`), png(s));

const icons = { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify({
  manifest_version: 3,
  name: 'VaxCheck 疫苗檢核',
  version: pkg.version,
  description: '門診插卡後一鍵檢核公費疫苗資格(健保雲端 + NIIS 接種史)。病患資料只留在瀏覽器。',
  minimum_chrome_version: '116',
  permissions: ['storage'],
  host_permissions: ['https://medcloud2.nhi.gov.tw/*', 'https://10.241.219.35/*'],
  optional_host_permissions: ['https://*.github.io/*'],
  background: { service_worker: 'background.js' },
  content_scripts: [
    { matches: ['https://medcloud2.nhi.gov.tw/imu/*'], js: ['content-medcloud.js'], run_at: 'document_idle' },
    { matches: ['https://10.241.219.35/*'], js: ['content-niis.js'], run_at: 'document_idle' },
  ],
  options_page: 'options.html',
  action: { default_title: 'VaxCheck:開啟健保雲端與 NIIS 並檢核', default_icon: icons },   // 不可設 default_popup(否則 onClicked 不觸發)
  icons,
}, null, 2));

// 示範頁(單檔 HTML)
const web = await esbuild.build({ ...common, define: { __VAXCHECK_VERSION__: JSON.stringify(pkg.version) }, entryPoints: ['src/web/demo.js'], write: false, target: 'es2020', minify: true, absWorkingDir: ROOT });
const js = web.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
fs.mkdirSync(D('web'), { recursive: true });
fs.writeFileSync(D('web', 'index.html'), fs.readFileSync(path.join(ROOT, 'src/web/index.template.html'), 'utf8').replace('/*__BUNDLE__*/', () => js));

// zip
const zip = D(`vaxcheck-ext-${pkg.version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))},'zip',${JSON.stringify(EXT)})`]);
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
console.log(`✓ 外掛 → dist/ext/(${fs.readdirSync(EXT).length} 項),zip ${kb(zip)}`);
console.log(`✓ 示範頁 → dist/web/index.html(${kb(D('web', 'index.html'))})`);
