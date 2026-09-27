// 代碼比對:完整碼 E11.9|前綴 E11*|區間 E08-E13(比對字母+前兩碼)|細碼區間 M05.70-M06.09、F01.A11-F01.C4(逐字比對,含端點)
export const normCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const cache = new WeakMap();
function compile(codes) {
  if (cache.has(codes)) return cache.get(codes);
  const c = { exact: new Set(), truncated: new Set(), stars: [], ranges: [], longRanges: [] };
  for (const raw of codes) {
    const p = String(raw).trim().toUpperCase();
    if (p.endsWith('*')) { c.stars.push(normCode(p.slice(0, -1))); continue; }
    const r = /^([A-Z]\d{2})-([A-Z]\d{2})$/.exec(p);
    if (r) { c.ranges.push([r[1], r[2]]); continue; }
    const lr = /^([A-Z0-9.]+)-([A-Z0-9.]+)$/.exec(p);
    if (lr) { c.longRanges.push([normCode(lr[1]), normCode(lr[2])]); continue; }
    const n = normCode(p);
    c.exact.add(n);
    // 雲端的 icd_code 可能被截短(5 碼);允許「病人碼是清單碼的前綴」
    for (let i = 4; i < n.length; i++) c.truncated.add(n.slice(0, i));
  }
  cache.set(codes, c);
  return c;
}

export function matchCode(code, codes) {
  const pc = normCode(code);
  if (!pc) return false;
  const c = compile(codes);
  if (c.exact.has(pc) || c.truncated.has(pc)) return true;
  if (c.stars.some((s) => pc.startsWith(s))) return true;
  const root = pc.slice(0, 3);
  if (c.ranges.some(([a, b]) => root >= a && root <= b)) return true;
  // 細碼區間:下界可容忍雲端截短碼(病人碼為下界前綴且至少 4 碼);上界含其所有子碼
  return c.longRanges.some(([a, b]) => (pc >= a || (pc.length >= 4 && a.startsWith(pc))) && (pc <= b || pc.startsWith(b)));
}
