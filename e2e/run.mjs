// 端對端:真 Chromium 載入外掛,路由攔截偽造健保雲端與 NIIS。node e2e/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.NPM_GLOBAL || '/usr/local/lib/node_modules', 'playwright'));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXT = path.join(ROOT, 'dist/ext');
const SHOTS = path.join(ROOT, 'e2e/shots');
const fx = (f) => fs.readFileSync(path.join(ROOT, 'fixtures', f), 'utf8');
const fake = JSON.parse(fx('nhi/fake_patient.json'));
const jwt = (p) => 'h.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.s';
const P1 = { UserID: 'A123456789', UserName: '測試甲', UserSex: 'M', UserBirthday: '0470302', exp: 9999999999 };
const P2 = { UserID: 'B223456789', UserName: '測試乙', UserSex: 'F', UserBirthday: '0700505', exp: 9999999999 };
let niisId = 'A123456789';
const results = [];
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

const medcloudHtml = (p) => `<!doctype html><html><head><meta charset="utf-8"><title>健保雲端(偽)</title></head><body style="font-family:sans-serif;background:#f6f7f9"><h2>健保醫療資訊雲端查詢系統(測試頁)</h2><p>病患:${p.UserName}</p><script>sessionStorage.setItem('token', ${JSON.stringify(jwt(p))});</script></body></html>`;
const niisHtml = () => `<!doctype html><html><head><meta charset="utf-8"><title>NIIS(偽)</title></head><body style="font-family:sans-serif"><h2>預防接種資訊管理系統(測試頁)</h2>
<input id="tb_RocID" value="${niisId}"><button id="btn_Query" type="button">查詢</button><div id="out"></div>
<script>document.getElementById('btn_Query').onclick=()=>{document.getElementById('out').innerHTML='<div id="div_result"><section class="tabs"><span class="tabItem active">預防接種紀錄</span><div class="tabContent"><div class="dataTb"><table><tr><td>序號</td><td>劑別代號</td><td>疫苗中文名稱</td><td>接種日</td><td>批號類型</td><td>接種單位</td></tr><tr><td>1</td><td>13PCV-1</td><td>13價結合型肺炎鏈球菌疫苗</td><td>1150601</td><td>公費</td><td>某衛生所</td></tr><tr><td>2</td><td>Flu-1</td><td>流感疫苗</td><td>1141020</td><td>公費</td><td>某衛生所</td></tr></table></div></div></section></div>'};</script></body></html>`;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync('/tmp/vx-'), {
  headless: true, channel: 'chromium', viewport: { width: 1280, height: 860 }, locale: 'zh-TW',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let current = P1;
await ctx.route('https://medcloud2.nhi.gov.tw/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/imu/api/')) {
    const body = u.pathname.includes('imue0008') ? fake.medication : u.pathname.includes('imue0060') ? fake.lab : u.pathname.includes('imue0040') ? fake.allergy
      : u.pathname.includes('imue2000') ? fake.summary : u.pathname.includes('imue0190') ? { robject: { drugs: [], medical_service: [], special_material: [] } } : {};
    const auth = route.request().headers()['authorization'] || '';
    if (!auth.startsWith('Bearer ')) return route.fulfill({ status: 401, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: medcloudHtml(current) });
});
await ctx.route('https://10.241.219.35/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: niisHtml() }));

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
check('外掛 service worker 啟動', !!sw, sw.url().split('/')[2]);

const page = await ctx.newPage();
page.on('console', (m) => { if (/疫苗檢核|Error/.test(m.text())) console.log('   [console]', m.text()); });
await page.goto('https://medcloud2.nhi.gov.tw/imu/IMUE1000/IMUE0008');
const fab = page.locator('#vaxcheck-fab >> button');
await fab.waitFor({ timeout: 10000 });
check('浮動鈕出現', true);
await page.waitForTimeout(2200);
await fab.click();
const panel = page.locator('#vaxcheck-panel');
const verdictOf = async (name) => {
  await page.waitForFunction(() => document.querySelector('#vaxcheck-panel')?.shadowRoot?.querySelector('.vx-v'), null, { timeout: 10000 });
  return page.evaluate((n) => { const r = document.querySelector('#vaxcheck-panel').shadowRoot; const li = [...r.querySelectorAll('.vx-v')].find((x) => x.querySelector('.vx-name').textContent.includes(n)); return li?.querySelector('.vx-verdict').textContent; }, name);
};
check('第一層:肺鏈 68 歲 → 待查接種史', (await verdictOf('肺炎鏈球菌')) === '待查接種史');
const srcText = await page.evaluate(() => document.querySelector('#vaxcheck-panel').shadowRoot.querySelector('.vx-sources').textContent);
check('來源列:用藥/病人資訊已取得、接種史未查', /用藥 已取得/.test(srcText) && /接種史 未查詢/.test(srcText), srcText);
const PKG_VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const footText = await page.evaluate(() => document.querySelector('#vaxcheck-panel').shadowRoot.querySelector('.vx-foot')?.textContent || '');
check('面板頁尾顯示外掛版號', footText.includes(`VaxCheck v${PKG_VER}`), footText);
await page.screenshot({ path: path.join(SHOTS, '1-first-layer.png') });

// 查接種史 → NIIS 分頁 → 過卡(按查詢)→ 回寫
const [niis] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => [...document.querySelector('#vaxcheck-panel').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.includes('查接種史')).click())]);
await niis.waitForLoadState().catch(() => {});
check('按「查接種史」開出新分頁', !!niis);
// 外掛以 chrome.tabs.create 開的分頁不經 Playwright 路由(沙箱無院內網路)→ 在同一分頁重新導向到偽造 NIIS
await niis.goto('https://10.241.219.35/#vaxcheck');
await niis.click('#btn_Query');
const toast = niis.locator('#vaxcheck-toast');
await toast.waitFor({ state: 'attached', timeout: 8000 });
const toastText = await niis.evaluate(() => document.querySelector('#vaxcheck-toast').shadowRoot.textContent);
check('NIIS toast:已擷取 2 筆', /已擷取 2 筆/.test(toastText), toastText);
await niis.screenshot({ path: path.join(SHOTS, '2-niis-toast.png') });

await page.bringToFront();
await page.waitForTimeout(800);
check('合併後:肺鏈 PCV13 未滿 1 年 → 需確認', (await verdictOf('肺炎鏈球菌')) === '需確認');
const asks = await page.evaluate(() => [...document.querySelector('#vaxcheck-panel').shadowRoot.querySelectorAll('.vx-check span')].map((s) => s.firstChild.textContent));
check('只問決定性條件(IPD/洗腎/機構住民)', asks.includes('IPD 高風險對象') && !asks.includes('具原住民身分'), asks.join('、'));
await page.screenshot({ path: path.join(SHOTS, '3-merged-needs-input.png') });

await page.evaluate(() => { const r = document.querySelector('#vaxcheck-panel').shadowRoot; [...r.querySelectorAll('.vx-check')].find((l) => l.textContent.includes('IPD 高風險')).querySelector('input').click(); });
await page.waitForTimeout(600);
check('勾 IPD 高風險 → 8 週路徑 → 可打', (await verdictOf('肺炎鏈球菌')) === '可打');
await page.screenshot({ path: path.join(SHOTS, '4-after-manual.png') });

// 身分不符
niisId = 'Z999999999';
await niis.bringToFront(); await niis.reload(); await niis.click('#btn_Query');
await niis.locator('#vaxcheck-toast').waitFor({ state: 'attached', timeout: 8000 });
const t2 = await niis.evaluate(() => document.querySelector('#vaxcheck-toast').shadowRoot.textContent);
check('NIIS 身分不符 → 拒絕併入', /身分與健保雲端不同/.test(t2), t2);
await page.bringToFront(); await page.waitForTimeout(600);
const notice = await page.evaluate(() => document.querySelector('#vaxcheck-panel').shadowRoot.querySelector('.vx-notice')?.textContent || '');
check('健保雲端面板顯示身分不符警示', /不是同一位病患/.test(notice), notice);
check('不符的結果沒有覆蓋:肺鏈仍為可打', (await verdictOf('肺炎鏈球菌')) === '可打');
await page.screenshot({ path: path.join(SHOTS, '5-mismatch.png') });

// 換卡
current = P2;
await page.goto('https://medcloud2.nhi.gov.tw/imu/IMUE1000/IMUE0008');
await page.locator('#vaxcheck-fab >> button').waitFor();
await page.waitForTimeout(2500);
check('換卡後面板關閉', (await page.locator('#vaxcheck-panel').count()) === 0);
await page.locator('#vaxcheck-fab >> button').click();
await page.waitForTimeout(1500);
const who = await page.evaluate(() => document.querySelector('#vaxcheck-panel').shadowRoot.querySelector('.vx-who').textContent);
check('新病患顯示正確、接種史清空', who.includes('測試乙') && (await verdictOf('肺炎鏈球菌')) !== '可打', who);
await page.screenshot({ path: path.join(SHOTS, '6-new-card.png') });

// 設定頁
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${sw.url().split('/')[2]}/options.html`);
await opt.waitForTimeout(500);
check('設定頁載入縣市選單', (await opt.locator('#jur option').count()) >= 1);
check('設定頁顯示外掛版號', (await opt.locator('#ver').textContent()) === `v${PKG_VER}`);

await ctx.close();
const fail = results.filter(([, ok]) => !ok).length;
console.log(`\n端對端 ${results.length - fail}/${results.length}`);
process.exit(fail ? 1 : 0);
