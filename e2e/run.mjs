// 端對端:真 Chromium 載入外掛,本機 HTTPS 代理偽造健保雲端與 NIIS(見 fake-sites.mjs)。node e2e/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startFakeSites } from './fake-sites.mjs';
const require = createRequire(import.meta.url);
const NPM_GLOBAL = process.env.NPM_GLOBAL || (fs.existsSync('/usr/local/lib/node_modules/playwright') ? '/usr/local/lib/node_modules' : execSync('npm root -g').toString().trim());
const { chromium } = require(path.join(NPM_GLOBAL, 'playwright'));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXT = path.join(ROOT, 'dist/ext');
const SHOTS = path.join(ROOT, 'e2e/shots');
fs.mkdirSync(SHOTS, { recursive: true });
const fake = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/nhi/fake_patient.json'), 'utf8'));
const P1 = { UserID: 'A123456789', UserName: '測試甲', UserSex: 'M', UserBirthday: '0470302', exp: 9999999999 };
const P2 = { UserID: 'B223456789', UserName: '測試乙', UserSex: 'F', UserBirthday: '0700505', exp: 9999999999 };
const MC = 'https://medcloud2.nhi.gov.tw';
const NIIS = 'https://10.241.219.35';
const results = [];
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 15000, interval = 250) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await sleep(interval); }
}

const sites = await startFakeSites({ fake });
const { mc, niis: ni } = sites.state;
const USER_DIR = fs.mkdtempSync('/tmp/vx-');
async function launch() {
  const c = await chromium.launchPersistentContext(USER_DIR, {
    headless: true, channel: 'chromium', viewport: { width: 1280, height: 860 }, locale: 'zh-TW',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--proxy-server=${sites.proxyUrl}`, '--ignore-certificate-errors'],
  });
  c.on('page', (p) => p.on('console', (m) => { if (/疫苗檢核|Error/.test(m.text())) console.log('   [console]', m.text()); }));
  return c;
}
let ctx = await launch();

let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const EXT_ID = sw.url().split('/')[2];
check('外掛 service worker 啟動', !!sw, EXT_ID);
const PKG_VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const shadow = (page, fn, arg) => page.evaluate(fn, arg);
const verdictOf = async (page, name) => {
  await page.waitForFunction(() => document.querySelector('#vaxcheck-panel')?.shadowRoot?.querySelector('.vx-v'), null, { timeout: 15000 });
  return shadow(page, (n) => { const r = document.querySelector('#vaxcheck-panel').shadowRoot; const li = [...r.querySelectorAll('.vx-v')].find((x) => x.querySelector('.vx-name').textContent.includes(n)); return li?.querySelector('.vx-verdict').textContent; }, name);
};
const panelText = (page, sel) => shadow(page, (s) => document.querySelector('#vaxcheck-panel')?.shadowRoot?.querySelector(s)?.textContent || '', sel);
// 面板排序:可接種 → 待確認 → 尚未開打 → 不符合,小標題筆數 = 該組卡片數;判定依據 ✓ → 未確認 → ✗
const ORDER = ['可接種', '待確認', '尚未開打', '不符合'];
const RANK = { 'g-y': 0, 'g-u': 1, 'g-n': 2 };
async function checkLayout(pg, need = 2) {
  const layout = await shadow(pg, () => {
    const r = document.querySelector('#vaxcheck-panel').shadowRoot;
    return { heads: [...r.querySelectorAll('.vx-grp')].map((h) => [h.firstChild.textContent, Number(h.querySelector('.vx-grp-n').textContent), h.nextElementSibling.querySelectorAll(':scope > .vx-v').length]),
      traces: [...r.querySelectorAll('.vx-why ul')].map((ul) => [...ul.children].map((li) => li.className)) };
  });
  const idx = layout.heads.map(([t]) => ORDER.indexOf(t));
  const groupsOk = layout.heads.length >= need && idx.every((x, i) => x >= 0 && (i === 0 || x > idx[i - 1])) && layout.heads.every(([, n, c]) => n === c && n > 0);
  const traceOk = layout.traces.length > 0 && layout.traces.every((cls) => cls.map((c) => RANK[c]).every((x, i, a) => i === 0 || x >= a[i - 1]));
  return [groupsOk && traceOk, `${JSON.stringify(layout.heads)};判定依據 ${layout.traces.length} 支`];
}
const toastText = (page) => page.evaluate(() => document.querySelector('#vaxcheck-toast')?.shadowRoot?.textContent || '');

// ───────── A. 浮動鈕(備援入口,行為不變)─────────
mc.current = P1; ni.card = P1.UserID;
const page = await ctx.newPage();
await page.goto(`${MC}/imu/IMUE1000/IMUE0008`);
const fab = page.locator('#vaxcheck-fab >> button');
await fab.waitFor({ timeout: 10000 });
check('浮動鈕出現', true);
await sleep(2200);
await fab.click();
check('第一層:肺鏈 68 歲 → 待查接種史', (await verdictOf(page, '肺炎鏈球菌')) === '待查接種史');
const srcText = await panelText(page, '.vx-sources');
check('來源列:用藥/病人資訊已取得、接種史未查', /用藥 已取得/.test(srcText) && /接種史 未查詢/.test(srcText), srcText);
const footText = await panelText(page, '.vx-foot');
check('面板頁尾顯示外掛版號', footText.includes(`VaxCheck v${PKG_VER}`), footText);
await page.screenshot({ path: path.join(SHOTS, '1-first-layer.png') });

// 查接種史 → NIIS 分頁 → 讀卡(按鈕)→ PostBack → 回寫
const [niis] = await Promise.all([ctx.waitForEvent('page'), shadow(page, () => [...document.querySelector('#vaxcheck-panel').shadowRoot.querySelectorAll('button')].find((b) => b.textContent.includes('查接種史')).click())]);
await niis.waitForLoadState();
check('按「查接種史」開出 NIIS 分頁', niis.url().startsWith(NIIS), niis.url());
await niis.waitForSelector('#btn_Query');
await niis.click('#btn_Query');
await niis.waitForSelector('#vaxcheck-toast', { state: 'attached', timeout: 8000 });
const t1 = await toastText(niis);
check('NIIS toast:已擷取 2 筆', /已擷取 2 筆/.test(t1), t1);
await niis.screenshot({ path: path.join(SHOTS, '2-niis-toast.png') });

await page.bringToFront();
check('合併後:肺鏈 PCV13 未滿 1 年 → 需確認', !!(await until(async () => (await verdictOf(page, '肺炎鏈球菌')) === '需確認', 5000)));
const asks = await shadow(page, () => [...document.querySelector('#vaxcheck-panel').shadowRoot.querySelectorAll('.vx-check > span:first-child')].map((s) => s.firstChild.textContent));
check('只問決定性條件(IPD/洗腎/機構住民)', asks.includes('IPD 高風險對象') && !asks.includes('具原住民身分'), asks.join('、'));
await page.screenshot({ path: path.join(SHOTS, '3-merged-needs-input.png') });

await shadow(page, () => { const r = document.querySelector('#vaxcheck-panel').shadowRoot; [...r.querySelectorAll('.vx-check')].find((l) => l.textContent.includes('IPD 高風險')).querySelector('.vx-yes').click(); });
await sleep(600);
check('勾 IPD 高風險「是」→ 8 週路徑 → 可打', (await verdictOf(page, '肺炎鏈球菌')) === '可打');
check('面板分組(可接種在前)、判定依據 ✓ → 未確認 → ✗', ...(await checkLayout(page)));
await shadow(page, () => document.querySelector('#vaxcheck-panel').shadowRoot.querySelectorAll('.vx-why').forEach((d, i) => { if (i < 2) d.open = true; }));
await page.screenshot({ path: path.join(SHOTS, '4-panel-groups.png') });

// 身分不符
ni.card = 'Z999999999';
await niis.bringToFront(); await niis.goto(`${NIIS}/`); await niis.click('#btn_Query');
await niis.waitForSelector('#vaxcheck-toast', { state: 'attached', timeout: 8000 });
const t2 = await toastText(niis);
check('NIIS 身分不符 → 拒絕併入', /身分與健保雲端不同/.test(t2), t2);
await page.bringToFront(); await sleep(600);
const notice = await panelText(page, '.vx-notice');
check('健保雲端面板顯示身分不符警示', /不是同一位病患/.test(notice), notice);
check('不符的結果沒有覆蓋:肺鏈仍為可打', (await verdictOf(page, '肺炎鏈球菌')) === '可打');

// 換卡(既有偵測:UserID 改變 → 關面板、清 session)
mc.current = P2;
await page.goto(`${MC}/imu/IMUE1000/IMUE0008`);
await page.locator('#vaxcheck-fab >> button').waitFor();
await sleep(2500);
check('換卡後面板關閉', (await page.locator('#vaxcheck-panel').count()) === 0);
await page.locator('#vaxcheck-fab >> button').click();
await sleep(1500);
const who = await panelText(page, '.vx-who');
check('新病患顯示正確、接種史清空', who.includes('測試乙') && (await verdictOf(page, '肺炎鏈球菌')) !== '可打', who);

// 設定頁
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${EXT_ID}/options.html`);
await sleep(500);
check('設定頁載入縣市選單', (await opt.locator('#jur option').count()) >= 1);
check('設定頁顯示外掛版號', (await opt.locator('#ver').textContent()) === `v${PKG_VER}`);
check('設定頁有兩個網址欄與換卡開關', (await opt.inputValue('#medcloud')).startsWith(`${MC}/imu/`) && (await opt.inputValue('#niis')) === `${NIIS}/` && await opt.isChecked('#switch'));
await opt.waitForFunction(() => document.querySelector('#rstat')?.textContent !== '讀取中…', null, { timeout: 5000 }).catch(() => {});
check('設定頁顯示規則狀態', /內建 /.test(await opt.textContent('#rstat')), await opt.textContent('#rstat'));
await opt.click('#refresh');
await opt.waitForFunction(() => /已更新|更新失敗/.test(document.querySelector('#rmsg')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
check('立即更新規則有回應(成功或明確失敗)', /已更新|更新失敗/.test(await opt.textContent('#rmsg')), await opt.textContent('#rmsg'));
const alarm = await sw.evaluate(() => chrome.alarms.get('rules-daily'));
check('每日規則更新 alarm 已排程(1440 分)', alarm?.periodInMinutes === 1440, JSON.stringify(alarm));

// ───────── B. 標題列 icon → 工作區(以 workspace:open 觸發)─────────
await page.close(); await niis.close();
await sw.evaluate(() => chrome.storage.session.clear());
const openWs = () => opt.evaluate(() => chrome.runtime.sendMessage({ type: 'workspace:open' }));
const tab = (id) => sw.evaluate((i) => chrome.tabs.get(i), id);
const pageOf = (prefix) => until(async () => ctx.pages().find((p) => p.url().startsWith(prefix)), 10000);

// B1 設定未填 → 開設定頁
await sw.evaluate(() => chrome.storage.sync.set({ medcloudEntryUrl: '' }));
const r0 = await openWs();
const optProblem = await pageOf(`chrome-extension://${EXT_ID}/options.html?problem=`);
await optProblem?.waitForSelector('#problem:not([hidden])', { timeout: 5000 }).catch(() => {});
const probText = optProblem ? await optProblem.textContent('#problem') : '';
const mcTabs0 = await sw.evaluate(() => chrome.tabs.query({ url: 'https://medcloud2.nhi.gov.tw/*' }));
check('設定未填網址 → 開設定頁並提示、不開健保雲端', r0?.reason === 'options' && /健保雲端入口網址/.test(probText) && mcTabs0.length === 0, probText);
await optProblem?.close();
await sw.evaluate(() => chrome.storage.sync.remove('medcloudEntryUrl'));

// B2 全新:兩分頁、NIIS 背景、token 出現後才開面板與代按
await sw.evaluate(() => chrome.storage.sync.set({ autoClickNiis: true }));
mc.current = P1; mc.iccDelayMs = 3000; mc.tokenAt = []; mc.loginHits = []; ni.card = P1.UserID; ni.posts = []; ni.gets = 0;
const t0 = Date.now();
const r1 = await openWs();
check('workspace:open → 健保雲端新開、NIIS 新開', r1?.ok && r1.medcloud === 'create' && r1.niis === 'create', JSON.stringify(r1));
const [mcTab, niisTab] = [await tab(r1.medcloudTabId), await tab(r1.niisTabId)];
check('NIIS 為背景分頁,位於健保雲端右側', mcTab.active && !niisTab.active && niisTab.windowId === mcTab.windowId && niisTab.index === mcTab.index + 1, `mc#${mcTab.index} niis#${niisTab.index}`);
const mcPage = await pageOf(MC);
await sleep(Math.max(0, 1500 - (Date.now() - t0)));
check('token 出現前:不開面板、不按 NIIS 讀卡鈕', (await mcPage.locator('#vaxcheck-panel').count()) === 0 && ni.posts.length === 0 && mc.tokenAt.length === 0);
const opened = await until(async () => (await mcPage.locator('#vaxcheck-panel').count()) > 0, 15000);
check('token 出現後面板自動開啟', !!opened && mc.tokenAt.length > 0);
check('新開健保雲端 → ?type=icc 自動登入,不需按「實體健保卡」', mc.loginHits.join() === 'icc' && mc.loginBtnClicks === 0 && mcPage.url().endsWith('/imu/IMUE1000/IMUE2000'), `${mc.loginHits.join()};${mcPage.url()}`);
const merged = await until(async () => (await verdictOf(mcPage, '肺炎鏈球菌')) === '需確認', 20000);
check('autoClickNiis:token 出現後才代按,結果自動併回', !!merged && ni.posts.length === 1 && ni.posts[0].at > mc.tokenAt[0] && ni.posts[0].rocId === P1.UserID, `post-token ${ni.posts[0] ? ni.posts[0].at - mc.tokenAt[0] : '-'} ms`);
await sleep(2500);
check('同一次操作只代按一次', ni.posts.length === 1, `POST ${ni.posts.length}`);
check('B2 面板分組:順序正確、小標題筆數相符', ...(await checkLayout(mcPage)));
await shadow(mcPage, () => document.querySelector('#vaxcheck-panel').shadowRoot.querySelectorAll('.vx-why').forEach((d, i) => { if (i < 2) d.open = true; }));
await mcPage.screenshot({ path: path.join(SHOTS, '7-workspace-auto.png') });

// B3 再按 icon(同一病患、無換卡連結)→ 重新計算、不重複開面板、NIIS 不 reload
const niisPage = await pageOf(NIIS);
await niisPage.evaluate(() => { window.__marker = 1; });
await mcPage.evaluate(() => { document.getElementById('sw').textContent = '(無)'; });
const [g0, p0, l0] = [ni.gets, ni.posts.length, mc.loginHits.length];
const r2 = await openWs();
await sleep(3500);
const marker = await niisPage.evaluate(() => window.__marker).catch(() => null);
check('再按 icon:健保雲端切換、面板只有一個', r2?.medcloud === 'focus' && (await mcPage.locator('#vaxcheck-panel').count()) === 1 && (await verdictOf(mcPage, '肺炎鏈球菌')) === '需確認');
check('NIIS 同一病患 → 不 reload、不再代按', marker === 1 && ni.gets === g0 && ni.posts.length === p0, `GET +${ni.gets - g0}, POST +${ni.posts.length - p0}`);
check('已有 token → 不導向登入入口', mc.loginHits.length === l0);

// B4 換卡:代按「請換卡再按我」,2 秒後 token 換成新病患 → 面板換人;NIIS 不同病患 → 導回根網址
await mcPage.evaluate(() => { document.getElementById('sw').textContent = '請換卡再按我'; });
mc.next = P2; mc.switchDelayMs = 2000; ni.card = P2.UserID;
const [g1, p1] = [ni.gets, ni.posts.length];
await openWs();
const switched = await until(async () => (await panelText(mcPage, '.vx-who')).includes('測試乙'), 40000);
check('換卡連結:面板換成新病患', !!switched, await panelText(mcPage, '.vx-who'));
const navigated = await until(async () => ni.gets > g1 && ni.posts.length > p1, 15000);
check('NIIS 不同病患 → 導回根網址後代按', !!navigated && ni.posts.at(-1).rocId === P2.UserID, `GET +${ni.gets - g1}, POST +${ni.posts.length - p1}`);
await mcPage.screenshot({ path: path.join(SHOTS, '8-switch-card.png') });

// B5 空身分:未插卡仍送出 → 「查無接種紀錄」不可當 0 筆
mc.next = P1; ni.card = null;
const p2 = ni.posts.length;
await openWs();
await until(async () => (await panelText(mcPage, '.vx-who')).includes('測試甲'), 40000);
await until(async () => ni.posts.length > p2, 15000);
const noIdNotice = await until(async () => { const t = await panelText(mcPage, '.vx-notice'); return /NIIS 未讀到健保卡/.test(t) ? t : null; }, 15000);
check('空身分 → 健保雲端面板黃色提示「NIIS 未讀到健保卡」', !!noIdNotice && ni.posts.at(-1).rocId === '', noIdNotice || '');
const noticeTone = await shadow(mcPage, () => document.querySelector('#vaxcheck-panel').shadowRoot.querySelector('.vx-notice')?.className || '');
const pv = await verdictOf(mcPage, '肺炎鏈球菌');
const allText = await shadow(mcPage, () => [...document.querySelector('#vaxcheck-panel').shadowRoot.querySelectorAll('.vx-list')].map((l) => l.textContent).join(''));
check('空身分 → 肺鏈不可為可打/建議接種', pv === '待查接種史' && !/建議接種/.test(allText) && /vx-wait/.test(noticeTone), `${pv}(${noticeTone})`);
const niisToast = await until(async () => { const t = await toastText(niisPage); return /未讀到健保卡/.test(t) ? t : null; }, 5000);
check('NIIS 頁 toast 顯示「未讀到健保卡」', !!niisToast, niisToast || '');
const stored = await sw.evaluate(async () => (await chrome.storage.session.get('niis')).niis);
check('空身分結果未寫入 storage.session', !stored);
await mcPage.screenshot({ path: path.join(SHOTS, '9-no-identity.png') });

// B6 既有分頁停在登入頁 → 導向 ?type=icc;type=icc 無效 → 15 秒後代按「實體健保卡」一次 → 登入成功
ni.card = P1.UserID; mc.iccWorks = false; mc.loginBtnClicks = 0;
await mcPage.goto(`${MC}/imu/IMUE1000/`);   // 登入頁會清空 sessionStorage
mc.loginHits = [];
const tB6 = Date.now();
await openWs();
const toIcc = await until(async () => mc.loginHits.includes('icc'), 10000);
check('登入頁 → 導向 ?type=icc', !!toIcc, mc.loginHits.join());
await sleep(10000);
check('15 秒內不代按登入按鈕', mc.loginBtnClicks === 0);
const loggedIn = await until(async () => (await panelText(mcPage, '.vx-who')).includes('測試甲'), 30000);
check('type=icc 無效 → 15 秒後代按「實體健保卡」一次 → 面板開啟', !!loggedIn && mc.loginBtnClicks === 1, `${((Date.now() - tB6) / 1000).toFixed(1)} 秒`);
await sleep(1500);
check('備援只點一次', mc.loginBtnClicks === 1);
await mcPage.screenshot({ path: path.join(SHOTS, '10-login-fallback.png') });
mc.iccWorks = true;

// B7 設定升級遷移(重啟瀏覽器 = service worker 重新啟動):舊預設值換新,自訂值保留
const OLD_ENTRY = `${MC}/imu/IMUE1000/IMUE2000`;
const NEW_ENTRY = `${MC}/imu/IMUE1000/?type=icc`;
const CUSTOM = `${MC}/imu/IMUE1000/IMUE0008`;
const entryAfterRestart = async (value) => {
  await sw.evaluate((v) => chrome.storage.sync.set({ medcloudEntryUrl: v }), value);
  await ctx.close();
  ctx = await launch();
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  let v = null;
  const end = Date.now() + 5000;
  do { v = await sw.evaluate(async () => (await chrome.storage.sync.get('medcloudEntryUrl')).medcloudEntryUrl); if (v !== value) break; await sleep(250); } while (Date.now() < end);
  return v;
};
const migrated = await entryAfterRestart(OLD_ENTRY);
check('設定遷移:舊預設 IMUE2000 → ?type=icc', migrated === NEW_ENTRY, migrated);
const kept = await entryAfterRestart(CUSTOM);
check('設定遷移:自訂值保留', kept === CUSTOM, kept);

// ───────── C. 面板四組 + 保底/升級(示範頁:同一套引擎與面板,asOf 可固定)─────────
const demo = await ctx.newPage();
await demo.goto('file://' + path.join(ROOT, 'dist/web/index.html'));
await demo.waitForSelector('#samples button');
const setAsOf = (d) => demo.evaluate((v) => { const el = document.querySelector('#asof'); el.value = v; el.dispatchEvent(new Event('change')); }, d);
const pick = async (id) => { await demo.click(`#samples button[data-id="${id}"]`); await sleep(150); };
const dLayout = () => demo.evaluate(() => {
  const r = document.querySelector('#panel-host').shadowRoot;
  return [...r.querySelectorAll('.vx-grp')].map((g) => ({ t: g.firstChild.textContent, n: Number(g.querySelector('.vx-grp-n').textContent),
    items: [...g.nextElementSibling.querySelectorAll(':scope > .vx-v')].map((li) => li.querySelector('.vx-name').firstChild.textContent) }));
});
const dCard = (name) => demo.evaluate((n) => {
  const li = [...document.querySelector('#panel-host').shadowRoot.querySelectorAll('.vx-v')].find((x) => x.querySelector('.vx-name').textContent.includes(n));
  return li && { word: li.querySelector('.vx-verdict').textContent, line: li.querySelector('.vx-line')?.textContent || '', up: li.querySelector('.vx-upline')?.textContent || '',
    opt: li.querySelector('.vx-opt summary')?.textContent || '', asks: [...li.querySelectorAll('.vx-ask .vx-check > span:first-child')].map((s) => s.firstChild.textContent) };
}, name);
const dClick = (name, fn) => demo.evaluate(([n, f]) => {
  const li = [...document.querySelector('#panel-host').shadowRoot.querySelectorAll('.vx-v')].find((x) => x.querySelector('.vx-name').textContent.includes(n));
  if (f === 'allno') li.querySelector('.vx-allno').click();
  else [...li.querySelectorAll('.vx-check')].find((c) => c.textContent.includes(f)).querySelector('.vx-yes').click();
}, [name, fn]);
const where = (lay, name) => lay.find((g) => g.items.some((x) => x.includes(name)))?.t;
const seen = new Set();
const orderOk = (lay) => { lay.forEach((g) => seen.add(g.t)); const idx = lay.map((g) => ORDER.indexOf(g.t)); return idx.every((x, i) => x >= 0 && (i === 0 || x > idx[i - 1])) && lay.every((g) => g.n === g.items.length && g.n > 0); };

await setAsOf('2026-10-15');
await pick('J');
let lay = await dLayout();
let flu = await dCard('流感');
check('C1 10/15 55 歲:流感在「待確認」(3a)', where(lay, '流感') === '待確認' && orderOk(lay), JSON.stringify(lay.map((g) => [g.t, g.n])));
check('C1 3a 保底行:已符合第二階段,115/11/02 起可打', /已符合第二階段/.test(flu.line) && /115\/11\/02 起可打/.test(flu.line), flu.line);
check('C1 3a 升級行:若確認 → 屬第一階段,今天即可打;含潛在疾病是/否', /若確認/.test(flu.up) && /屬第一階段,今天即可打/.test(flu.up) && flu.asks.some((a) => a.startsWith('具潛在疾病')), `${flu.up}|${flu.asks.length} 項`);
await demo.screenshot({ path: path.join(SHOTS, '11-demo-3a-flu.png'), fullPage: true });

await dClick('流感', '具潛在疾病');
await sleep(150);
lay = await dLayout();
check('C2 勾潛在疾病「是」→ 流感移到「可接種」', where(lay, '流感') === '可接種' && orderOk(lay), JSON.stringify(lay.map((g) => [g.t, g.n])));
await demo.screenshot({ path: path.join(SHOTS, '12-demo-yes-eligible.png'), fullPage: true });

await pick('J');
await dClick('流感', 'allno');
await sleep(300);
lay = await dLayout();
flu = await dCard('流感');
check('C3 第一階段條件「以上皆否」→ 流感移到「尚未開打」,115/11/02 起可打(第二階段)', where(lay, '流感') === '尚未開打' && flu.line.includes('115/11/02 起可打(第二階段') && orderOk(lay), `${flu.word}|${flu.line}`);
await demo.screenshot({ path: path.join(SHOTS, '13-demo-no-not-open.png'), fullPage: true });

await pick('K');
lay = await dLayout();
let pn = await dCard('肺炎鏈球菌');
check('C4 肺鏈 PCV13 10 週:待確認,保底 116/08/06、升級今天(8 週)', where(lay, '肺炎鏈球菌') === '待確認' && /116\/08\/06 起可打/.test(pn.line) && /今天可打/.test(pn.up), `${pn.line}|${pn.up}`);
await demo.screenshot({ path: path.join(SHOTS, '14-demo-3a-pneumo.png'), fullPage: true });
await dClick('肺炎鏈球菌', 'allno');
await sleep(300);
lay = await dLayout();
check('C4 肺鏈「以上皆否」→ 尚未開打(1 年路徑)', where(lay, '肺炎鏈球菌') === '尚未開打' && orderOk(lay), JSON.stringify(lay.map((g) => [g.t, g.n])));

await pick('H');
lay = await dLayout();
check('C5 自費 PPV23 + 公費 PCV13 → 肺鏈在「不符合」(不再公費)', where(lay, '肺炎鏈球菌') === '不符合' && (await dCard('肺炎鏈球菌')).word === '不再公費' && orderOk(lay), JSON.stringify(lay.map((g) => [g.t, g.n])));
check('C 四組小標題皆出現且順序正確', ORDER.every((t) => seen.has(t)), ORDER.filter((t) => seen.has(t)).join('→'));

await setAsOf('2026-09-28');
await pick('J');
lay = await dLayout();
flu = await dCard('流感');
check('C6 9/28 55 歲:流感在「尚未開打」,選填提示可提早至 115/10/01,不列入待確認', where(lay, '流感') === '尚未開打' && /可提早至 115\/10\/01/.test(flu.opt) && flu.asks.length === 0, flu.opt);
await demo.screenshot({ path: path.join(SHOTS, '15-demo-3b-flu-0928.png'), fullPage: true });
await demo.close();

await ctx.close();
sites.close();
const fail = results.filter(([, ok]) => !ok).length;
console.log(`\n端對端 ${results.length - fail}/${results.length}`);
process.exit(fail ? 1 : 0);
