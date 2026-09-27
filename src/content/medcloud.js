// 健保雲端(medcloud2)content script:標題列 icon(工作區)或浮動鈕 → 讀資料 → 組 facts → 引擎判定 → 面板
import { evaluate } from '../engine/index.js';
import { ageYears, todayISO } from '../engine/dates.js';
import { decodeJwt, userFromPayload, sha256Hex } from '../adapters/nhi/token.js';
import { buildFacts } from '../adapters/nhi/facts.js';
import { mountPanel, renderPanel } from '../panel/panel.js';
import { POLL_MS, findSwitchLink, isLoginUrl, switchCard } from '../workspace/switch.js';
import { LOGIN_INCOMPLETE, findLoginButton, loginStep } from '../workspace/login.js';
import { AUTORUN_TIMEOUT_MS } from '../workspace/workspace.js';

const API = 'https://medcloud2.nhi.gov.tw/imu/api/';
const ENDPOINTS = {
  med: 'imue0008/imue0008s02/get-data',
  lab: 'imue0060/imue0060s02/get-data',
  allergy: 'imue0040/imue0040s02/get-data',
  lftp: 'imue0190/imue0190s01/lftp-data',
  summary: 'imue2000/imue2000s01/get-summary',
};
const log = (...a) => console.info('[疫苗檢核]', ...a);
const send = (msg) => chrome.runtime.sendMessage(msg);
const APP_VERSION = chrome.runtime.getManifest().version;

let session = null;         // { token, user, idHash }
let raw = null;             // 雲端回傳原始資料(僅記憶體)
let rulesPack = null;
let panel = null;           // { host, wrap }
let lastNotice = null;
let computed = null;        // 最近一次判定(只換提示時重畫,不重算)
let niisNoIdentity = false; // NIIS 未讀到健保卡(只在記憶體)
let autorunOp = null;       // 進行中的工作區操作 id
const NOTICE_NO_ID = { tone: 'wait', text: 'NIIS 未讀到健保卡,接種史未更新' };

function apiUrl(path) {
  const t = encodeURIComponent(new Date().toISOString().slice(0, 19));
  return path.startsWith('imue2000')
    ? `${API}${path}?drug_phet=false&drug_hemo=false&ctmri_assay=false&ctmri_dent=true&cli_datetime=${t}`
    : `${API}${path}?cli_datetime=${t}&insert_log=true`;
}
async function getJson(path, token) {
  const r = await fetch(apiUrl(path), { credentials: 'include', cache: 'no-store', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function checkSession() {
  const token = sessionStorage.getItem('token');
  if (!token) { if (session) { session = null; raw = null; closePanel(); send({ type: 'session:end' }); } return; }
  if (session?.token === token) return;
  const user = userFromPayload(decodeJwt(token));
  if (!user?.userId) return;
  const idHash = await sha256Hex(user.userId);
  const changed = session?.idHash !== idHash;
  session = { token, user: { ...user, userId: undefined }, idHash };
  if (changed) { raw = null; computed = null; lastNotice = null; niisNoIdentity = false; closePanel(); await send({ type: 'session:start', idHash }); log('新病患 session'); }
}

/** 讀取雲端資料;期間換了病患就丟棄 */
async function load() {
  const h = session?.idHash;
  if (!h) return;
  const data = await fetchAll();
  if (session?.idHash !== h) { log('讀取期間已換病患,丟棄舊資料'); return; }
  raw = data;
  render();
}

async function fetchAll() {
  const out = { status: {} };
  await Promise.all(Object.entries(ENDPOINTS).map(async ([k, path]) => {
    try { out[k] = await getJson(path, session.token); }
    catch (e) { out[k] = null; out.status[k === 'med' ? 'medication' : k] = 'error'; log(`${k} 讀取失敗`, e.message); }
  }));
  return out;
}

async function compute() {
  const s = await send({ type: 'session:get', idHash: session.idHash });
  const niis = s?.ok ? s.niis : null;
  const facts = buildFacts({
    user: session.user, med: raw.med, lab: raw.lab, allergy: raw.allergy, lftp: raw.lftp, summary: raw.summary, status: raw.status,
    vaccinations: niis ? { status: 'ok', records: niis.records } : { status: 'not_queried', records: [] },
    manual: s?.ok ? s.manual : {},
  });
  const result = evaluate(facts, rulesPack.rules, { asOf: todayISO() });
  const niisMeta = niis?.meta;
  if (niisMeta?.unmapped?.length) lastNotice = { tone: 'wait', text: `NIIS 有未對應的疫苗:${niisMeta.unmapped.join('、')}` };
  return { facts, result, niisMeta, idHash: session.idHash };
}

function closePanel() { panel?.host.remove(); panel = null; }

function mountHost() {
  if (panel) return;
  const host = document.createElement('div'); host.id = 'vaxcheck-panel'; document.documentElement.append(host);
  panel = { host, ...mountPanel(host) };
}

/** 未登入等情況:只顯示訊息的面板 */
function showMessage(text) {
  mountHost();
  renderPanel(panel.wrap, { user: { name: '疫苗檢核' }, error: text, appVersion: APP_VERSION }, { close: closePanel });
}

/** recompute = false:沿用上次判定,只更新提示(例如 NIIS 未讀到健保卡) */
async function render({ recompute = true } = {}) {
  if (!panel || !session) return;
  const u = session.user;
  const notice = niisNoIdentity ? NOTICE_NO_ID : lastNotice;
  const base = { user: { name: u.name, sex: u.sex, age: u.birthDate ? ageYears(u.birthDate, todayISO()) : null }, jurisdictionNames: rulesPack?.meta.names, rulesMeta: rulesPack?.meta, notice, appVersion: APP_VERSION };
  if (!raw) { renderPanel(panel.wrap, { ...base, loading: true }, { close: closePanel }); return; }
  try {
    if (recompute || computed?.idHash !== session.idHash) computed = await compute();
    const { facts, result, niisMeta } = computed;
    const manualLabels = Object.fromEntries((rulesPack.rules.manualConditions || []).map((m) => [m.key, m.label]));
    renderPanel(panel.wrap, { ...base, notice: niisNoIdentity ? NOTICE_NO_ID : lastNotice, result, sourceStatus: facts.sourceStatus, manual: facts.manual, manualLabels }, {
      close: closePanel,
      manual: async (key, value) => { await send({ type: 'manual:set', idHash: session.idHash, key, value }); render(); },
      niis: () => send({ type: 'niis:open' }),
      refresh: async () => { raw = null; render(); await load(); },
      export: () => exportDiag(facts, result, niisMeta),
    });
  } catch (e) {
    renderPanel(panel.wrap, { ...base, error: `判定失敗:${e.message}` }, { close: closePanel });
    console.error('[疫苗檢核]', e);
  }
}

function exportDiag(facts, result, niisMeta) {
  const diag = { exportedAt: new Date().toISOString(), note: '已排除姓名與身分證;仍含病歷資料,傳出前請去識別', facts, result, niisMeta, rawLftp: facts.sourceStatus.lftp === 'unknown_shape' ? raw.lftp : undefined };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(diag, null, 1)], { type: 'application/json' }));
  a.download = `vaxcheck-diag-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function openPanel({ quiet = false } = {}) {
  await checkSession();
  if (!session) { if (quiet) showMessage('尚未登入健保雲端'); else alert('疫苗檢核:尚未讀到健保卡(請先插卡登入健保雲端)'); return; }
  if (!rulesPack) { rulesPack = await send({ type: 'rules:get' }); if (!rulesPack?.ok) { rulesPack = null; if (quiet) showMessage('規則載入失敗'); else alert('疫苗檢核:規則載入失敗'); return; } }
  if (panel && !panel.host.isConnected) panel = null;
  mountHost();
  render();
  if (!raw) await load();
}

/** 面板已開(同一病患)→ 重新讀取並計算;否則開面板 */
async function openOrRefresh() {
  if (panel && raw && session) { raw = null; render(); await load(); return; }
  await openPanel({ quiet: true });
}

const tokenHash = async () => {
  const t = sessionStorage.getItem('token');
  const id = t ? userFromPayload(decodeJwt(t))?.userId : null;
  return id ? sha256Hex(id) : null;
};

/** 目前頁面狀態回報 background;回 true = background 已導向登入入口(本頁即將離開) */
async function reportState(op, extra = {}) {
  const r = await send({ type: 'workspace:medcloud', opId: op.opId, hasToken: !!sessionStorage.getItem('token'), url: location.href, ...extra }).catch(() => null);
  return r?.action === 'navigate';
}

/**
 * 等登入完成(最多到 deadline)。導向登入入口後 15 秒仍在登入頁 → 點一次「實體健保卡」登入按鈕(每次按 icon 一次);
 * 再 30 秒仍無 token → 提示。外掛狀態都在 chrome.storage.session(登入頁會清空頁面的 sessionStorage)。
 */
async function waitForLogin(op, deadline) {
  let messageShown = false;
  for (;;) {
    const p = (await send({ type: 'autorun:get' }).catch(() => null))?.pending;
    const hasToken = !!sessionStorage.getItem('token');
    const btn = findLoginButton(document);
    const step = loginStep({ now: Date.now(), url: location.href, hasToken, loginAt: p?.loginAt, fallbackClickedAt: p?.fallbackClickedAt, buttonFound: !!btn, messageShown });
    if (step === 'done') return true;
    if (step === 'click' && (await send({ type: 'autorun:login_fallback', opId: op.opId }))?.ok) { log('登入頁未自動登入,代按「實體健保卡」登入'); btn.click(); }
    if (step === 'message') { messageShown = true; log(LOGIN_INCOMPLETE); showMessage(LOGIN_INCOMPLETE); }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** 工作區自動執行(標題列 icon):op = { opId, ts, switchCard } */
async function autorun(op) {
  if (!op?.opId || autorunOp === op.opId) return;
  autorunOp = op.opId;
  try {
    const deps = { url: () => location.href, findLink: () => findSwitchLink(document), idHash: tokenHash, token: () => sessionStorage.getItem('token') };
    // 未登入或在登入頁 → background 導向 medcloudEntryUrl(?type=icc);已有 token 不導向
    if (await reportState(op)) return;
    let sw = null;
    if (op.switchCard && sessionStorage.getItem('token')) {
      await send({ type: 'autorun:switching', opId: op.opId });
      sw = await switchCard(deps);
      log({ switched: '已代按「請換卡再按我」,偵測到新病患', same: '已代按「請換卡再按我」,30 秒內未偵測到換卡', nolink: '找不到換卡連結,用目前病患計算', login: '在登入頁,等待登入' }[sw.result]);
      if (sw.result === 'same' && (await reportState(op, { switchTimedOut: true, linkFound: !!findSwitchLink(document) }))) return;
    }
    const ok = await waitForLogin(op, (op.ts || Date.now()) + AUTORUN_TIMEOUT_MS);
    if (ok) await checkSession();
    if (!ok || !session) {
      const loginAt = (await send({ type: 'autorun:get' }).catch(() => null))?.pending?.loginAt || op.loginAt;
      await send({ type: 'autorun:done', opId: op.opId });
      const text = loginAt ? LOGIN_INCOMPLETE : '尚未登入健保雲端';
      log(`${text}(等待 120 秒逾時)`);
      showMessage(text);
      return;
    }
    await send({ type: 'workspace:ready', opId: op.opId, idHash: session.idHash });
    if (sw?.result === 'same') lastNotice = { tone: 'wait', text: '仍為同一位病患(未偵測到換卡)' };
    await openOrRefresh();
  } finally {
    autorunOp = null;
  }
}

function addButton() {
  if (document.getElementById('vaxcheck-fab')) return;
  const host = document.createElement('div'); host.id = 'vaxcheck-fab';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>button{position:fixed;right:18px;bottom:18px;z-index:2147483645;font:600 15px "Microsoft JhengHei",system-ui,sans-serif;padding:10px 16px;border-radius:24px;border:0;background:#1C2B3A;color:#fff;box-shadow:0 4px 14px rgba(28,43,58,.3);cursor:pointer}button:focus-visible{outline:3px solid #2B6CB0;outline-offset:2px}</style><button type="button">疫苗檢核</button>`;
  root.querySelector('button').addEventListener('click', () => openPanel());
  document.documentElement.append(host);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'niis:updated') { niisNoIdentity = false; lastNotice = { tone: 'info', text: '已併入 NIIS 接種史' }; render(); }
  if (msg.type === 'niis:mismatch') { lastNotice = { tone: 'stop', text: 'NIIS 查的不是同一位病患,已忽略該結果' }; render(); }
  if (msg.type === 'niis:no_identity') { niisNoIdentity = true; log('NIIS 未讀到健保卡,接種史未更新'); render({ recompute: false }); }
  if (msg.type === 'workspace:run') { reply({ ok: true }); autorun(msg); }
});

addButton();
checkSession();
setInterval(checkSession, 2000);
log(`已載入 v${APP_VERSION}${isLoginUrl(location.href) ? '(登入頁)' : ''}`);
send({ type: 'autorun:get' }).then((r) => { if (r?.pending) autorun(r.pending); }).catch(() => {});
