// Service worker:工作區(標題列 icon)、跨分頁身分核對、NIIS 結果中繼、人工條件暫存、規則載入。
// 病患資料只放 chrome.storage.session(關瀏覽器即清);規則快取放 local(非病患資料)。
import { NIIS_ORIGIN, migrateOptions, readOptions } from './workspace/options.js';
import { createWorkspace } from './workspace/workspace.js';

const S = chrome.storage.session;
const get = async (k) => (await S.get(k))[k];
const opts = () => readOptions(chrome.storage.sync);
const workspace = createWorkspace({
  chrome, getOptions: opts, getCurrentIdHash: async () => (await get('current'))?.idHash || null,
  newId: () => crypto.randomUUID(),
});
// workspace:open 只接受外掛自己的頁面(e2e 觸發用),不接受 content script
const fromExtensionPage = (sender) => sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL(''));

async function notifyMedcloud(msg) {
  const tabs = await chrome.tabs.query({ url: 'https://medcloud2.nhi.gov.tw/*' });
  for (const t of tabs) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadRules() {
  const o = await opts();
  const bundledManifest = await (await fetch(chrome.runtime.getURL('rules/manifest.json'))).json();
  const pickCode = (m) => (m.latest[o.jurisdiction] ? o.jurisdiction : 'TW');
  let source = 'bundled';
  let manifest = bundledManifest;
  let body = null;
  if (o.remoteRulesBase && !o.pinBundled) {
    const cache = (await chrome.storage.local.get('rulesCache')).rulesCache;
    const fresh = cache && Date.now() - cache.fetchedAt < 6 * 3600e3;
    try {
      if (!fresh) {
        const base = o.remoteRulesBase.replace(/\/?$/, '/');
        const m = await (await fetch(base + 'manifest.json', { cache: 'no-store' })).json();
        const code = pickCode(m);
        const txt = await (await fetch(base + m.latest[code].file, { cache: 'no-store' })).text();
        if ((await sha256Hex(txt)) !== m.latest[code].sha256) throw new Error('規則檔雜湊不符');
        await chrome.storage.local.set({ rulesCache: { fetchedAt: Date.now(), manifest: m, code, body: txt } });
        manifest = m; body = txt; source = 'remote';
      } else if (cache.code === pickCode(cache.manifest)) { manifest = cache.manifest; body = cache.body; source = 'cache'; }
    } catch (e) { console.warn('[疫苗檢核] 線上規則失敗,改用內建', e); }
  }
  const code = pickCode(manifest);
  if (!body) body = await (await fetch(chrome.runtime.getURL(`rules/${bundledManifest.latest[pickCode(bundledManifest)].file}`))).text();
  const names = Object.fromEntries(Object.entries(manifest.latest).map(([k, v]) => [k, v.name || k]));
  return { ok: true, rules: JSON.parse(body), meta: { source, code, names } };
}

async function handle(msg, sender) {
  switch (msg.type) {
    case 'session:start': {
      const cur = await get('current');
      if (cur?.idHash !== msg.idHash) await S.set({ current: { idHash: msg.idHash, at: Date.now() }, niis: null, manual: {} });
      return { ok: true };
    }
    case 'session:end': await S.remove(['current', 'niis', 'manual']); return { ok: true };
    case 'session:get': {
      const cur = await get('current');
      if (!cur || cur.idHash !== msg.idHash) return { ok: false };
      const niis = await get('niis');
      return { ok: true, niis: niis?.idHash === msg.idHash ? niis : null, manual: (await get('manual')) || {} };
    }
    case 'manual:set': {
      const cur = await get('current');
      if (!cur || cur.idHash !== msg.idHash) return { ok: false };
      const m = (await get('manual')) || {};
      if (msg.value === null) delete m[msg.key]; else m[msg.key] = msg.value;
      await S.set({ manual: m });
      return { ok: true, manual: m };
    }
    case 'niis:result': {
      await workspace.niisParsed(sender.tab?.id, msg.idHash || null);
      const cur = await get('current');
      if (!cur) return { ok: false, reason: 'no_session' };
      if (!msg.idHash) return { ok: false, reason: 'no_id' };
      if (msg.idHash !== cur.idHash) { notifyMedcloud({ type: 'niis:mismatch' }); return { ok: false, reason: 'mismatch' }; }
      await S.set({ niis: { idHash: msg.idHash, records: msg.records, meta: msg.meta, at: Date.now() } });
      notifyMedcloud({ type: 'niis:updated' });
      return { ok: true, count: msg.records.length };
    }
    case 'niis:no_identity': {
      // 未讀到健保卡:不寫入接種史、不觸發重算,只通知面板
      await workspace.niisParsed(sender.tab?.id, null);
      notifyMedcloud({ type: 'niis:no_identity' });
      return { ok: true };
    }
    case 'niis:page': return workspace.niisPage(sender.tab?.id, { url: sender.url || msg.url, hasResult: msg.hasResult });
    case 'niis:open': {
      const o = await opts();
      const [tab] = await chrome.tabs.query({ url: `${NIIS_ORIGIN}/*` });
      if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
      else await chrome.tabs.create({ url: o.niisQueryUrl });
      return { ok: true };
    }
    case 'workspace:open':
      if (!fromExtensionPage(sender)) return { ok: false, reason: 'forbidden' };
      return workspace.open();
    case 'autorun:get': return { ok: true, pending: await workspace.autorunGet(sender.tab?.id) };
    case 'workspace:medcloud': return workspace.medcloudState(sender.tab?.id, { ...msg, url: sender.url || msg.url });
    case 'autorun:login_fallback': return workspace.loginFallback(sender.tab?.id, msg.opId);
    case 'autorun:switching': return workspace.autorunSwitching(msg.opId);
    case 'autorun:done': return workspace.autorunDone(msg.opId);
    case 'workspace:ready': return workspace.medcloudReady(sender.tab?.id, msg.opId, msg.idHash);
    case 'options:get': return { ok: true, options: await opts() };
    case 'rules:get': return loadRules();
    default: return { ok: false, reason: 'unknown_message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, send) => { handle(msg, sender).then(send, (e) => send({ ok: false, error: String(e) })); return true; });
// 標題列 icon → 開啟工作區(manifest 的 action 不可設 default_popup,否則不會觸發)
chrome.action.onClicked.addListener(() => { workspace.open().catch((e) => console.error('[疫苗檢核] 開啟工作區失敗', e)); });
// 設定升級遷移:舊預設入口 → ?type=icc(自訂值不動)。每次 service worker 啟動都檢查,冪等
const migrate = () => migrateOptions(chrome.storage.sync).then((changed) => { if (changed) console.info('[疫苗檢核] 健保雲端入口已更新為新預設'); }).catch(() => {});
chrome.runtime.onInstalled.addListener(migrate);
migrate();
chrome.tabs.onRemoved.addListener((tabId) => { workspace.tabRemoved(tabId).catch(() => {}); });
