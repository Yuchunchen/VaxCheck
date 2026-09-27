// 健保雲端 content script 的工作區流程(換卡、等 token)。DOM 與計時以參數注入,可在 Node 測試。
export const SWITCH_LINK_TEXTS = ['請換卡再按我', '請掃描再按我'];
export const SWITCH_TIMEOUT_MS = 30e3;
export const POLL_MS = 500;

export function isLoginUrl(url) {
  const u = String(url || '');
  return u.includes('/imu/login') || u.includes('/imu/IMUE1000/IMUE0001');
}

export function findSwitchLink(doc) {
  return [...doc.querySelectorAll('a')].find((a) => SWITCH_LINK_TEXTS.some((t) => (a.textContent || '').includes(t))) || null;
}

const realClock = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() };

/** 每 interval 呼叫 fn,回傳第一個 truthy 值;逾時回 null */
export async function pollUntil(fn, { timeout, interval = POLL_MS, clock = realClock }) {
  const end = clock.now() + Math.max(0, timeout);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (clock.now() >= end) return null;
    await clock.sleep(interval);
  }
}

/**
 * 換卡:代按「請換卡再按我」,等 UserID(以雜湊比較)改變。
 * deps: { url(), findLink(), idHash() → 目前 token 的 UserID 雜湊或 null, clock }
 * 回傳 result: 'login'(停在登入頁,不代按)| 'nolink' | 'switched' | 'same'(逾時,仍同一人)
 */
export async function switchCard(deps, { timeout = SWITCH_TIMEOUT_MS, interval = POLL_MS } = {}) {
  if (isLoginUrl(deps.url())) return { result: 'login' };
  const link = deps.findLink();
  if (!link) return { result: 'nolink' };
  const oldHash = await deps.idHash();
  link.click();
  const changed = await pollUntil(async () => { const h = await deps.idHash(); return h && h !== oldHash ? h : null; }, { timeout, interval, clock: deps.clock });
  return { result: changed ? 'switched' : 'same' };
}

/** 等健保雲端登入完成(不在登入頁且有 token);逾時回 null */
export function waitForToken(deps, { deadline, interval = POLL_MS }) {
  const clock = deps.clock || realClock;
  return pollUntil(() => (!isLoginUrl(deps.url()) && deps.token()) || null, { timeout: deadline - clock.now(), interval, clock });
}
