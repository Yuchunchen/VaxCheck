import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { createWorkspace, decideNiis, shouldAutoClick, AUTORUN_TIMEOUT_MS } from '../src/workspace/workspace.js';
import { DEFAULTS, validateWorkspaceOptions, readOptions } from '../src/workspace/options.js';
import { switchCard, waitForToken, findSwitchLink, isLoginUrl } from '../src/workspace/switch.js';
import { makeCodeTable, parseNiisDocument, niisVaccinations } from '../src/adapters/niis/parse.js';
import { buildFacts } from '../src/adapters/nhi/facts.js';
import { evaluate } from '../src/engine/index.js';
import { rules } from './helpers.mjs';

const MC = 'https://medcloud2.nhi.gov.tw';
const NIIS = 'https://10.241.219.35';

/** 最小 chrome mock:分頁、視窗、storage.session、runtime.getURL */
function mockChrome({ tabs = [], contentReplies = true } = {}) {
  let nextId = 100;
  const list = tabs.map((t, i) => ({ windowId: 1, index: i, active: false, lastAccessed: 0, ...t }));
  const calls = { create: [], update: [], reload: [], sendMessage: [], windows: [] };
  const mem = {};
  const reindex = () => list.forEach((t, i) => { t.index = i; });
  const chrome = {
    calls, list, mem,
    runtime: { getURL: (p) => `chrome-extension://x/${p}` },
    windows: { update: async (id, info) => { calls.windows.push([id, info]); } },
    tabs: {
      query: async ({ url }) => list.filter((t) => t.url.startsWith(url.replace(/\*$/, ''))).map((t) => ({ ...t })),
      get: async (id) => { const t = list.find((x) => x.id === id); if (!t) throw new Error('no tab'); return { ...t }; },
      create: async (props) => {
        calls.create.push(props);
        const t = { id: nextId++, windowId: props.windowId ?? 1, active: props.active !== false, url: props.url, lastAccessed: 0 };
        if (t.active) list.forEach((x) => { x.active = false; });
        list.splice(props.index ?? list.length, 0, t); reindex();
        return { ...t };
      },
      update: async (id, props) => { calls.update.push([id, props]); const t = list.find((x) => x.id === id); if (props.url) t.url = props.url; if (props.active) { list.forEach((x) => { x.active = false; }); t.active = true; } return { ...t }; },
      reload: async (id) => { calls.reload.push(id); },
      sendMessage: async (id, msg) => {
        calls.sendMessage.push([id, msg]);
        if (typeof contentReplies === 'function') return contentReplies(id, msg);
        if (!contentReplies) throw new Error('Could not establish connection');
        return msg.type === 'niis:autoclick' ? { ok: true, clicked: true } : { ok: true };
      },
    },
    storage: { session: {
      get: async (k) => (k in mem ? { [k]: structuredClone(mem[k]) } : {}),
      set: async (o) => { for (const [k, v] of Object.entries(o)) mem[k] = structuredClone(v); },
      remove: async (k) => { for (const x of [].concat(k)) delete mem[x]; },
    } },
  };
  return chrome;
}

function setup({ tabs, options = {}, current = 'H1', contentReplies, clock = { t: 1_000_000 } } = {}) {
  const chrome = mockChrome({ tabs, contentReplies });
  let n = 0;
  const ws = createWorkspace({
    chrome, getOptions: async () => ({ ...DEFAULTS, ...options }), getCurrentIdHash: async () => current,
    now: () => clock.t, newId: () => `op${++n}`, log: () => {},
  });
  return { chrome, ws, clock };
}

const MC_TAB = { id: 1, url: `${MC}/imu/IMUE1000/IMUE0008`, lastAccessed: 5 };
const NIIS_TAB = { id: 2, url: `${NIIS}/` };

// ── openWorkspace 分頁決策:健保雲端(無/有)× NIIS(無/同病患/不同病患/未查詢)──
const NIIS_CASES = {
  無: { tabs: [], prep: null, expect: 'create' },
  同病患: { tabs: [NIIS_TAB], prep: async (ws) => { await ws.niisPage(2, { url: `${NIIS}/`, hasResult: true }); await ws.niisParsed(2, 'H1'); }, expect: 'keep' },
  不同病患: { tabs: [NIIS_TAB], prep: async (ws) => { await ws.niisPage(2, { url: `${NIIS}/`, hasResult: true }); await ws.niisParsed(2, 'H9'); }, expect: 'navigate' },
  未查詢: { tabs: [NIIS_TAB], prep: async (ws) => { await ws.niisPage(2, { url: `${NIIS}/`, hasResult: false }); }, expect: 'navigate' },
};
for (const mcExists of [false, true]) {
  for (const [label, c] of Object.entries(NIIS_CASES)) {
    test(`openWorkspace:健保雲端${mcExists ? '有' : '無'} × NIIS ${label}`, async () => {
      const { chrome, ws } = setup({ tabs: [...(mcExists ? [MC_TAB] : []), ...c.tabs] });
      if (c.prep) await c.prep(ws);
      const r = await ws.open();
      assert.equal(r.ok, true);
      // 健保雲端:有 → 切過去並聚焦視窗、通知 content script;無 → 開 medcloudEntryUrl
      if (mcExists) {
        assert.equal(r.medcloud, 'focus');
        assert.deepEqual(chrome.calls.update[0], [1, { active: true }]);
        assert.equal(chrome.calls.windows.length, 1);
        assert.deepEqual(chrome.calls.sendMessage[0][1].type, 'workspace:run');
        assert.equal(chrome.calls.sendMessage[0][1].switchCard, true);
      } else {
        assert.equal(r.medcloud, 'create');
        assert.deepEqual(chrome.calls.create[0], { url: DEFAULTS.medcloudEntryUrl, active: true });
      }
      const pending = chrome.mem.pendingAutoRun;
      assert.deepEqual([pending.tabId, typeof pending.ts], [r.medcloudTabId, 'number']);
      // NIIS 無 → 立即背景新開於健保雲端右側;有 → 等健保雲端確認病患
      const mcTab = chrome.list.find((t) => t.id === r.medcloudTabId);
      if (c.expect === 'create') {
        const niisCreate = chrome.calls.create.find((x) => x.url === DEFAULTS.niisQueryUrl);
        assert.deepEqual(niisCreate, { url: DEFAULTS.niisQueryUrl, active: false, windowId: mcTab.windowId, index: mcTab.index + 1 });
        assert.equal(r.niis, 'create');
      } else assert.equal(r.niis, 'deferred');
      const navBefore = chrome.calls.update.filter(([id, p]) => id === 2 && p.url).length;
      assert.equal(navBefore, 0, '健保雲端確認病患前不動 NIIS 分頁');
      const ready = await ws.medcloudReady(r.medcloudTabId, r.opId, 'H1');
      assert.equal(ready.niis, c.expect);
      const nav = chrome.calls.update.filter(([id, p]) => id === 2 && p.url);
      assert.deepEqual(nav, c.expect === 'navigate' ? [[2, { url: DEFAULTS.niisQueryUrl }]] : [], '同病患不可 reload;不同/未查詢導回查詢頁');
      assert.equal(chrome.calls.reload.length, 0);
      assert.equal(chrome.mem.pendingAutoRun, undefined, '取得 token 後清除 pendingAutoRun');
    });
  }
}

test('decideNiis', () => {
  assert.equal(decideNiis(null, null, 'H1'), 'create');
  assert.equal(decideNiis({ id: 2 }, { idHash: 'H1' }, 'H1'), 'keep');
  assert.equal(decideNiis({ id: 2 }, { idHash: 'H2' }, 'H1'), 'navigate');
  assert.equal(decideNiis({ id: 2 }, { idHash: null }, 'H1'), 'navigate');
  assert.equal(decideNiis({ id: 2 }, undefined, 'H1'), 'navigate');
});

test('既有健保雲端分頁沒有 content script(外掛剛更新)→ 重新整理該分頁', async () => {
  const { chrome, ws } = setup({ tabs: [MC_TAB], contentReplies: false });
  await ws.open();
  assert.deepEqual(chrome.calls.reload, [1]);
});

test('autoSwitchCard 關閉 → 不代按換卡', async () => {
  const { chrome, ws } = setup({ tabs: [MC_TAB], options: { autoSwitchCard: false } });
  await ws.open();
  assert.equal(chrome.calls.sendMessage[0][1].switchCard, false);
});

test('設定網址為空或格式錯誤 → 開設定頁,不開任何分頁', async () => {
  for (const bad of [{ medcloudEntryUrl: '' }, { niisQueryUrl: 'not a url' }, { niisQueryUrl: 'https://example.com/' }]) {
    const { chrome, ws } = setup({ options: bad });
    const r = await ws.open();
    assert.equal(r.reason, 'options');
    assert.equal(chrome.calls.create.length, 1);
    assert.match(chrome.calls.create[0].url, /options\.html\?problem=/);
  }
  assert.equal(validateWorkspaceOptions(DEFAULTS), null);
});

test('舊設定 niisUrl 沿用為 niisQueryUrl', async () => {
  const sync = { get: async () => ({ niisUrl: 'https://10.241.219.35/query' }) };
  assert.equal((await readOptions(sync)).niisQueryUrl, 'https://10.241.219.35/query');
  const sync2 = { get: async () => ({ niisUrl: 'https://10.241.219.35/old', niisQueryUrl: 'https://10.241.219.35/' }) };
  assert.equal((await readOptions(sync2)).niisQueryUrl, 'https://10.241.219.35/');
});

test('代按換卡後頁面重新載入 → 不再代按第二次', async () => {
  const { ws } = setup({ tabs: [MC_TAB] });
  const r = await ws.open();
  assert.equal((await ws.autorunGet(1)).switchCard, true);
  await ws.autorunSwitching(r.opId);
  assert.equal((await ws.autorunGet(1)).switchCard, false);
});

test('pendingAutoRun:只給該分頁,超過 120 秒清除', async () => {
  const { chrome, ws, clock } = setup();
  const r = await ws.open();
  assert.equal(await ws.autorunGet(999), null);
  assert.equal((await ws.autorunGet(r.medcloudTabId)).opId, r.opId);
  clock.t += AUTORUN_TIMEOUT_MS + 1;
  assert.equal(await ws.autorunGet(r.medcloudTabId), null);
  assert.equal(chrome.mem.pendingAutoRun, undefined);
});

// ── autoClickNiis 條件:4 個缺任一都不點;同一次操作不重複點 ──
test('shouldAutoClick:四個條件缺任一都不點', () => {
  const now = 1_000_000;
  const op = { opId: 'op1', ts: now - 1000, niisTabId: 2, medcloudIdHash: 'H1', clicked: false };
  const page = { tabId: 2, url: `${NIIS}/`, hasResult: false, pending: false };
  const base = { enabled: true, op, page, niisQueryUrl: `${NIIS}/`, currentIdHash: 'H1', now };
  assert.equal(shouldAutoClick(base).ok, true);
  assert.equal(shouldAutoClick({ ...base, enabled: false }).ok, false, '設定關閉');
  assert.equal(shouldAutoClick({ ...base, op: null }).reason, 'not_from_icon', '1. 非來自按 icon');
  assert.equal(shouldAutoClick({ ...base, op: { ...op, ts: now - 10 * 60e3 } }).reason, 'not_from_icon', '1. 操作已過期');
  assert.equal(shouldAutoClick({ ...base, op: { ...op, medcloudIdHash: null } }).reason, 'medcloud_not_ready', '2. 健保雲端尚未取得 token');
  assert.equal(shouldAutoClick({ ...base, currentIdHash: 'H2' }).reason, 'medcloud_not_ready', '2. 之後又換了病患');
  assert.equal(shouldAutoClick({ ...base, page: { ...page, hasResult: true } }).reason, 'niis_not_fresh', '3. 已有 #div_result');
  assert.equal(shouldAutoClick({ ...base, page: { ...page, url: `${NIIS}/other` } }).reason, 'niis_not_fresh', '3. 不在查詢頁');
  assert.equal(shouldAutoClick({ ...base, page: { ...page, pending: true } }).reason, 'niis_not_fresh', '3. 尚在載入');
  assert.equal(shouldAutoClick({ ...base, page: null }).reason, 'niis_not_fresh', '3. 分頁未回報');
  assert.equal(shouldAutoClick({ ...base, op: { ...op, clicked: true } }).reason, 'already_clicked', '4. 本次已點過');
});

test('代按 NIIS:token 出現前不點;之後只點一次(頁面訊息與 ready 同時到也一樣)', async () => {
  const { chrome, ws } = setup({ options: { autoClickNiis: true } });
  const r = await ws.open();
  await ws.niisPage(r.niisTabId, { url: `${NIIS}/`, hasResult: false });
  const clicks = () => chrome.calls.sendMessage.filter(([, m]) => m.type === 'niis:autoclick').length;
  assert.equal(clicks(), 0, 'NIIS 頁已就緒但健保雲端尚未取得 token');
  await Promise.all([ws.medcloudReady(r.medcloudTabId, r.opId, 'H1'), ws.niisPage(r.niisTabId, { url: `${NIIS}/`, hasResult: false }), ws.tryAutoClick()]);
  await ws.tryAutoClick();
  assert.equal(clicks(), 1);
});

test('代按 NIIS:設定關閉 → 不點', async () => {
  const { chrome, ws } = setup({ options: { autoClickNiis: false } });
  const r = await ws.open();
  await ws.niisPage(r.niisTabId, { url: `${NIIS}/`, hasResult: false });
  await ws.medcloudReady(r.medcloudTabId, r.opId, 'H1');
  assert.equal(chrome.calls.sendMessage.filter(([, m]) => m.type === 'niis:autoclick').length, 0);
});

test('代按 NIIS:同一病患保留結果 → 不點', async () => {
  const { chrome, ws } = setup({ tabs: [NIIS_TAB], options: { autoClickNiis: true } });
  await ws.niisPage(2, { url: `${NIIS}/`, hasResult: true }); await ws.niisParsed(2, 'H1');
  const r = await ws.open();
  await ws.medcloudReady(r.medcloudTabId, r.opId, 'H1');
  assert.equal(chrome.calls.sendMessage.filter(([, m]) => m.type === 'niis:autoclick').length, 0);
});

test('代按 NIIS:不同病患 → 導回查詢頁,新頁回報後才點', async () => {
  const { chrome, ws } = setup({ tabs: [NIIS_TAB], options: { autoClickNiis: true } });
  await ws.niisPage(2, { url: `${NIIS}/`, hasResult: true }); await ws.niisParsed(2, 'H9');
  const r = await ws.open();
  await ws.medcloudReady(r.medcloudTabId, r.opId, 'H1');
  const clicks = () => chrome.calls.sendMessage.filter(([, m]) => m.type === 'niis:autoclick').length;
  assert.equal(clicks(), 0, '導回中(pending)不點');
  await ws.niisPage(2, { url: `${NIIS}/`, hasResult: false });
  assert.equal(clicks(), 1);
});

test('ready 訊息的 opId 或分頁不符 → 忽略', async () => {
  const { ws } = setup();
  const r = await ws.open();
  assert.equal((await ws.medcloudReady(r.medcloudTabId, 'other', 'H1')).ok, false);
  assert.equal((await ws.medcloudReady(12345, r.opId, 'H1')).ok, false);
});

// ── 換卡流程 ──
function fakeClock() { const c = { t: 0, now: () => c.t, sleep: async (ms) => { c.t += ms; } }; return c; }
function fakePage({ url = `${MC}/imu/IMUE1000/IMUE0008`, link = true, changeAt = null, from = 'H1', to = 'H2' }) {
  const clock = fakeClock();
  let clickedAt = null;
  const a = link ? { click: () => { clickedAt = clock.t; } } : null;
  return {
    clock, get clickedAt() { return clickedAt; },
    deps: { url: () => url, findLink: () => a, clock, token: () => 'tok',
      idHash: async () => (clickedAt !== null && changeAt !== null && clock.t - clickedAt >= changeAt ? to : from) },
  };
}

test('換卡:有連結且 UserID 改變 → switched', async () => {
  const p = fakePage({ changeAt: 2000 });
  assert.deepEqual(await switchCard(p.deps), { result: 'switched' });
  assert.equal(p.clickedAt, 0);
  assert.ok(p.clock.t >= 2000 && p.clock.t < 3000, '每 500ms 輪詢,約 2 秒偵測到');
});

test('換卡:有連結但 30 秒內未變 → same', async () => {
  const p = fakePage({ changeAt: null });
  assert.deepEqual(await switchCard(p.deps), { result: 'same' });
  assert.ok(p.clock.t >= 30000 && p.clock.t <= 30500);
});

test('換卡:找不到連結 → nolink(不等待)', async () => {
  const p = fakePage({ link: false });
  assert.deepEqual(await switchCard(p.deps), { result: 'nolink' });
  assert.equal(p.clock.t, 0);
});

test('換卡:停在登入頁 → login(不代按),等 token 逾時回 null', async () => {
  for (const url of [`${MC}/imu/login`, `${MC}/imu/IMUE1000/IMUE0001`]) {
    const p = fakePage({ url });
    assert.deepEqual(await switchCard(p.deps), { result: 'login' });
    assert.equal(p.clickedAt, null);
    assert.equal(await waitForToken(p.deps, { deadline: 120000 }), null, '登入頁不開面板,只等 token');
    assert.ok(p.clock.t >= 120000);
  }
  assert.equal(isLoginUrl(`${MC}/imu/IMUE1000/IMUE2000`), false);
});

test('等 token:出現即返回', async () => {
  const clock = fakeClock();
  const tok = await waitForToken({ url: () => `${MC}/imu/IMUE1000/IMUE2000`, token: () => (clock.t >= 1500 ? 'tok' : null), clock }, { deadline: 120000 });
  assert.equal(tok, 'tok');
  assert.equal(clock.t, 1500);
});

test('findSwitchLink:請換卡再按我/請掃描再按我', () => {
  const { document } = parseHTML('<html><body><a>其他</a><a href="#"> 請掃描再按我 </a></body></html>');
  assert.equal(findSwitchLink(document).textContent.trim(), '請掃描再按我');
  assert.equal(findSwitchLink(parseHTML('<html><body><a>x</a></body></html>').document), null);
});

// ── A4 空身分查詢 ──
const table = makeCodeTable(JSON.parse(fs.readFileSync('rules/niis-vaccine-codes.json', 'utf8')));
const doc = (f) => parseHTML(fs.readFileSync(f, 'utf8')).document;
const hash = async (s) => `h:${s}`;

test('空 #tb_RocID +「本個案查無接種紀錄」→ error/niis_no_identity,不可是 ok 0 筆', async () => {
  const parsed = parseNiisDocument(doc('fixtures/niis/result_empty_noid.html'), table);
  assert.equal(parsed.meta.emptyMessage, '本個案查無接種紀錄');
  const v = await niisVaccinations(parsed, hash);
  assert.deepEqual(v, { status: 'error', reason: 'niis_no_identity', records: [], idHash: null });
  // 若誤當 ok 0 筆會怎樣:肺鏈 68 歲 → 可打(這正是要擋的);error 則維持待查接種史
  const facts = (vacc) => buildFacts({ user: { sex: 'M', birthDate: '1958-03-02' }, med: { robject: [] }, lab: { robject: [] }, allergy: { robject: [] }, summary: { robject: [] }, lftp: { robject: { drugs: [], medical_service: [], special_material: [] } }, vaccinations: vacc });
  const pv = (vacc) => evaluate(facts(vacc), rules(), { asOf: '2026-09-27' }).vaccines.find((x) => x.vaccineId === 'PNEUMO_PCV20_21').verdict;
  assert.equal(pv({ status: 'ok', records: [] }), 'eligible', '對照組:ok 0 筆 → 從未接種 → 可打');
  assert.notEqual(pv(v), 'eligible');
});

test('無法算出身分雜湊 → error;有身分 → ok', async () => {
  const parsed = parseNiisDocument(doc('fixtures/niis/result_empty.html'), table);
  assert.equal((await niisVaccinations(parsed, async () => { throw new Error('x'); })).reason, 'niis_no_identity');
  assert.equal((await niisVaccinations(parsed, async () => '')).reason, 'niis_no_identity');
  assert.deepEqual(await niisVaccinations(parsed, hash), { status: 'ok', records: [], idHash: 'h:B223456789' });
  assert.equal(await niisVaccinations(parseNiisDocument(parseHTML('<html><body><input id="tb_RocID" value=""></body></html>').document, table), hash), null, '沒有結果表 → 不處理');
});

// ── v0.4.10 健保雲端自動登入 ──
import { decideMedcloud, loginStep, findLoginButton, onLoginPage, LOGIN_FALLBACK_MS, LOGIN_MESSAGE_MS } from '../src/workspace/login.js';
import { migrateOptions, OLD_DEFAULT_ENTRY } from '../src/workspace/options.js';

test('預設入口 = /imu/IMUE1000/?type=icc', () => {
  assert.equal(DEFAULTS.medcloudEntryUrl, `${MC}/imu/IMUE1000/?type=icc`);
});

test('decideMedcloud:登入頁/無 token → 導向;已有 token → 不導向;換卡逾時且無連結 → 導向;每次最多一次', () => {
  const main = `${MC}/imu/IMUE1000/IMUE2000`;
  assert.equal(decideMedcloud({ hasToken: false, url: `${MC}/imu/IMUE1000/` }), 'navigate', '停在 /imu/IMUE1000/ 無 token');
  assert.equal(decideMedcloud({ hasToken: true, url: `${MC}/imu/login` }), 'navigate', '/imu/login');
  assert.equal(decideMedcloud({ hasToken: false, url: `${MC}/imu/IMUE1000/IMUE0001` }), 'navigate', 'IMUE0001');
  assert.equal(decideMedcloud({ hasToken: false, url: main }), 'navigate', '主畫面但無 token');
  assert.equal(decideMedcloud({ hasToken: true, url: main }), 'stay', '已登入不可導向 ?type=icc');
  assert.equal(decideMedcloud({ hasToken: true, url: `${MC}/imu/IMUE1000/` }), 'stay', 'base 但有 token');
  assert.equal(decideMedcloud({ hasToken: true, url: main, switchTimedOut: true, linkFound: true }), 'stay', '換卡逾時但仍有連結');
  assert.equal(decideMedcloud({ hasToken: true, url: main, switchTimedOut: true, linkFound: false }), 'navigate', '換卡逾時且找不到連結');
  assert.equal(decideMedcloud({ hasToken: false, url: `${MC}/imu/login`, loginNavigated: true }), 'stay', '本次已導向過');
  assert.equal(onLoginPage(`${MC}/imu/IMUE1000/?type=icc`, false), true);
});

test('分頁決策:既有分頁在登入頁 → 導向 ?type=icc 一次', async () => {
  const { chrome, ws } = setup({ tabs: [{ ...MC_TAB, url: `${MC}/imu/IMUE1000/` }] });
  const r = await ws.open();
  const a = await ws.medcloudState(1, { opId: r.opId, hasToken: false, url: `${MC}/imu/IMUE1000/` });
  assert.equal(a.action, 'navigate');
  assert.deepEqual(chrome.calls.update.filter(([id, p]) => id === 1 && p.url), [[1, { url: DEFAULTS.medcloudEntryUrl }]]);
  const p = chrome.mem.pendingAutoRun;
  assert.deepEqual([p.loginNavigated, typeof p.loginAt, p.switchCard], [true, 'number', false], '導向後不再代按換卡');
  assert.equal((await ws.medcloudState(1, { opId: r.opId, hasToken: false, url: `${MC}/imu/IMUE1000/?type=icc` })).action, 'stay', '導向後的新頁不再導向');
  assert.equal(chrome.calls.update.filter(([id, p2]) => id === 1 && p2.url).length, 1);
});

test('分頁決策:既有分頁已有 token → 不導向,走換卡', async () => {
  const { chrome, ws } = setup({ tabs: [MC_TAB] });
  const r = await ws.open();
  assert.equal((await ws.medcloudState(1, { opId: r.opId, hasToken: true, url: MC_TAB.url })).action, 'stay');
  assert.equal(chrome.calls.update.filter(([, p]) => p.url).length, 0);
  assert.equal(chrome.mem.pendingAutoRun.switchCard, true);
});

test('分頁決策:換卡逾時且無連結 → 導向一次;再逾時不再導向', async () => {
  const { chrome, ws } = setup({ tabs: [MC_TAB] });
  const r = await ws.open();
  const st = { opId: r.opId, hasToken: true, url: MC_TAB.url, switchTimedOut: true, linkFound: false };
  assert.equal((await ws.medcloudState(1, st)).action, 'navigate');
  assert.equal((await ws.medcloudState(1, st)).action, 'stay');
  assert.equal(chrome.calls.update.filter(([, p]) => p.url).length, 1);
});

test('分頁決策:新開的健保雲端視為已導向(登入頁不再導向)、opId 不符忽略', async () => {
  const { chrome, ws } = setup();
  const r = await ws.open();
  assert.equal(chrome.mem.pendingAutoRun.loginNavigated, true);
  assert.equal((await ws.medcloudState(r.medcloudTabId, { opId: r.opId, hasToken: false, url: DEFAULTS.medcloudEntryUrl })).action, 'stay');
  assert.equal((await ws.medcloudState(r.medcloudTabId, { opId: 'x', hasToken: false, url: `${MC}/imu/login` })).action, 'stay');
});

test('登入備援:每次按 icon 最多點一次', async () => {
  const { ws } = setup();
  const r = await ws.open();
  assert.equal((await ws.loginFallback(r.medcloudTabId, r.opId)).ok, true);
  assert.equal((await ws.loginFallback(r.medcloudTabId, r.opId)).ok, false);
  assert.equal((await ws.autorunGet(r.medcloudTabId)).fallbackClickedAt > 0, true);
  const r2 = await ws.open();   // 再按一次 icon → 新的一次機會
  assert.equal((await ws.loginFallback(r2.medcloudTabId, r2.opId)).ok, true);
});

test('loginStep:15 秒後點登入按鈕,再 30 秒提示;有 token 即完成', () => {
  const login = `${MC}/imu/IMUE1000/?type=icc`;
  const base = { url: login, hasToken: false, loginAt: 0, fallbackClickedAt: null, buttonFound: true, messageShown: false };
  assert.equal(loginStep({ ...base, now: LOGIN_FALLBACK_MS - 1 }), 'wait');
  assert.equal(loginStep({ ...base, now: LOGIN_FALLBACK_MS }), 'click');
  assert.equal(loginStep({ ...base, now: LOGIN_FALLBACK_MS, buttonFound: false }), 'wait', '找不到按鈕不點');
  const clicked = { ...base, fallbackClickedAt: 16000 };
  assert.equal(loginStep({ ...clicked, now: 16000 + LOGIN_MESSAGE_MS - 1 }), 'wait', '已點過不再點');
  assert.equal(loginStep({ ...clicked, now: 16000 + LOGIN_MESSAGE_MS }), 'message');
  assert.equal(loginStep({ ...clicked, now: 99999, messageShown: true }), 'wait');
  assert.equal(loginStep({ ...base, now: LOGIN_FALLBACK_MS + LOGIN_MESSAGE_MS, buttonFound: false }), 'message', '沒有按鈕也在 45 秒提示');
  assert.equal(loginStep({ ...base, now: 1, hasToken: true, url: `${MC}/imu/IMUE1000/IMUE2000` }), 'done');
  assert.equal(loginStep({ ...base, now: 99999, loginAt: null }), 'wait', '未導向登入頁 → 不做備援');
});

test('findLoginButton:a.login-btn,全形或半形括號皆可', () => {
  const d = (h) => parseHTML(`<html><body>${h}</body></html>`).document;
  assert.ok(findLoginButton(d('<a class="login-btn">虛擬健保卡</a><a class="login-btn"> 健保雲端系統2.0 (實體健保卡) </a>')));
  assert.ok(findLoginButton(d('<a class="login-btn">健保雲端系統2.0(實體健保卡)</a>')));
  assert.equal(findLoginButton(d('<a>健保雲端系統2.0(實體健保卡)</a>')), null, '需為 a.login-btn');
  assert.equal(findLoginButton(d('<a class="login-btn">健保雲端系統2.0(虛擬健保卡)</a>')), null);
});

test('設定升級遷移:舊預設值換成新值,自訂值與未設定不動', async () => {
  const mk = (v) => { const box = v === undefined ? {} : { medcloudEntryUrl: v }; return { box, get: async () => ({ ...box }), set: async (o) => Object.assign(box, o) }; };
  const a = mk(OLD_DEFAULT_ENTRY);
  assert.equal(await migrateOptions(a), true);
  assert.equal(a.box.medcloudEntryUrl, DEFAULTS.medcloudEntryUrl);
  const custom = `${MC}/imu/IMUE1000/IMUE0008`;
  const b = mk(custom);
  assert.equal(await migrateOptions(b), false);
  assert.equal(b.box.medcloudEntryUrl, custom);
  const c = mk(undefined);
  assert.equal(await migrateOptions(c), false);
  assert.deepEqual(c.box, {});
  assert.equal((await readOptions({ get: async () => ({ medcloudEntryUrl: OLD_DEFAULT_ENTRY }) })).medcloudEntryUrl, DEFAULTS.medcloudEntryUrl, '讀取時也視同新預設');
});
