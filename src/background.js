// Service worker:跨分頁身分核對、NIIS 結果中繼、人工條件暫存、規則載入。
// 病患資料只放 chrome.storage.session(關瀏覽器即清);規則快取放 local(非病患資料)。
const S = chrome.storage.session;
const NIIS_ORIGIN = 'https://10.241.219.35';
const DEFAULTS = { jurisdiction: 'TW', niisUrl: `${NIIS_ORIGIN}/`, autoClickNiis: false, remoteRulesBase: '', pinBundled: false };

const get = async (k) => (await S.get(k))[k];
const opts = async () => ({ ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) });

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
      const cur = await get('current');
      if (!cur) return { ok: false, reason: 'no_session' };
      if (!msg.idHash) return { ok: false, reason: 'no_id' };
      if (msg.idHash !== cur.idHash) { notifyMedcloud({ type: 'niis:mismatch' }); return { ok: false, reason: 'mismatch' }; }
      await S.set({ niis: { idHash: msg.idHash, records: msg.records, meta: msg.meta, at: Date.now() } });
      notifyMedcloud({ type: 'niis:updated' });
      return { ok: true, count: msg.records.length };
    }
    case 'niis:open': {
      const o = await opts();
      const [tab] = await chrome.tabs.query({ url: `${NIIS_ORIGIN}/*` });
      if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
      else await chrome.tabs.create({ url: o.niisUrl + (o.niisUrl.includes('#') ? '' : '#vaxcheck') });
      return { ok: true };
    }
    case 'options:get': return { ok: true, options: await opts() };
    case 'rules:get': return loadRules();
    default: return { ok: false, reason: 'unknown_message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, send) => { handle(msg, sender).then(send, (e) => send({ ok: false, error: String(e) })); return true; });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
