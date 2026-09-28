// 線上規則取捨(純函式,background 用,Node 可測):線上規則通過檢查才用,否則用外掛內建
const num = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
/** a < b(x.y.z) */
export function versionLess(a, b) {
  const [x, y] = [num(a), num(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
}

/**
 * 回 null = 可用線上規則;否則回不採用的原因。
 * - 線上規則需要較新的引擎(minEngine > 本外掛引擎)→ 不用(新條件型別舊引擎看不懂)
 * - 線上與內建規則版本不同,且線上發布時間較早 → 不用(外掛已更新、線上尚未推送)
 */
export function rejectRemote(remote, bundled, code, engineVersion) {
  const r = remote?.latest?.[code];
  if (!r?.file || !r?.sha256) return '線上 manifest 缺該管轄規則';
  if (remote.minEngine && versionLess(engineVersion, remote.minEngine)) return `線上規則需要引擎 ${remote.minEngine}(本外掛 ${engineVersion})`;
  const b = bundled?.latest?.[code];
  if (b && b.version !== r.version && remote.publishedAt && bundled.publishedAt && remote.publishedAt < bundled.publishedAt) return `線上規則 ${r.version} 比內建 ${b.version} 舊`;
  return null;
}

/** 線上規則每天檢查一次(v0.4.15;原 6 小時) */
export const REFRESH_MS = 24 * 3600e3;
/** 快取是否需要重抓:沒有快取、強制、或已超過一天 */
export function needsRefresh(cache, now, { force = false } = {}) {
  return force || !cache?.fetchedAt || now - cache.fetchedAt >= REFRESH_MS;
}
