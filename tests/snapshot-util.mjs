// v0.4.10 回歸快照:既有欄位的正規化雜湊(鍵排序;排除 v0.4.12 新增欄位與依 §5 刻意變更的 decisiveManual)
import { createHash } from 'node:crypto';

const canon = (x) => (Array.isArray(x) ? `[${x.map(canon).join(',')}]`
  : x && typeof x === 'object' ? `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`
    : JSON.stringify(x));

/** 既有欄位(v0.4.10 就有的)*/
export function legacyView(v) {
  const { display, decisiveManual, dosing, ...rest } = v;
  let d = dosing;
  if (dosing) { const { fallback, upgrade, ...dr } = dosing; d = dr; }
  return { ...rest, dosing: d };
}
export const legacyHash = (v) => createHash('sha256').update(canon(legacyView(v))).digest('hex').slice(0, 16);
export const summary = (v) => ({ verdict: v.verdict, opensOn: v.opensOn || null, dosing: v.dosing?.status || null, ask: v.decisiveManual.map((m) => m.key) });
