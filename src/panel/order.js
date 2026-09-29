// 面板排序(只在渲染層;engine Result 維持規則順序,稽核與匯出不受影響)。純函式,可在 Node 測試。
// v0.4.12:分組依 engine 算好的 display.bucket(保底/升級,docs/07 §3.1),不再看 pending_case、alternative
export const GROUPS = [
  { key: 'eligible', label: '可接種' },
  { key: 'confirm', label: '待確認' },
  { key: 'not_open', label: '尚未開打' },
  { key: 'ineligible', label: '不符合' },
];
const KEYS = new Set(GROUPS.map((g) => g.key));

/** 沒有 display 或 bucket 不在表上 → 待確認(不歸入可接種) */
export function groupOf(v) {
  const b = v?.display?.bucket;
  return KEYS.has(b) ? b : 'confirm';
}

/** 回 [{ key, label, items }],空組不列;組內維持規則原始順序 */
export function groupVaccines(vaccines) {
  const by = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
  for (const v of vaccines || []) by[groupOf(v)].push(v);
  return GROUPS.map((g) => ({ ...g, items: by[g.key] })).filter((g) => g.items.length);
}

/** 判定依據:true → 未確認 → false;同值維持原順序 */
export function sortTrace(trace) {
  const rank = (x) => (x.value === true ? 0 : x.value === false ? 2 : 1);
  return (trace || []).map((g, i) => [g, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([g]) => g);
}

// ---------- 診斷證據(v0.4.23):判定依據下列出命中的診斷 ----------
export const EVIDENCE_LIMIT = 3;   // 面板預設只列前 N 筆,其餘收在「另 N 項」
export const EVIDENCE_CATEGORY = { chronic: '高風險慢性病', catastrophic: '重大傷病', rare: '罕見疾病' };

/** 前 limit 筆 + 其餘;零筆回 null(不顯示證據區) */
export function splitEvidence(items, limit = EVIDENCE_LIMIT) {
  if (!items?.length) return null;
  return { shown: items.slice(0, limit), rest: items.slice(limit) };
}
