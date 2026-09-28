// 外掛與示範頁建置:esbuild 打包 → dist/ext(載入未封裝項目用)+ zip;dist/web/index.html(單檔示範頁)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { ROOT } from './lib/rules.mjs';
import { writeIcons, renderIcon } from './icons.mjs';

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

// 圖示:assets/logo.svg、assets/logo-small.svg → PNG(scripts/icons.mjs);設定頁標題用 SVG 原檔
const allIcons = writeIcons(path.join(EXT, 'icons'));
fs.copyFileSync(path.join(ROOT, 'assets/logo-small.svg'), path.join(EXT, 'icons', 'logo-small.svg'));
const icons = { 16: allIcons[16], 32: allIcons[32], 48: allIcons[48], 128: allIcons[128] };
const toolbarIcons = { 16: allIcons[16], 24: allIcons[24], 32: allIcons[32] };   // 工具列 16 DIP(100%/150%/200% 縮放)
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify({
  manifest_version: 3,
  name: 'VaxCheck 疫苗檢核',
  version: pkg.version,
  description: '門診插卡後一鍵檢核公費疫苗資格(健保雲端 + NIIS 接種史)。病患資料只留在瀏覽器。',
  minimum_chrome_version: '116',
  permissions: ['storage', 'alarms'],   // alarms:線上規則每天自動更新(無安裝警示)
  host_permissions: ['https://medcloud2.nhi.gov.tw/*', 'https://10.241.219.35/*', 'https://raw.githubusercontent.com/*'],   // 最後一項:線上規則預設來源
  optional_host_permissions: ['https://*.github.io/*'],
  background: { service_worker: 'background.js' },
  content_scripts: [
    { matches: ['https://medcloud2.nhi.gov.tw/imu/*'], js: ['content-medcloud.js'], run_at: 'document_idle' },
    { matches: ['https://10.241.219.35/*'], js: ['content-niis.js'], run_at: 'document_idle' },
  ],
  options_page: 'options.html',
  action: { default_title: 'VaxCheck:開啟健保雲端與 NIIS 並檢核', default_icon: toolbarIcons },   // 不可設 default_popup(否則 onClicked 不觸發)
  icons,
}, null, 2));

// 示範頁(單檔 HTML)
const web = await esbuild.build({ ...common, define: { __VAXCHECK_VERSION__: JSON.stringify(pkg.version) }, entryPoints: ['src/web/demo.js'], write: false, target: 'es2020', minify: true, absWorkingDir: ROOT });
const js = web.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
fs.mkdirSync(D('web'), { recursive: true });
const favicon = (s) => `data:image/png;base64,${renderIcon(s).toString('base64')}`;
fs.writeFileSync(D('web', 'index.html'), fs.readFileSync(path.join(ROOT, 'src/web/index.template.html'), 'utf8')
  .replace('__FAVICON16__', () => favicon(16)).replace('__FAVICON32__', () => favicon(32)).replace('/*__BUNDLE__*/', () => js));

// zip
const zip = D(`vaxcheck-ext-${pkg.version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))},'zip',${JSON.stringify(EXT)})`]);
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
console.log(`✓ 外掛 → dist/ext/(${fs.readdirSync(EXT).length} 項),zip ${kb(zip)}`);
console.log(`✓ 示範頁 → dist/web/index.html(${kb(D('web', 'index.html'))})`);
