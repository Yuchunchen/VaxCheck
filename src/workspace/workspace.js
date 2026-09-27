// 工作區(background):按標題列 icon → 健保雲端 + NIIS 兩分頁 → 健保雲端自動開面板;NIIS 分頁決策與代按讀卡鈕。
// chrome API 以參數注入,可在 Node 用 mock 測試。storage.session 只放分頁 id、時間與身分雜湊,不放明文。
import { MEDCLOUD_ORIGIN, NIIS_ORIGIN, samePage, validateWorkspaceOptions } from './options.js';

export const AUTORUN_TIMEOUT_MS = 120e3;
export const OP_TTL_MS = 5 * 60e3;   // 一次按 icon 的操作有效期(代按 NIIS 讀卡鈕只在此期間內)

/** 多個符合的分頁時取最近使用的 */
export function pickTab(tabs) {
  if (!tabs?.length) return null;
  return [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || (b.active ? 1 : 0) - (a.active ? 1 : 0))[0];
}

/** NIIS 分頁決策。record = 該分頁最後一次解析的 { idHash };回 'create' | 'keep' | 'navigate' */
export function decideNiis(niisTab, record, currentIdHash) {
  if (!niisTab) return 'create';
  if (record?.idHash && currentIdHash && record.idHash === currentIdHash) return 'keep';
  return 'navigate';
}

/** 代按 NIIS「讀取健保卡及醫事人員卡」的條件;全部成立才 ok */
export function shouldAutoClick({ enabled, op, page, niisQueryUrl, currentIdHash, now }) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (!op || now - op.ts > OP_TTL_MS) return { ok: false, reason: 'not_from_icon' };                 // 1. 來自按 icon
  if (!op.medcloudIdHash || op.medcloudIdHash !== currentIdHash) return { ok: false, reason: 'medcloud_not_ready' };   // 2. 健保雲端已取得本次病患 token
  if (!page || page.pending || page.tabId !== op.niisTabId || !samePage(page.url, niisQueryUrl) || page.hasResult) return { ok: false, reason: 'niis_not_fresh' };   // 3. 全新查詢頁
  if (op.clicked) return { ok: false, reason: 'already_clicked' };                                      // 4. 本次尚未點過
  return { ok: true };
}

/**
 * deps: { chrome, getOptions(), getCurrentIdHash(), now(), newId(), log() }
 * chrome 需有 tabs.{query,create,update,get,sendMessage,reload}、windows.update、storage.session、runtime.getURL
 */
export function createWorkspace(deps) {
  const { chrome } = deps;
  const S = chrome.storage.session;
  const now = deps.now || (() => Date.now());
  const log = deps.log || ((...a) => console.info('[疫苗檢核]', ...a));
  const get = async (k) => (await S.get(k))[k];

  // 所有狀態變更依序執行,避免兩個訊息同時讀到「尚未點擊」
  let chain = Promise.resolve();
  const serial = (fn) => (...args) => { const p = chain.then(() => fn(...args)); chain = p.catch(() => {}); return p; };

  async function setNiisPage(tabId, { replace, ...patch }) {
    const all = (await get('niisTabs')) || {};
    all[tabId] = { ...(replace ? {} : all[tabId]), ...patch, tabId, at: now() };
    await S.set({ niisTabs: all });
    return all[tabId];
  }

  async function createNiisTab(o, mc) {
    const t = await chrome.tabs.create({ url: o.niisQueryUrl, active: false, windowId: mc.windowId, index: mc.index + 1 });
    await setNiisPage(t.id, { replace: true, pending: true });
    return t;
  }

  async function open() {
    const o = await deps.getOptions();
    const problems = validateWorkspaceOptions(o);
    if (problems) {
      log('設定不完整,開啟設定頁:', Object.keys(problems).join('、'));
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?problem=${Object.keys(problems).join(',')}`) });
      return { ok: false, reason: 'options', problems };
    }
    const opId = deps.newId(); const ts = now();
    let mc = pickTab(await chrome.tabs.query({ url: `${MEDCLOUD_ORIGIN}/*` }));
    const existing = !!mc;
    if (mc) {
      await chrome.tabs.update(mc.id, { active: true });
      await chrome.windows.update(mc.windowId, { focused: true });
    } else {
      mc = await chrome.tabs.create({ url: o.medcloudEntryUrl, active: true });
    }
    const switchCard = existing && o.autoSwitchCard !== false;
    await S.set({ pendingAutoRun: { tabId: mc.id, ts, opId, switchCard } });

    const op = { opId, ts, medcloudTabId: mc.id, niisTabId: null, niis: null, medcloudIdHash: null, clicked: false };
    const niis = pickTab(await chrome.tabs.query({ url: `${NIIS_ORIGIN}/*` }));
    if (niis) op.niisTabId = niis.id;   // 既有分頁:等健保雲端確認本次病患後再決定(§5)
    else { op.niisTabId = (await createNiisTab(o, mc)).id; op.niis = 'create'; }
    await S.set({ workspaceOp: op });

    if (existing) {
      const r = await chrome.tabs.sendMessage(mc.id, { type: 'workspace:run', opId, ts, switchCard }).catch(() => null);
      if (!r?.ok) { log('健保雲端分頁未載入外掛,重新整理該分頁'); await chrome.tabs.reload(mc.id); }
    }
    log(`工作區:健保雲端${existing ? '切換' : '新開'};NIIS ${op.niis === 'create' ? '背景新開' : '待確認病患'}`);
    return { ok: true, opId, medcloudTabId: mc.id, niisTabId: op.niisTabId, medcloud: existing ? 'focus' : 'create', niis: op.niis || 'deferred' };
  }

  /** 健保雲端 content script 載入時查詢:本分頁是否有待自動執行的操作 */
  async function autorunGet(tabId) {
    const p = await get('pendingAutoRun');
    if (!p || p.tabId !== tabId) return null;
    if (now() - p.ts > AUTORUN_TIMEOUT_MS) { await S.remove('pendingAutoRun'); return null; }
    return p;
  }

  /** 即將代按換卡連結:若頁面因此重新載入,新的 content script 不可再按一次 */
  async function autorunSwitching(opId) {
    const p = await get('pendingAutoRun');
    if (p?.opId === opId) await S.set({ pendingAutoRun: { ...p, switchCard: false } });
    return { ok: true };
  }

  async function autorunDone(opId) {
    const p = await get('pendingAutoRun');
    if (p?.opId === opId) await S.remove('pendingAutoRun');
    return { ok: true };
  }

  async function tryAutoClick() {
    const o = await deps.getOptions();
    const op = await get('workspaceOp');
    const page = op ? ((await get('niisTabs')) || {})[op.niisTabId] : null;
    const c = shouldAutoClick({ enabled: o.autoClickNiis, op, page, niisQueryUrl: o.niisQueryUrl, currentIdHash: await deps.getCurrentIdHash(), now: now() });
    if (!c.ok) return c;
    op.clicked = true;
    await S.set({ workspaceOp: op });
    const r = await chrome.tabs.sendMessage(op.niisTabId, { type: 'niis:autoclick', opId: op.opId }).catch(() => null);
    log(r?.clicked ? '已代按 NIIS 讀卡鈕' : 'NIIS 分頁未代按(頁面狀態不符)');
    return { ok: true, clicked: !!r?.clicked };
  }

  /** 健保雲端已取得本次病患 token → 決定 NIIS 分頁、視設定代按讀卡鈕 */
  async function medcloudReady(tabId, opId, idHash) {
    const op = await get('workspaceOp');
    if (!op || op.opId !== opId || op.medcloudTabId !== tabId || !idHash) return { ok: false };
    await autorunDone(opId);
    if (!op.medcloudIdHash) {
      op.medcloudIdHash = idHash;
      if (!op.niis) {
        const o = await deps.getOptions();
        const tab = await chrome.tabs.get(op.niisTabId).catch(() => null);
        const rec = ((await get('niisTabs')) || {})[op.niisTabId];
        op.niis = decideNiis(tab, rec, idHash);
        if (op.niis === 'create') op.niisTabId = (await createNiisTab(o, await chrome.tabs.get(tabId))).id;
        else if (op.niis === 'navigate') {
          await setNiisPage(tab.id, { replace: true, pending: true });
          await chrome.tabs.update(tab.id, { url: o.niisQueryUrl });
        }
        log(`NIIS 分頁:${{ create: '背景新開', keep: '同一病患,保留結果', navigate: '導回查詢頁' }[op.niis]}`);
      }
      await S.set({ workspaceOp: op });
    }
    await tryAutoClick();
    return { ok: true, niis: op.niis };
  }

  /** NIIS content script 載入:回報網址與是否已有結果。新頁面的身分雜湊由解析後填入 */
  async function niisPage(tabId, { url, hasResult }) {
    await setNiisPage(tabId, { replace: true, url, hasResult: !!hasResult, idHash: null, pending: false });
    return tryAutoClick();
  }

  /** NIIS 解析完成(idHash = null 表示未讀到健保卡) */
  async function niisParsed(tabId, idHash) {
    if (tabId == null) return;
    await setNiisPage(tabId, { hasResult: true, idHash: idHash || null });
  }

  async function tabRemoved(tabId) {
    const all = (await get('niisTabs')) || {};
    if (all[tabId]) { delete all[tabId]; await S.set({ niisTabs: all }); }
  }

  return {
    open: serial(open), autorunGet: serial(autorunGet), autorunSwitching: serial(autorunSwitching), autorunDone: serial(autorunDone), medcloudReady: serial(medcloudReady),
    niisPage: serial(niisPage), niisParsed: serial(niisParsed), tabRemoved: serial(tabRemoved), tryAutoClick: serial(tryAutoClick),
  };
}
