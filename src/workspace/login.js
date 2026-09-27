// 健保雲端自動登入(IMUE1000 登入頁 ?type=icc)與備援。純函式,可在 Node 測試。
// 依 2026-09-28 院內頁面結構:登入頁 mounted() 會 sessionStorage.clear(),type=icc → 實體健保卡登入;
// 路由 history mode,base = /imu/IMUE1000/。type=icc 為未公開參數,因此保留「點登入按鈕」備援。
export const LOGIN_FALLBACK_MS = 15e3;   // 導向 ?type=icc 後仍在登入頁 → 點一次登入按鈕
export const LOGIN_MESSAGE_MS = 30e3;    // 備援點擊後仍無 token → 提示
export const LOGIN_BUTTON_TEXT = '健保雲端系統2.0(實體健保卡)';
export const LOGIN_INCOMPLETE = '健保雲端登入未完成,請確認醫事人員卡與健保卡已插入';

const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
const pathOf = (url) => { try { return new URL(url).pathname; } catch { return ''; } };

/** 明確的登入頁(不論 token) */
export function isLoginUrl(url) {
  const p = pathOf(url) || String(url || '');
  return p.startsWith('/imu/login') || p.startsWith('/imu/IMUE1000/IMUE0001');
}

/** 在登入頁:明確登入頁,或停在 /imu/IMUE1000/ 且無 token */
export function onLoginPage(url, hasToken) {
  if (isLoginUrl(url)) return true;
  const p = pathOf(url);
  return !hasToken && (p === '/imu/IMUE1000' || p === '/imu/IMUE1000/');
}

export function findLoginButton(doc) {
  const want = norm(LOGIN_BUTTON_TEXT);
  return [...doc.querySelectorAll('a.login-btn')].find((a) => norm(a.textContent).includes(want)) || null;
}

/**
 * 既有健保雲端分頁要不要導向 medcloudEntryUrl(每次按 icon 最多一次)。
 * state: { hasToken, url, switchTimedOut, linkFound, loginNavigated }
 * 已登入(有 token 且不在登入頁)一律不導向:導向 ?type=icc 會清空 session 重新登入。
 * 例外:換卡逾時且頁面上已找不到換卡連結 → 導向一次。
 */
export function decideMedcloud(state) {
  if (state.loginNavigated) return 'stay';
  if (!state.hasToken || onLoginPage(state.url, state.hasToken)) return 'navigate';
  if (state.switchTimedOut && !state.linkFound) return 'navigate';
  return 'stay';
}

/**
 * 等待登入時每次輪詢的動作。
 * s: { now, url, hasToken, loginAt(導向登入頁時間,無則不做備援), fallbackClickedAt, buttonFound, messageShown }
 * 回 'done' | 'click' | 'message' | 'wait'
 */
export function loginStep(s) {
  if (s.hasToken && !isLoginUrl(s.url)) return 'done';
  if (s.loginAt == null) return 'wait';
  const onLogin = onLoginPage(s.url, s.hasToken);
  if (onLogin && !s.fallbackClickedAt && s.buttonFound && s.now >= s.loginAt + LOGIN_FALLBACK_MS) return 'click';
  const base = s.fallbackClickedAt ?? s.loginAt + LOGIN_FALLBACK_MS;
  if (!s.messageShown && s.now >= base + LOGIN_MESSAGE_MS) return 'message';
  return 'wait';
}
